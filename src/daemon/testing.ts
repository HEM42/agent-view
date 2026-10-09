import { connect } from "node:net";
import type { Snapshot } from "../shared/types";
import type { SnapshotFeed } from "./server";

/** Test-only helpers for the daemon and its clients. Never imported by app code. */

export const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ herdrOnline: true, agents: [], ts: 1, ...over });

/** A feed the test drives by hand: emit() plays the poller, focusResult scripts focus. */
export function manualFeed(initial: Snapshot = snap()) {
	let last = initial;
	const subs: ((s: Snapshot) => void)[] = [];
	const state = {
		focused: [] as string[],
		focusResult: { ok: true } as { ok: boolean; error?: string } | "hang",
		feed: {
			last: () => last,
			subscribe: (fn: (s: Snapshot) => void) => {
				subs.push(fn);
			},
			focus: (id: string) => {
				state.focused.push(id);
				const r = state.focusResult;
				return r === "hang" ? new Promise<never>(() => {}) : Promise.resolve(r);
			},
		} satisfies SnapshotFeed,
		emit(s: Snapshot) {
			last = s;
			for (const fn of subs) fn(s);
		},
	};
	return state;
}

export async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
	const end = Date.now() + ms;
	while (!cond()) {
		if (Date.now() > end) throw new Error("waitFor timed out");
		await Bun.sleep(10);
	}
}

/** Raw HTTP/1.1 over TCP, so tests control Host and Origin exactly. Resolves to the status line. */
export function rawRequest(port: number, lines: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		let buf = "";
		const sock = connect(port, "127.0.0.1", () => sock.write([...lines, "", ""].join("\r\n")));
		sock.on("data", (d) => {
			buf += d.toString();
			const end = buf.indexOf("\r\n");
			if (end >= 0) {
				sock.destroy();
				resolve(buf.slice(0, end));
			}
		});
		sock.on("error", reject);
	});
}

/** WebSocket client that records every parsed message. */
export class TestSocket {
	messages: any[] = [];
	closed = false;
	private ws: WebSocket;
	private openPromise: Promise<void>;

	constructor(url: string) {
		this.ws = new WebSocket(url);
		this.openPromise = new Promise((resolve, reject) => {
			this.ws.onopen = () => resolve();
			this.ws.onerror = () => reject(new Error("socket error"));
		});
		this.ws.onmessage = (ev) => this.messages.push(JSON.parse(String(ev.data)));
		this.ws.onclose = () => {
			this.closed = true;
		};
	}

	opened(): Promise<void> {
		return this.openPromise;
	}

	send(v: unknown): void {
		this.ws.send(typeof v === "string" ? v : JSON.stringify(v));
	}

	sendBinary(bytes: Uint8Array): void {
		this.ws.send(bytes);
	}

	close(): void {
		this.ws.close();
	}
}
