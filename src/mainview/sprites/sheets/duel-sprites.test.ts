import { describe, expect, test } from "bun:test";
import { ANIMS } from "../../animation";
import { CHARACTER, DUEL_GRIP } from "./character";
import { STARS } from "./fx";

const DUEL_FRAMES = [
	"duel.guard.0",
	"duel.guard.1",
	"duel.swing.0",
	"duel.swing.1",
	"duel.down.0",
	"duel.win.0",
	"duel.win.1",
];

describe("duel sprites", () => {
	test("every duel frame is 16x24 and uses only the swap-contract palette keys", () => {
		const keys = new Set([".", ...Object.keys(CHARACTER.palette)]);
		for (const name of DUEL_FRAMES) {
			const rows = CHARACTER.frames[name];
			expect(rows, name).toBeDefined();
			expect(rows!.length, name).toBe(24);
			for (const row of rows!) {
				expect(row.length, `${name}: ${row}`).toBe(16);
				for (const ch of row) expect(keys.has(ch), `${name}: '${ch}'`).toBe(true);
			}
		}
	});

	test("grips sit on a skin pixel inside an existing frame; the knocked-down frame has none", () => {
		for (const [name, grip] of Object.entries(DUEL_GRIP)) {
			const rows = CHARACTER.frames[name];
			expect(rows, name).toBeDefined();
			expect(rows![grip.hand.y]![grip.hand.x], name).toBe("s");
			expect(Math.abs(grip.angle) <= Math.PI, name).toBe(true);
		}
		expect(DUEL_GRIP["duel.down.0"]).toBeUndefined();
		expect(Object.keys(DUEL_GRIP).sort()).toEqual(DUEL_FRAMES.filter((f) => f !== "duel.down.0").sort());
	});

	test("duel animations reference existing frames; the swing plays once", () => {
		for (const anim of [ANIMS.duelGuard, ANIMS.duelSwing, ANIMS.duelDown, ANIMS.duelWin]) {
			for (const f of anim.frames) expect(CHARACTER.frames[f.frame], f.frame).toBeDefined();
		}
		expect(ANIMS.duelSwing.loop).toBe(false);
		// the strike frame starts exactly STRIKE_MS (300) into the swing
		expect(ANIMS.duelSwing.frames[0]!.ms).toBe(300);
		expect(ANIMS.duelSwing.frames[1]!.frame).toBe("duel.swing.1");
	});

	test("dizzy stars are two small frames", () => {
		expect(Object.keys(STARS.frames).sort()).toEqual(["stars.0", "stars.1"]);
		for (const rows of Object.values(STARS.frames)) {
			expect(rows.length).toBe(3);
			for (const row of rows) expect(row.length).toBe(7);
		}
	});
});
