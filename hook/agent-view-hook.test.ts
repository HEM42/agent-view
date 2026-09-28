import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizePaneId } from "../src/bun/subagents";

const HOOK = join(import.meta.dir, "agent-view-hook.sh");

// Shapes captured from Claude Code 2.1.283 on 2026-09-28 (paths anonymized). Compact JSON, like Claude sends.
const SID = "19a1572d-3c89-41ef-8eea-7171bd698c71";
const AID = "afb6f25f3daf9db10";
const TP = `/Users/john/.claude/projects/-Users-john-Projects-demo/${SID}.jsonl`;
const CWD = "/Users/john/Projects/demo";
const P = {
	sessionStart: JSON.stringify({
		session_id: SID,
		transcript_path: TP,
		cwd: CWD,
		hook_event_name: "SessionStart",
		source: "startup",
	}),
	subagentStart: JSON.stringify({
		session_id: SID,
		transcript_path: TP,
		cwd: CWD,
		prompt_id: "99cdd5ae-77df-4ae1-86ae-13315d77a1ba",
		agent_id: AID,
		agent_type: "Explore",
		hook_event_name: "SubagentStart",
	}),
	subagentToolUse: JSON.stringify({
		session_id: SID,
		transcript_path: TP,
		cwd: CWD,
		permission_mode: "default",
		agent_id: AID,
		agent_type: "Explore",
		hook_event_name: "PreToolUse",
		tool_name: "Read",
		tool_input: { file_path: `${CWD}/sample.txt` },
		tool_use_id: "toolu_01UfBZ22hVhwr1qDVjsK3D7a",
	}),
	parentToolUse: (content: string) =>
		JSON.stringify({
			session_id: SID,
			transcript_path: TP,
			cwd: CWD,
			permission_mode: "default",
			hook_event_name: "PreToolUse",
			tool_name: "Write",
			tool_input: { file_path: `${CWD}/notes.md`, content },
			tool_use_id: "toolu_x",
		}),
	subagentStop: JSON.stringify({
		session_id: SID,
		transcript_path: TP,
		cwd: CWD,
		permission_mode: "default",
		agent_id: AID,
		agent_type: "Explore",
		hook_event_name: "SubagentStop",
		stop_hook_active: false,
		agent_transcript_path: `${TP.slice(0, -6)}/subagents/agent-${AID}.jsonl`,
		last_assistant_message: "The file contains hi",
		background_tasks: [
			{ id: AID, type: "subagent", status: "running", description: "probe the folder", agent_type: "Explore" },
		],
	}),
	sessionEnd: JSON.stringify({
		session_id: SID,
		transcript_path: TP,
		cwd: CWD,
		hook_event_name: "SessionEnd",
		reason: "other",
	}),
};

let home: string;
const root = () => join(home, "Library", "Application Support", "Agent View", "subagents");
const paneDir = (pane = "wV:p2") => join(root(), sanitizePaneId(pane));

async function hook(event: string, payload: string, env: Record<string, string> = {}): Promise<number> {
	const proc = Bun.spawn(["sh", HOOK, event], {
		stdin: new Blob([payload]),
		stdout: "ignore",
		stderr: "ignore",
		env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: home, HERDR_PANE_ID: "wV:p2", ...env },
	});
	return await proc.exited;
}

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "agentview-hook-"));
});
afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

describe("agent-view-hook.sh", () => {
	test("SessionStart and SubagentStart write their payloads", async () => {
		expect(await hook("SessionStart", P.sessionStart)).toBe(0);
		expect(await hook("SubagentStart", P.subagentStart)).toBe(0);
		expect(JSON.parse(await readFile(join(paneDir(), `session-${SID}.json`), "utf8")).session_id).toBe(SID);
		expect(JSON.parse(await readFile(join(paneDir(), `${AID}.start.json`), "utf8")).agent_type).toBe("Explore");
		expect((await readdir(paneDir())).filter((n) => n.startsWith("."))).toEqual([]); // no temp files left
	});

	test("PreToolUse inside a known subagent touches its heartbeat", async () => {
		await hook("SubagentStart", P.subagentStart);
		expect(await hook("PreToolUse", P.subagentToolUse)).toBe(0);
		expect(existsSync(join(paneDir(), `${AID}.alive`))).toBe(true);
	});

	test("PreToolUse for an unknown agent_id does nothing", async () => {
		expect(await hook("PreToolUse", P.subagentToolUse)).toBe(0);
		expect(existsSync(join(paneDir(), `${AID}.alive`))).toBe(false);
	});

	test("an agent_id inside the parent's tool input never counts", async () => {
		await hook("SubagentStart", P.subagentStart);
		expect(await hook("PreToolUse", P.parentToolUse(`{"agent_id":"${AID}"}`))).toBe(0);
		expect(existsSync(join(paneDir(), `${AID}.alive`))).toBe(false);
	});

	test("SubagentStop removes the subagent and keeps the stop payload", async () => {
		await hook("SubagentStart", P.subagentStart);
		await hook("PreToolUse", P.subagentToolUse);
		expect(await hook("SubagentStop", P.subagentStop)).toBe(0);
		const names = await readdir(paneDir());
		expect(names).toContain("last-stop.json");
		expect(names).not.toContain(`${AID}.start.json`);
		expect(names).not.toContain(`${AID}.alive`);
	});

	test("SessionEnd removes the session's files and the then empty pane directory", async () => {
		await hook("SessionStart", P.sessionStart);
		await hook("SubagentStart", P.subagentStart);
		await hook("PreToolUse", P.subagentToolUse);
		expect(await hook("SessionEnd", P.sessionEnd)).toBe(0);
		expect(existsSync(paneDir())).toBe(false);
	});

	test("a nested session in the same pane leaves the parent's files alone", async () => {
		const CHILD = "0c1d2e3f-4a5b-6c7d-8e9f-a0b1c2d3e4f5";
		const child = (p: string) => p.replace(SID, CHILD);
		await hook("SessionStart", P.sessionStart);
		await hook("SubagentStart", P.subagentStart);
		expect(await hook("SessionStart", child(P.sessionStart))).toBe(0);
		expect(existsSync(join(paneDir(), `session-${CHILD}.json`))).toBe(true);
		expect(await hook("SessionEnd", child(P.sessionEnd))).toBe(0);
		const names = await readdir(paneDir());
		expect(names).toContain(`session-${SID}.json`);
		expect(names).toContain(`${AID}.start.json`);
		expect(names).not.toContain(`session-${CHILD}.json`);
	});

	test("session files use the sanitized session_id; without one, session events do nothing", async () => {
		await hook("SessionStart", P.sessionStart.replace(SID, "a/b c"));
		expect(await readdir(paneDir())).toEqual(["session-a_b_c.json"]);
		await hook("SubagentStart", P.subagentStart);
		expect(await hook("SessionStart", '{"hook_event_name":"SessionStart"}')).toBe(0);
		expect(await hook("SessionEnd", '{"hook_event_name":"SessionEnd"}')).toBe(0);
		expect((await readdir(paneDir())).sort()).toEqual([`${AID}.start.json`, "session-a_b_c.json"]);
	});

	test("a non-hex agent_id writes no start file", async () => {
		expect(await hook("SubagentStart", P.subagentStart.replace(AID, "AGENT-1"))).toBe(0);
		const names = existsSync(paneDir()) ? await readdir(paneDir()) : [];
		expect(names.filter((n) => n.endsWith(".start.json"))).toEqual([]);
	});

	test("no HERDR_PANE_ID: nothing is written", async () => {
		expect(await hook("SubagentStart", P.subagentStart, { HERDR_PANE_ID: "" })).toBe(0);
		expect(existsSync(root())).toBe(false);
	});

	test("garbage payloads and unknown events exit 0 and write no subagent", async () => {
		expect(await hook("SubagentStart", "not json at all")).toBe(0);
		expect(await hook("SomethingNew", P.subagentStart)).toBe(0);
		expect(await hook("", "")).toBe(0);
		const names = existsSync(paneDir()) ? await readdir(paneDir()) : [];
		expect(names.filter((n) => n.endsWith(".start.json"))).toEqual([]);
	});

	test("an unwritable data directory still exits 0", async () => {
		await mkdir(join(home, "Library", "Application Support", "Agent View"), { recursive: true });
		await writeFile(root(), "a file where the directory should be");
		expect(await hook("SessionStart", P.sessionStart)).toBe(0);
		expect(await hook("SubagentStart", P.subagentStart)).toBe(0);
	});

	test("pane directory naming matches sanitizePaneId byte for byte", async () => {
		const odd = "wV:p2 é/x";
		await hook("SessionStart", P.sessionStart, { HERDR_PANE_ID: odd });
		expect(await readdir(root())).toEqual([sanitizePaneId(odd)]);
	});
});
