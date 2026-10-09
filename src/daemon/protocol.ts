import type { Snapshot } from "../shared/types";

/**
 * The daemon's wire format (spec: "Protocol (api: 1)"). Everything here is
 * pure so both ends — daemon and clients — share one definition.
 */
export const API_VERSION = 1;
export const DEFAULT_PORT = 47371;

/** Shared room state beyond the agent list. Empty for now; duels and seats add fields. */
export type World = Record<string, unknown>;

/** Full state, sent on connect, on every poller emit and as the heartbeat. */
export interface WorldMessage {
	t: "world";
	api: number;
	snapshot: Snapshot;
	world: World;
}

export interface Reply {
	t: "reply";
	id: string;
	ok: boolean;
	error?: string;
	data?: unknown;
}

export type ClientMessage =
	| { kind: "hello"; client: string; version: string }
	| { kind: "request"; t: string; id: string; args: Record<string, unknown> }
	| { kind: "invalid"; error: string; id?: string };

export type ServerMessage =
	| { kind: "world"; snapshot: Snapshot; world: World }
	| { kind: "incompatible"; api: unknown }
	| { kind: "reply"; reply: Reply }
	| { kind: "invalid" };

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

export function worldMessage(snapshot: Snapshot, world: World): WorldMessage {
	return { t: "world", api: API_VERSION, snapshot, world };
}

export function parseClientMessage(text: string): ClientMessage {
	const v = parseJson(text);
	if (v === undefined) return { kind: "invalid", error: "not json" };
	if (!isObject(v)) return { kind: "invalid", error: "not an object" };
	const id = typeof v["id"] === "string" ? v["id"] : undefined;
	const t = v["t"];
	if (typeof t !== "string" || !t) {
		return { kind: "invalid", error: "missing t", ...(id !== undefined ? { id } : {}) };
	}
	if (t === "hello") {
		const client = v["client"];
		const version = v["version"];
		if (typeof client !== "string" || typeof version !== "string") return { kind: "invalid", error: "bad hello" };
		return { kind: "hello", client, version };
	}
	if (id === undefined) return { kind: "invalid", error: "request without id" };
	const args: Record<string, unknown> = { ...v };
	delete args["t"];
	delete args["id"];
	return { kind: "request", t, id, args };
}

function isSnapshot(v: unknown): v is Snapshot {
	return isObject(v) && typeof v["herdrOnline"] === "boolean" && Array.isArray(v["agents"]) && typeof v["ts"] === "number";
}

export function parseServerMessage(text: string): ServerMessage {
	const v = parseJson(text);
	if (!isObject(v)) return { kind: "invalid" };
	if (v["t"] === "world") {
		if (v["api"] !== API_VERSION) return { kind: "incompatible", api: v["api"] };
		const snapshot = v["snapshot"];
		if (!isSnapshot(snapshot)) return { kind: "invalid" };
		return { kind: "world", snapshot, world: isObject(v["world"]) ? v["world"] : {} };
	}
	if (v["t"] === "reply" && typeof v["id"] === "string" && typeof v["ok"] === "boolean") {
		const reply: Reply = { t: "reply", id: v["id"], ok: v["ok"] };
		if (typeof v["error"] === "string") reply.error = v["error"];
		if ("data" in v) reply.data = v["data"];
		return { kind: "reply", reply };
	}
	return { kind: "invalid" };
}

/** AGENT_VIEW_PORT when it is a whole number in 1..65535, else the default. */
export function daemonPort(env: Record<string, string | undefined>): number {
	const raw = env["AGENT_VIEW_PORT"] ?? "";
	const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
	return n >= 1 && n <= 65535 ? n : DEFAULT_PORT;
}
