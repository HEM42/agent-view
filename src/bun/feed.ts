import { CString, dlopen, FFIType, read, type Pointer } from "bun:ffi";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PW_DIR_OFFSET = 48; // struct passwd.pw_dir on 64-bit Darwin

/**
 * The home from the password database, like HerdrBridge.realHome()
 * (getpwuid(getuid())->pw_dir). Under Bun, os.homedir() and even
 * os.userInfo() follow $HOME, which would publish where the saver never looks.
 */
export function passwdHome(): string {
	try {
		const libc = dlopen("/usr/lib/libSystem.B.dylib", {
			getuid: { args: [], returns: FFIType.u32 },
			getpwuid: { args: [FFIType.u32], returns: FFIType.ptr },
		});
		try {
			const pw = libc.symbols.getpwuid(libc.symbols.getuid());
			const dir = pw ? read.ptr(pw, PW_DIR_OFFSET) : 0;
			return dir ? new CString(dir as Pointer).toString() : homedir();
		} finally {
			libc.close();
		}
	} catch {
		return homedir(); // not macOS / no FFI: best effort
	}
}

/**
 * The screensaver's sandbox denies herdr's socket, so the daemon publishes every
 * good `herdr agent list` here and the saver reads it (saver/HerdrBridge.swift).
 */
export const FEED_PATH = join(
	passwdHome(),
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
