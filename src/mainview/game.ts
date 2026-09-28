import type { Snapshot } from "../shared/types";
import { Cat } from "./characters/cat";
import { Renderer } from "./renderer";
import { Scene } from "./scene/scene";
import { BubbleLayer } from "./ui/bubble";
import { drawDemoTag, drawNametagsHud, drawOffline } from "./ui/hud";
import { World } from "./world";

const TICK_MS = 1000 / 60;
const MAX_ACC_MS = 250; // no spiral of death after a backgrounded tab

export class Game {
	readonly world = new World();
	private scene = new Scene();
	private renderer: Renderer;
	private bubbles = new BubbleLayer();
	private cat = new Cat();
	private acc = 0;
	private last = performance.now();
	private raf = 0;
	/** screensaver: true while the room shows the scripted demo */
	demo = false;

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new Renderer(canvas);
	}

	onSnapshot(snap: Snapshot): void {
		this.world.reconcile(snap, performance.now());
	}

	resize(): void {
		this.renderer.resize();
	}

	toVirtual(cssX: number, cssY: number) {
		return this.renderer.toVirtual(cssX, cssY);
	}

	start(): void {
		if (this.raf) return; // already running
		this.last = performance.now();
		const frame = (now: number) => {
			this.acc = Math.min(this.acc + (now - this.last), MAX_ACC_MS);
			this.last = now;
			while (this.acc >= TICK_MS) {
				this.world.update(TICK_MS, now);
				this.cat.update(TICK_MS, now, this.world);
				this.scene.update(TICK_MS, now);
				this.acc -= TICK_MS;
			}
			this.draw(now);
			this.raf = requestAnimationFrame(frame);
		};
		this.raf = requestAnimationFrame(frame);
	}

	stop(): void {
		cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.world.forgetLink();
	}

	private draw(now: number): void {
		const ctx = this.renderer.vctx;
		const chars = this.world.sorted();

		this.scene.draw(ctx, this.world, now, [this.cat.entity()]);
		this.bubbles.draw(ctx, chars, now);

		const offline = !this.world.herdrOnline;
		const lost = this.world.linkLost(now);
		if (offline || lost) {
			drawOffline(
				ctx,
				lost ? "link-lost" : (this.world.offlineReason ?? "server-down"),
				now,
			);
		}

		if (this.demo) drawDemoTag(ctx);
		this.scene.overlay(ctx);
		this.renderer.present(this.scene.effects.jitterFrame(now));
		// nametags live on the HUD layer at fixed size, above the scaled scene
		if (!offline && !lost) {
			drawNametagsHud(this.renderer.displayCtx, chars, this.renderer.transform(), now);
		}
	}
}
