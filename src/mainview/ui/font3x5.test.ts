import { describe, expect, test } from "bun:test";
import { GLYPHS, textWidth } from "./font3x5";

describe("font3x5", () => {
	test("has a + glyph for the drone overflow tag", () => {
		expect(GLYPHS["+"]).toEqual(["000", "010", "111", "010", "000"]);
		expect(textWidth("+12")).toBe(11);
	});
});
