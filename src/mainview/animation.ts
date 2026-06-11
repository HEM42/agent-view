import type { DecodedFrame, DecodedSheet } from "./sprites/pixel";

export interface Animation {
	frames: { frame: string; ms: number }[];
	loop: boolean;
}

export const ANIMS = {
	idle: {
		loop: true,
		frames: [
			{ frame: "idle.0", ms: 600 },
			{ frame: "idle.1", ms: 600 },
		],
	},
	walk: {
		loop: true,
		frames: [0, 1, 2, 3].map((i) => ({ frame: `walk.${i}`, ms: 125 })),
	},
	sitType: {
		loop: true,
		frames: [
			{ frame: "sit.type.0", ms: 160 },
			{ frame: "sit.type.1", ms: 160 },
			{ frame: "sit.type.2", ms: 160 },
		],
	},
	sitCouch: {
		loop: true,
		frames: [
			{ frame: "sit.couch.0", ms: 1100 },
			{ frame: "sit.couch.1", ms: 1100 },
		],
	},
	raiseHand: {
		loop: true,
		frames: [
			{ frame: "raise.0", ms: 400 },
			{ frame: "raise.1", ms: 400 },
		],
	},
	sleep: {
		loop: true,
		frames: [
			{ frame: "sleep.0", ms: 1400 },
			{ frame: "sleep.1", ms: 1400 },
		],
	},
	confused: {
		loop: true,
		frames: [
			{ frame: "confused.0", ms: 550 },
			{ frame: "confused.1", ms: 550 },
		],
	},
} as const satisfies Record<string, Animation>;

export type AnimName = keyof typeof ANIMS;

export class AnimationPlayer {
	private anim: Animation = ANIMS.idle;
	private name: AnimName | string = "idle";
	private index = 0;
	private elapsed = 0;
	done = false;

	constructor(
		private sheet: DecodedSheet,
		/** sheets with arbitrary animations (furniture) pass their own table */
		private table: Record<string, Animation> = ANIMS,
	) {}

	play(name: AnimName | string, opts?: { restart?: boolean }): void {
		if (name === this.name && !opts?.restart) return;
		const anim = this.table[name];
		if (!anim) return;
		this.anim = anim;
		this.name = name;
		this.index = 0;
		this.elapsed = 0;
		this.done = false;
	}

	playing(): string {
		return this.name as string;
	}

	update(dtMs: number): void {
		if (this.done) return;
		this.elapsed += dtMs;
		let hold = this.anim.frames[this.index]!.ms;
		while (this.elapsed >= hold) {
			this.elapsed -= hold;
			this.index++;
			if (this.index >= this.anim.frames.length) {
				if (this.anim.loop) {
					this.index = 0;
				} else {
					this.index = this.anim.frames.length - 1;
					this.done = true;
					return;
				}
			}
			hold = this.anim.frames[this.index]!.ms;
		}
	}

	frame(): DecodedFrame {
		const name = this.anim.frames[this.index]!.frame;
		const f = this.sheet.get(name);
		if (f) return f;
		// missing frame: fall back to anything rather than crash the loop
		return this.sheet.values().next().value as DecodedFrame;
	}
}
