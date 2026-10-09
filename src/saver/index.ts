import { Game } from "../mainview/game";
import { FakeSource } from "../shared/fake";
import { HerdrPoller } from "../shared/herdr-core";
import { SaverFeed } from "./live";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const game = new Game(canvas);

// Live worlds are pushed in by the Swift DaemonLink (never in the System
// Settings thumbnail, which has no link); the demo loop fills every gap.
const feed = new SaverFeed();
let paused = false;
const demo = new HerdrPoller(new FakeSource("loop", { outage: false }), (snap) => {
	// an in-flight tick can resolve after pause(); drop it
	if (paused) return;
	const now = Date.now();
	feed.beat(now);
	if (feed.mode(now) !== "demo") return;
	game.demo = true;
	game.onSnapshot(snap);
});

/** Called by AgentViewSaverView (Swift) on start/stop, willstop, and for every daemon frame. */
(globalThis as any).saver = {
	pause(): void {
		paused = true;
		demo.stop();
		game.stop();
	},
	resume(): void {
		paused = false;
		feed.reset(Date.now());
		void demo.start();
		game.start();
	},
	world(text: string): void {
		if (paused) return;
		const now = Date.now();
		feed.accept(text, now);
		const live = feed.live(now);
		if (!live) return;
		game.demo = false;
		game.onSnapshot(live);
	},
};

window.addEventListener("resize", () => game.resize());
feed.reset(Date.now());
void demo.start();
game.start();
