import { afterEach, expect, test } from "bun:test";
import type { AgentSource, RawAgent } from "../bun/herdr";
import { HerdrError } from "../bun/herdr";
import { startDaemon, type Daemon } from "./daemon";
import { TestSocket, waitFor } from "./testing";

const daemons: Daemon[] = [];
afterEach(() => {
	for (const d of daemons.splice(0)) d.stop();
});

const AGENT: RawAgent = { terminal_id: "term_1", agent: "claude", status: "working", cwd: "/x/nordlink", focused: false };

class ScriptedSource implements AgentSource {
	agents: RawAgent[] | "down" = [AGENT];
	focused: string[] = [];
	async list(): Promise<RawAgent[]> {
		if (this.agents === "down") throw new HerdrError("not-installed", "gone");
		return this.agents;
	}
	async focus(id: string): Promise<void> {
		this.focused.push(id);
	}
}

test("serves the poller's snapshot and routes focus to the source", async () => {
	const source = new ScriptedSource();
	const d = startDaemon({ port: 0, source, version: "t", log: () => {} });
	daemons.push(d);

	let body: any = null;
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		body = await (await fetch(`http://127.0.0.1:${d.port}/v1/world`)).json();
		if (body.snapshot.agents.length === 1) break;
		await Bun.sleep(20);
	}
	expect(body.snapshot.agents).toHaveLength(1);
	expect(body.snapshot.agents[0]).toMatchObject({ id: "term_1", project: "nordlink", status: "working" });

	const c = new TestSocket(`ws://127.0.0.1:${d.port}/v1/ws`);
	await c.opened();
	c.send({ t: "focus", id: "f1", agent: "term_1" });
	await waitFor(() => c.messages.some((m) => m.t === "reply"));
	expect(c.messages.find((m) => m.t === "reply")).toEqual({ t: "reply", id: "f1", ok: true });
	expect(source.focused).toEqual(["term_1"]);
	c.close();
});

test("logs herdr going offline once, not every tick", async () => {
	const source = new ScriptedSource();
	source.agents = "down";
	const log: string[] = [];
	const d = startDaemon({ port: 0, source, version: "t", log: (m) => log.push(m) });
	daemons.push(d);
	await waitFor(() => log.some((l) => l.includes("herdr offline (not-installed)")));
	await Bun.sleep(50);
	expect(log.filter((l) => l.startsWith("herdr")).length).toBe(1);
});
