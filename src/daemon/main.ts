import { FakeSource } from "../shared/fake";
import { HerdrCliSource } from "../bun/herdr";
import { SubagentStore } from "../bun/subagents";
import { VERSION } from "../shared/version";
import { homedir } from "node:os";
import { paths } from "../bun/daemon-setup";
import { startDaemon, stamp } from "./daemon";
import { daemonPort } from "./protocol";
import { isAddrInUse } from "./server";

/** agent-view-daemon: `bun run daemon` in a terminal, or a bundled copy under launchd. */
const fakeMode = process.env["HERDR_FAKE"];
const port = daemonPort(process.env);
const source = fakeMode
	? new FakeSource(fakeMode)
	: new HerdrCliSource(new SubagentStore());

try {
	startDaemon({
		port,
		source,
		version: VERSION,
		scoresPath: fakeMode ? null : `${paths(homedir()).state}/scores.json`,
	});
} catch (e) {
	if (isAddrInUse(e)) {
		stamp(`EADDRINUSE on 127.0.0.1:${port}`);
		process.exit(1); // launchd retries after its throttle interval
	}
	throw e;
}
stamp(`agent-view-daemon ${VERSION} on 127.0.0.1:${port} (${fakeMode ? `fake:${fakeMode}` : "live herdr"})`);
