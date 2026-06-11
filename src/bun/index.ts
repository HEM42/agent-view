import { BrowserView, BrowserWindow, Utils } from "electrobun/bun";
import type { AgentViewRPC, Snapshot } from "../shared/types";
import { FakeSource } from "./fake";
import { HerdrCliSource, HerdrPoller } from "./herdr";

const fakeMode = process.env["HERDR_FAKE"];
const source = fakeMode ? new FakeSource(fakeMode) : new HerdrCliSource();

let win: BrowserWindow<typeof rpc>;
let poller: HerdrPoller;

const rpc = BrowserView.defineRPC<AgentViewRPC>({
	maxRequestTime: 5000,
	handlers: {
		requests: {
			focusAgent: ({ id }: { id: string }) => {
				console.log(`[rpc] focusAgent(${id})`);
				return poller.focus(id);
			},
			getSnapshot: () => {
				console.log("[rpc] getSnapshot — webview connected");
				return poller.lastSnapshot();
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

poller = new HerdrPoller(source, (snap: Snapshot) => {
	try {
		rpc.send.snapshot(snap);
	} catch {
		// webview not ready yet; it pulls via getSnapshot on load
	}
});
void poller.start();

console.log(
	`Agent View started (${fakeMode ? `fake:${fakeMode}` : "live herdr"})`,
);
