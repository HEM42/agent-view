import { describe, expect, test } from "bun:test";
import { DESKS } from "./layout";
import { SlotManager } from "./slots";

describe("SlotManager.ownDesk", () => {
	test("owns the first free desk without sitting down; idempotent", () => {
		const s = new SlotManager();
		expect(s.ownDesk("a")).toBe(DESKS[0]!.id);
		expect(s.ownDesk("a")).toBe(DESKS[0]!.id);
		expect(s.byId(DESKS[0]!.id)!.occupiedBy).toBeNull();
		expect(s.ownedDesk("a")).toBe(DESKS[0]!.id);
		expect(s.desksInUse()).toBe(1);
	});

	test("a later claimDesk sits at the owned desk; others skip it", () => {
		const s = new SlotManager();
		s.ownDesk("a");
		expect(s.claimDesk("b")!.id).toBe(DESKS[1]!.id);
		expect(s.claimDesk("a")!.id).toBe(DESKS[0]!.id);
	});

	test("null when all desks are owned", () => {
		const s = new SlotManager();
		DESKS.forEach((_, i) => s.ownDesk(`c${i}`));
		expect(s.ownDesk("late")).toBeNull();
		expect(s.ownedDesk("late")).toBeNull();
	});
});
