import Foundation
import WebKit
import os

/// Runs `herdr agent list` for the page. Mirrors resolveHerdrBin() in
/// src/bun/herdr.ts; the saver host's HOME points into its sandbox
/// container, so the real home comes from the password database.
final class HerdrBridge: NSObject, WKScriptMessageHandlerWithReply {
	private static let log = Logger(subsystem: "com.cygnisec.agentview.saver", category: "bridge")
	private static let timeout: TimeInterval = 3
	private let queue = DispatchQueue(label: "com.cygnisec.agentview.saver.herdr")
	private var herdrBin: String?
	private var lastOutcome = ""

	func userContentController(
		_ userContentController: WKUserContentController,
		didReceive message: WKScriptMessage,
		replyHandler: @escaping (Any?, String?) -> Void
	) {
		queue.async {
			let reply = self.runAgentList()
			DispatchQueue.main.async { replyHandler(reply, nil) }
		}
	}

	static func realHome() -> String {
		if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
			return String(cString: dir)
		}
		return NSHomeDirectory()
	}

	private func resolve() -> String? {
		if let bin = herdrBin { return bin }
		let home = Self.realHome()
		let candidates = [
			"/opt/homebrew/bin/herdr",
			"/usr/local/bin/herdr",
			"\(home)/.local/bin/herdr",
			"\(home)/.bun/bin/herdr",
		]
		herdrBin = candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
		return herdrBin
	}

	private func runAgentList() -> [String: Any] {
		guard let bin = resolve() else {
			note("not-installed", "")
			return ["error": "not-installed"]
		}
		let proc = Process()
		proc.executableURL = URL(fileURLWithPath: bin)
		proc.arguments = ["agent", "list"]
		var env = ProcessInfo.processInfo.environment
		env["HOME"] = Self.realHome()
		env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
		proc.environment = env
		let out = Pipe()
		proc.standardOutput = out
		proc.standardError = FileHandle.nullDevice
		do {
			try proc.run()
		} catch {
			herdrBin = nil // re-resolve next time; herdr may have moved
			note("spawn-failed", error.localizedDescription)
			return ["error": "spawn-failed", "message": error.localizedDescription]
		}
		// a hung CLI must never stall the poll loop
		let killer = DispatchWorkItem {
			if proc.isRunning { kill(proc.processIdentifier, SIGKILL) }
		}
		DispatchQueue.global().asyncAfter(deadline: .now() + Self.timeout, execute: killer)
		let data = out.fileHandleForReading.readDataToEndOfFile()
		proc.waitUntilExit()
		killer.cancel()
		let code = Int(proc.terminationStatus)
		let stdout = String(decoding: data, as: UTF8.self)
		note(code == 0 ? "ok" : "exit \(code)", String(stdout.prefix(160)))
		return ["code": code, "stdout": stdout]
	}

	/// Log only when the outcome kind changes: live ↔ error transitions,
	/// not one line per second.
	private func note(_ outcome: String, _ detail: String) {
		guard outcome != lastOutcome else { return }
		lastOutcome = outcome
		Self.log.notice("herdr agent list: \(outcome, privacy: .public) \(detail, privacy: .public)")
	}
}
