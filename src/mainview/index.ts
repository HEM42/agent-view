import { Electroview } from "electrobun/view";
import type { AgentViewRPC, Snapshot } from "../shared/types";
import { Game } from "./game";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const tooltip = document.getElementById("tooltip") as HTMLDivElement;
const game = new Game(canvas);

const rpc = Electroview.defineRPC<AgentViewRPC>({
	maxRequestTime: 5000,
	handlers: {
		requests: {},
		messages: {
			snapshot: (snap: Snapshot) => game.onSnapshot(snap),
		},
	},
});

const electroview = new Electroview({ rpc });

electroview.rpc?.request.getSnapshot({}).then((snap: Snapshot) => {
	game.onSnapshot(snap);
});

game.start();

// ---- dev frame dumps (no-op unless bun has AGENTVIEW_SHOT set) ----

function dumpFrame(): void {
	electroview.rpc?.request
		.saveShot({ dataUrl: canvas.toDataURL("image/png") })
		.catch(() => {});
}
setTimeout(dumpFrame, 4000);
setInterval(dumpFrame, 10_000);
window.addEventListener("keydown", (e) => {
	if (e.key === "s") dumpFrame();
});

// ---- chrome buttons ----

const pinBtn = document.getElementById("pin") as HTMLButtonElement;
const closeBtn = document.getElementById("close") as HTMLButtonElement;
let pinned = false;

pinBtn.addEventListener("click", () => {
	pinned = !pinned;
	pinBtn.setAttribute("aria-pressed", String(pinned));
	electroview.rpc?.send.setAlwaysOnTop({ value: pinned });
});

closeBtn.addEventListener("click", () => {
	electroview.rpc?.send.quitApp({});
});

// ---- resize ----

window.addEventListener("resize", () => game.resize());
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
	"change",
	() => game.resize(),
	{ once: true },
);

// ---- hover tooltip + double-click focus ----

function fmtDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const STATUS_LABEL: Record<string, string> = {
	working: "working",
	idle: "idle",
	blocked: "waiting for you",
	unknown: "unknown",
};

canvas.addEventListener("mousemove", (e) => {
	const p = game.toVirtual(e.offsetX, e.offsetY);
	const hit = p ? game.world.pick(p) : null;
	if (!hit) {
		tooltip.hidden = true;
		canvas.style.cursor = "default";
		return;
	}
	canvas.style.cursor = "pointer";
	tooltip.innerHTML =
		`<span class="k">${hit.agent}</span> · ${hit.project}<br>` +
		`${STATUS_LABEL[hit.desiredStatus] ?? hit.desiredStatus} — ${fmtDuration(
			performance.now() - hit.statusSince,
		)}<br>` +
		`<span class="k">double-click</span> to focus in herdr`;
	tooltip.hidden = false;
	const rect = canvas.getBoundingClientRect();
	tooltip.style.left = `${Math.min(e.offsetX + 14, rect.width - 200)}px`;
	tooltip.style.top = `${Math.max(e.offsetY - 10, 4)}px`;
});

canvas.addEventListener("mouseleave", () => {
	tooltip.hidden = true;
});

canvas.addEventListener("dblclick", (e) => {
	const p = game.toVirtual(e.offsetX, e.offsetY);
	const hit = p ? game.world.pick(p) : null;
	if (hit) {
		electroview.rpc?.request.focusAgent({ id: hit.id }).then((res) => {
			if (!res.ok) console.warn(`focusAgent failed: ${res.error}`);
		});
	}
});

console.log("Agent View mainview loaded");
