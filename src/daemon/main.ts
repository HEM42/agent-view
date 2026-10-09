import { FakeSource } from "../bun/fake";
import { HerdrCliSource } from "../bun/herdr";
import { VERSION } from "../shared/version";
import { startDaemon, stamp } from "./daemon";
import { daemonPort } from "./protocol";
import { isAddrInUse } from "./server";

/** agent-view-daemon: `bun run daemon` in a terminal, or the compiled binary under launchd. */
const fakeMode = process.env["HERDR_FAKE"];
const port = daemonPort(process.env);

try {
	startDaemon({ port, source: fakeMode ? new FakeSource(fakeMode) : new HerdrCliSource(), version: VERSION });
} catch (e) {
	if (isAddrInUse(e)) {
		stamp(`EADDRINUSE on 127.0.0.1:${port}`);
		process.exit(1); // launchd retries after its throttle interval
	}
	throw e;
}
stamp(`agent-view-daemon ${VERSION} on 127.0.0.1:${port} (${fakeMode ? `fake:${fakeMode}` : "live herdr"})`);
