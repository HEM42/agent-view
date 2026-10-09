import type { DuelInfo } from "../shared/duel-timeline";
import type { RoomState, ScoreRow, Snapshot } from "../shared/types";

/**
 * The daemon's wire format (spec: "Protocol (api: 1)"). Everything here is
 * pure so both ends — daemon and clients — share one definition.
 */
export const API_VERSION = 1;
export const DEFAULT_PORT = 47371;

/** Full state, sent on connect, on every poller emit and as the heartbeat. */
export interface WorldMessage {
	t: "world";
	api: number;
	snapshot: Snapshot;
	world: RoomState;
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
	| { kind: "world"; snapshot: Snapshot; world: Record<string, unknown> }
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

export function worldMessage(snapshot: Snapshot, world: RoomState): WorldMessage {
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

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function duelOf(v: unknown): DuelInfo | null {
	if (!isObject(v)) return null;
	const { id, a, b, centerX, clashes, winner, startAt } = v;
	if (typeof id !== "string" || typeof a !== "string" || typeof b !== "string" || typeof winner !== "string") return null;
	if (!isFiniteNum(centerX) || !isFiniteNum(clashes) || !isFiniteNum(startAt)) return null;
	return { id, a, b, centerX, clashes, winner, startAt };
}

function rowOf(v: unknown): ScoreRow | null {
	if (!isObject(v)) return null;
	const { key, agent, project, wins, losses } = v;
	if (typeof key !== "string" || typeof agent !== "string" || typeof project !== "string") return null;
	if (!Number.isInteger(wins) || !Number.isInteger(losses)) return null;
	return { key, agent, project, wins: wins as number, losses: losses as number };
}

/**
 * The shared room out of a received world, or null when the daemon sent none
 * (no `scores` array: an older daemon), in which case clients keep local duels.
 * A malformed duel becomes null; malformed rows are dropped.
 */
export function roomOf(world: unknown): RoomState | null {
	if (!isObject(world) || !Array.isArray(world["scores"])) return null;
	const scores = world["scores"].map(rowOf).filter((r): r is ScoreRow => r !== null);
	return { duel: duelOf(world["duel"]), scores };
}
