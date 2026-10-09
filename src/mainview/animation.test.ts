import { describe, expect, test } from "bun:test";
import { AnimationPlayer } from "./animation";

describe("AnimationPlayer.frameName", () => {
	test("tracks the current frame and holds the last one of a one-shot", () => {
		const p = new AnimationPlayer(new Map());
		p.play("duelSwing");
		expect(p.frameName()).toBe("duel.swing.0");
		p.update(300);
		expect(p.frameName()).toBe("duel.swing.1");
		p.update(1000);
		expect(p.frameName()).toBe("duel.swing.1");
		expect(p.done).toBe(true);
	});
});
