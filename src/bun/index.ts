import { BrowserView, BrowserWindow, Utils } from "electrobun/bun";
import { startDaemon } from "../daemon/daemon";
import { daemonPort } from "../daemon/protocol";
import type { AgentViewRPC, Snapshot } from "../shared/types";
import { VERSION } from "../shared/version";
import { DaemonClient } from "./daemon-client";
import { FakeSource } from "./fake";

const fakeMode = process.env["HERDR_FAKE"];
// fake mode runs its own daemon in this process, one port above the installed one
const port = daemonPort(process.env) + (fakeMode ? 1 : 0);
if (fakeMode) {
	try {
		startDaemon({ port, source: new FakeSource(fakeMode), version: VERSION });
	} catch (e: any) {
		console.warn(`[app] fake daemon not started on 127.0.0.1:${port}: ${e?.message ?? e}`);
	}
}

let win: BrowserWindow<typeof rpc>;

const client = new DaemonClient({
	url: `ws://127.0.0.1:${port}/v1/ws`,
	client: "app",
	version: VERSION,
	onSnapshot: (snap: Snapshot) => {
		try {
			rpc.send.snapshot(snap);
		} catch {
			// webview not ready yet; it pulls via getSnapshot on load
		}
	},
});

const rpc = BrowserView.defineRPC<AgentViewRPC>({
	maxRequestTime: 5000,
	handlers: {
		requests: {
			focusAgent: async ({ id }: { id: string }) => {
				console.log(`[rpc] focusAgent(${id})`);
				const r = await client.request("focus", { agent: id });
				return r.ok ? { ok: true } : { ok: false, error: r.error ?? "focus failed" };
			},
			getSnapshot: () => {
				console.log("[rpc] getSnapshot — webview connected");
				return client.lastSnapshot();
			},
			saveShot: async ({ dataUrl }: { dataUrl: string }) => {
				const dest = process.env["AGENTVIEW_SHOT"];
				if (!dest) return { ok: false };
				const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
				await Bun.write(dest, new Uint8Array(Buffer.from(b64, "base64")));
				console.log(`[dev] frame dumped to ${dest}`);
				return { ok: true };
			},
		},
		messages: {
			setAlwaysOnTop: ({ value }: { value: boolean }) => {
				win.setAlwaysOnTop(value);
			},
			quitApp: () => {
				Utils.quit();
			},
		},
	},
});

// Virtual scene is 384x216; chrome adds 10px border + 30px title bar.
// 1172x682 ⇒ canvas area 1152x648 = exact 3x integer scale.
win = new BrowserWindow({
	title: "Agent View",
	url: "views://mainview/index.html",
	frame: { width: 1172, height: 682, x: 120, y: 120 },
	titleBarStyle: "hidden", // no native titlebar/controls: fully custom chrome
	transparent: true,
	rpc,
});

client.start();

console.log(`Agent View started (daemon ws://127.0.0.1:${port}${fakeMode ? `, fake:${fakeMode} in-process` : ""})`);
