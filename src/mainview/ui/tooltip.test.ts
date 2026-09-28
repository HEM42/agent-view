import { describe, expect, test } from "bun:test";
import { droneTooltip, escapeHtml, fmtDuration, moreTooltip } from "./tooltip";

describe("tooltip", () => {
	test("fmtDuration formats and never goes negative", () => {
		expect(fmtDuration(12_000)).toBe("12s");
		expect(fmtDuration(192_000)).toBe("3m 12s");
		expect(fmtDuration(3_720_000)).toBe("1h 2m");
		expect(fmtDuration(-5000)).toBe("0s");
	});

	test("escapeHtml neutralizes markup", () => {
		expect(escapeHtml(`<img src=x onerror="a()"> & 'b'`)).toBe("&lt;img src=x onerror=&quot;a()&quot;&gt; &amp; &#39;b&#39;");
	});

	test("drone tooltip: type · model, description, runtime, parent", () => {
		const html = droneTooltip(
			{ type: "Explore", model: "haiku", description: "probe the folder", startedAt: 1000 },
			{ agent: "claude", project: "mymen" },
			1000 + 192_000,
		);
		expect(html).toBe(
			[
				`<span class="k">Explore · haiku</span>`,
				"probe the folder",
				"running 3m 12s",
				"subagent of claude · mymen",
				`<span class="k">double-click</span> to focus parent`,
			].join("<br>"),
		);
	});

	test("unknown model/description/parent lines are left out; text is escaped", () => {
		const html = droneTooltip({ type: "<b>x</b>", startedAt: 0 }, null, 5000);
		expect(html).toBe(
			[`<span class="k">&lt;b&gt;x&lt;/b&gt;</span>`, "running 5s", `<span class="k">double-click</span> to focus parent`].join(
				"<br>",
			),
		);
		expect(droneTooltip({ type: "x", description: "<script>", startedAt: 0 }, null, 0)).toContain("&lt;script&gt;");
	});

	test("+N tooltip counts hidden types, most common first", () => {
		expect(moreTooltip([{ type: "Explore" }, { type: "general-purpose" }, { type: "general-purpose" }])).toBe(
			`<span class="k">3 more:</span> general-purpose ×2, Explore<br><span class="k">double-click</span> to focus parent`,
		);
	});
});
