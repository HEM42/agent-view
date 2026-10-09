import { afterEach, expect, test } from "bun:test";
import type { AgentSource, RawAgent } from "../bun/herdr";
import { HerdrError } from "../bun/herdr";
import { startDaemon, type Daemon } from "./daemon";
import { TestSocket, waitFor } from "./testing";

const daemons: Daemon[] = [];
afterEach(() => {
	for (const d of daemons.splice(0)) d.stop();
});

const AGENT: RawAgent = {
	terminal_id: "term_1",
	pane_id: "",
	agent: "claude",
	status: "working",
	cwd: "/x/nordlink",
	focused: false,
	subagents: [],
};

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

test("pushes each agent's subagents to WebSocket clients", async () => {
	const source = new ScriptedSource();
	const subagents = [{ id: "a1", type: "Explore", startedAt: 1_800_000_000_000, description: "probe the folder" }];
	source.agents = [{ ...AGENT, pane_id: "wV:p2", subagents }];
	const d = startDaemon({ port: 0, source, version: "t", log: () => {} });
	daemons.push(d);

	const c = new TestSocket(`ws://127.0.0.1:${d.port}/v1/ws`);
	await c.opened();
	await waitFor(() => c.messages.some((m) => m.t === "world" && m.snapshot.agents.length === 1));
	const world = c.messages.find((m) => m.t === "world" && m.snapshot.agents.length === 1);
	expect(world.snapshot.agents[0].subagents).toEqual(subagents);
	c.close();
});
