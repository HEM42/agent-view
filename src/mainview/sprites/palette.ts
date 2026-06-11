/** "MIDNIGHT ARCADE" — the 20-color cyberpunk palette. Pure data. */

export const PAL = {
	// structural darks (blue-violet ramp)
	ink: "#0A0613",
	night: "#181230",
	dusk: "#261D46",
	slate: "#34315E",
	steel: "#4C4A82",
	lilac: "#8B87B8",
	white: "#F2EEFF",
	// neons (paired with a "deep" off-state for flicker)
	neonCyan: "#2DE2E6",
	deepCyan: "#157A8C",
	holoBlue: "#7AB8FF",
	neonMagenta: "#FF2E88",
	deepMagenta: "#8C2058",
	neonYellow: "#FFD92E",
	neonOrange: "#FF7A2E",
	neonGreen: "#3DF28C",
	neonViolet: "#9B5DE5",
	coral: "#E8825A",
	acid: "#B6FF2E",
	// skin ramp
	skinLight: "#F2C29E",
	skinTan: "#C9885C",
	skinDeep: "#7A4B32",
} as const;

export type PaletteColor = keyof typeof PAL;

/**
 * Exactly five agent (outfit) colors and five project (accent) colors,
 * picked to pair well and never overlap each other. Colors are handed out
 * from a registry — first free color to each new name — so two projects
 * (or two agent types) can never share a color. Assignments persist in
 * localStorage so they survive restarts. Beyond five names the ring wraps.
 */
export const AGENT_COLORS: string[] = [
	PAL.coral, // claude
	PAL.neonGreen, // pi
	PAL.neonViolet,
	PAL.neonOrange,
	PAL.holoBlue,
];

export const PROJECT_COLORS: string[] = [
	PAL.neonCyan,
	PAL.neonMagenta,
	PAL.neonYellow,
	PAL.acid,
	PAL.white,
];

class ColorRegistry {
	private assigned = new Map<string, number>();

	constructor(
		private storageKey: string,
		private ring: string[],
		seed?: Record<string, number>,
	) {
		if (seed) {
			for (const [name, idx] of Object.entries(seed)) {
				this.assigned.set(name, idx);
			}
		}
		this.load();
	}

	color(name: string): string {
		let idx = this.assigned.get(name);
		if (idx === undefined) {
			const used = new Set(this.assigned.values());
			idx = 0;
			while (used.has(idx) && idx < this.ring.length) idx++;
			if (idx >= this.ring.length) idx = this.assigned.size % this.ring.length;
			this.assigned.set(name, idx);
			this.save();
		}
		return this.ring[idx % this.ring.length]!;
	}

	private load(): void {
		try {
			if (typeof localStorage === "undefined") return; // bun-side tools
			const raw = localStorage.getItem(this.storageKey);
			if (!raw) return;
			const obj = JSON.parse(raw) as Record<string, unknown>;
			for (const [name, idx] of Object.entries(obj)) {
				if (typeof idx === "number" && !this.assigned.has(name)) {
					this.assigned.set(name, idx);
				}
			}
		} catch {
			// corrupt storage: start fresh
		}
	}

	private save(): void {
		try {
			if (typeof localStorage === "undefined") return;
			localStorage.setItem(
				this.storageKey,
				JSON.stringify(Object.fromEntries(this.assigned)),
			);
		} catch {
			// quota/sandbox issues are non-fatal
		}
	}
}

const projectColors = new ColorRegistry(
	"agentview.projectColors",
	PROJECT_COLORS,
);
const agentColors = new ColorRegistry("agentview.agentColors", AGENT_COLORS, {
	claude: 0,
	pi: 1,
	codex: 2,
	gemini: 4,
});

const SKIN_RAMP: string[] = [PAL.skinLight, PAL.skinTan, PAL.skinDeep];

/** FNV-1a — stable across sessions, unlike Math.random. */
export function hashString(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** Per-project accent: scarf, nametag, blanket stripe, mug. */
export function accentFor(project: string): string {
	return projectColors.color(project);
}

export function skinFor(terminalId: string): string {
	return SKIN_RAMP[hashString(terminalId) % SKIN_RAMP.length]!;
}

export interface Outfit {
	base: string; // outfit body color ('b' in sprite data)
	dark: string; // outfit shade ('d')
	hair: string; // hair ('h')
}

const KNOWN_HAIR: Record<string, string> = {
	claude: PAL.ink,
	pi: PAL.lilac,
	codex: PAL.white,
	gemini: PAL.dusk,
};
const FALLBACK_HAIR = [PAL.ink, PAL.lilac, PAL.white, PAL.deepMagenta];

export function outfitFor(agent: string): Outfit {
	return {
		base: agentColors.color(agent),
		dark: PAL.dusk,
		hair:
			KNOWN_HAIR[agent] ??
			FALLBACK_HAIR[hashString(agent) % FALLBACK_HAIR.length]!,
	};
}
