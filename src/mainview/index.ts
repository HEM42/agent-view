import { Electroview } from "electrobun/view";
import type { AgentViewRPC, Snapshot } from "../shared/types";
import { Game } from "./game";
import { droneTooltip, fmtDuration, moreTooltip } from "./ui/tooltip";

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

function showTooltip(html: string, e: MouseEvent): void {
	canvas.style.cursor = "pointer";
	tooltip.innerHTML = html;
	tooltip.hidden = false;
	const rect = canvas.getBoundingClientRect();
	tooltip.style.left = `${Math.min(e.offsetX + 14, rect.width - 200)}px`;
	tooltip.style.top = `${Math.max(e.offsetY - 10, 4)}px`;
}

const STATUS_LABEL: Record<string, string> = {
	working: "working",
	idle: "idle",
	blocked: "waiting for you",
	unknown: "unknown",
};

canvas.addEventListener("mousemove", (e) => {
	const p = game.toVirtual(e.offsetX, e.offsetY);
	const drone = p ? game.world.pickDrone(p, performance.now()) : null;
	if (drone) {
		const parent = game.world.chars.get(drone.parentId) ?? null;
		showTooltip(drone.kind === "drone" ? droneTooltip(drone.drone, parent, Date.now()) : moreTooltip(drone.overflow.hidden), e);
		return;
	}
	const hit = p ? game.world.pick(p) : null;
	if (!hit) {
		tooltip.hidden = true;
		canvas.style.cursor = "default";
		return;
	}
	showTooltip(
		`<span class="k">${hit.agent}</span> · ${hit.project}<br>` +
			`${STATUS_LABEL[hit.desiredStatus] ?? hit.desiredStatus} — ${fmtDuration(performance.now() - hit.statusSince)}<br>` +
			`<span class="k">double-click</span> to focus in herdr`,
		e,
	);
});

canvas.addEventListener("mouseleave", () => {
	tooltip.hidden = true;
});

canvas.addEventListener("dblclick", (e) => {
	const p = game.toVirtual(e.offsetX, e.offsetY);
	const id = p ? (game.world.pickDrone(p, performance.now())?.parentId ?? game.world.pick(p)?.id) : undefined;
	if (id) {
		electroview.rpc?.request.focusAgent({ id }).then((res) => {
			if (!res.ok) console.warn(`focusAgent failed: ${res.error}`);
		});
	}
});

console.log("Agent View mainview loaded");
