import { AnimationPlayer, type Animation } from "../animation";
import { decodeSheet } from "../sprites/pixel";
import { CAT } from "../sprites/sheets/fx";
import { COUCH, DESKS, type Vec2 } from "../scene/layout";
import { buildPath, step, type Mover } from "./locomotion";
import type { World } from "../world";

const CAT_ANIMS: Record<string, Animation> = {
	walk: {
		loop: true,
		frames: [0, 1, 2, 1].map((i) => ({ frame: `cat.walk.${i}`, ms: 130 })),
	},
	sit: {
		loop: true,
		frames: [
			{ frame: "cat.sit.0", ms: 900 },
			{ frame: "cat.sit.1", ms: 900 },
		],
	},
	sleep: {
		loop: true,
		frames: [
			{ frame: "cat.sleep.0", ms: 1500 },
			{ frame: "cat.sleep.1", ms: 1500 },
		],
	},
	stare: {
		loop: true,
		frames: [
			{ frame: "cat.stare.0", ms: 2600 },
			{ frame: "cat.stare.1", ms: 200 },
		],
	},
};

type CatState = "WANDER" | "PAUSE" | "NAP" | "JUDGE";

const CAT_SPEED = 26;

/**
 * Daemon. Pure ambience, zero data dependency — except the charm rule:
 * when an agent has been blocked for >60s, the cat walks to that desk,
 * sits on it, and stares at the user.
 */
export class Cat implements Mover {
	pos: Vec2 = { x: 160, y: 206 };
	facing: 1 | -1 = 1;
	path: Vec2[] = [];
	private state: CatState = "PAUSE";
	private until = 0;
	private judging: string | null = null;
	private anim: AnimationPlayer;

	constructor() {
		this.anim = new AnimationPlayer(decodeSheet(CAT), CAT_ANIMS);
	}

	update(dtMs: number, now: number, world: World): void {
		const judgeTarget = world.longestBlocked(now);

		if (judgeTarget && this.judging !== judgeTarget.id) {
			// someone has been ignored for a minute: time to apply pressure
			this.judging = judgeTarget.id;
			const desk = world.slots.held(judgeTarget.id);
			const spot = DESKS.find((d) => d.id === desk?.id);
			if (spot) {
				this.path = buildPath(this.pos, { x: spot.pos.x + 18, y: spot.pos.y + 2 }, spot.lane);
				this.path.push({ x: spot.pos.x + 6, y: spot.pos.y - 13 }); // hop up
				this.state = "JUDGE";
			}
		} else if (!judgeTarget && this.state === "JUDGE") {
			this.judging = null;
			this.state = "PAUSE";
			this.pos = { x: this.pos.x, y: this.pos.y + 13 }; // hop down
			this.until = now + 1500;
		}

		if (this.path.length > 0) {
			const done = step(this, dtMs, CAT_SPEED);
			this.anim.play("walk");
			if (done && this.state !== "JUDGE") {
				this.until = now + 4000 + Math.random() * 8000;
			}
		} else {
			switch (this.state) {
				case "JUDGE":
					this.anim.play("stare");
					break;
				case "NAP":
					this.anim.play("sleep");
					if (now > this.until) this.wanderNext(now);
					break;
				default:
					this.anim.play("sit");
					if (now > this.until) this.wanderNext(now);
			}
		}
		this.anim.update(dtMs);
	}

	private wanderNext(now: number): void {
		const roll = Math.random();
		if (roll < 0.25) {
			// nap on the couch armrest
			this.path = buildPath(this.pos, { x: COUCH.armRest.x, y: 206 }, 2);
			this.path.push({ ...COUCH.armRest });
			this.state = "NAP";
			this.until = now + 20_000 + Math.random() * 20_000;
		} else {
			const lane = Math.random() < 0.5 ? 1 : 2;
			const x = 100 + Math.random() * 230;
			this.path = buildPath(this.pos, { x, y: lane === 1 ? 172 : 206 }, lane);
			this.state = "PAUSE";
			this.until = now + 4000 + Math.random() * 8000;
		}
	}

	entity(): { sortY: number; tie: string; draw: (ctx: OffscreenCanvasRenderingContext2D) => void } {
		return {
			sortY: this.state === "JUDGE" && this.path.length === 0 ? this.pos.y + 14 : this.pos.y,
			tie: "cat",
			draw: (ctx) => {
				const frame = this.anim.frame();
				if (!frame) return;
				const img = this.facing === -1 ? frame.flipped : frame.canvas;
				const ax = this.facing === -1 ? frame.w - frame.anchorX : frame.anchorX;
				ctx.drawImage(
					img,
					Math.round(this.pos.x) - ax,
					Math.round(this.pos.y) - frame.anchorY,
				);
			},
		};
	}
}
