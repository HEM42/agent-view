import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The screensaver's sandbox denies herdr's socket, so the daemon publishes every
 * good `herdr agent list` here and the saver reads it (saver/HerdrBridge.swift).
 */
export const FEED_PATH = join(
	homedir(),
	"Library",
	"Application Support",
	"Agent View",
	"agents.json",
);

let lastError = "";
let tmpCounter = 0;

/** Atomic: a reader sees the old file or the new one, never half of one. */
export async function publishFeed(stdout: string, path = FEED_PATH): Promise<void> {
	const tmp = `${path}.${process.pid}.${tmpCounter++}.tmp`;
	try {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(tmp, stdout);
		await rename(tmp, path);
		lastError = "";
	} catch (e: any) {
		// the feed is a side channel: it must never disturb polling
		const msg = String(e?.code ?? e?.message ?? e);
		if (msg !== lastError) {
			lastError = msg;
			console.warn(`[feed] could not publish ${path}: ${msg}`);
		}
		await unlink(tmp).catch(() => {});
	}
}
