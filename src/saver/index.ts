import { Game } from "../mainview/game";
import { FakeSource } from "../shared/fake";
import { HerdrPoller } from "../shared/herdr-core";
import { LiveOrDemoSource, NativeHerdrSource, webkitBridge } from "./source";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const game = new Game(canvas);

// the System Settings thumbnail never spawns herdr (no bridge is registered)
const preview = (globalThis as any).AGENTVIEW_PREVIEW === true;
const bridge = preview ? null : webkitBridge();
const source = new LiveOrDemoSource(
	bridge ? new NativeHerdrSource(bridge) : null,
	new FakeSource("loop", { outage: false }),
);
const poller = new HerdrPoller(source, (snap) => {
	game.demo = source.isDemo;
	game.onSnapshot(snap);
});

/** Called by AgentViewSaverView on start/stop and screensaver willstop. */
(globalThis as any).saver = {
	pause(): void {
		poller.stop();
		game.stop();
	},
	resume(): void {
		void poller.start();
		game.start();
	},
};

window.addEventListener("resize", () => game.resize());
void poller.start();
game.start();
