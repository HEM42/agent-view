import Foundation
import WebKit
import os

/// Hands the page the herdr feed the Agent View daemon publishes. The saver
/// sandbox denies herdr's socket, so nothing is spawned here. The host's
/// HOME points into its sandbox container, so the real home comes from the
/// password database.
final class HerdrBridge: NSObject, WKScriptMessageHandlerWithReply {
	private static let log = Logger(subsystem: "com.cygnisec.agentview.saver", category: "bridge")
	/// The daemon rewrites the feed every second while herdr is up.
	private static let maxAge: TimeInterval = 3
	private let queue = DispatchQueue(label: "com.cygnisec.agentview.saver.feed")
	private let feedPath = HerdrBridge.realHome() + "/Library/Application Support/Agent View/agents.json"
	private var lastOutcome = ""

	func userContentController(
		_ userContentController: WKUserContentController,
		didReceive message: WKScriptMessage,
		replyHandler: @escaping (Any?, String?) -> Void
	) {
		queue.async {
			let reply = self.readFeed()
			DispatchQueue.main.async { replyHandler(reply, nil) }
		}
	}

	static func realHome() -> String {
		if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
			return String(cString: dir)
		}
		return NSHomeDirectory()
	}

	private func readFeed() -> [String: Any] {
		let fm = FileManager.default
		guard fm.fileExists(atPath: feedPath) else {
			note("missing", "")
			return ["error": "missing"]
		}
		do {
			let attrs = try fm.attributesOfItem(atPath: feedPath)
			let mtime = attrs[.modificationDate] as? Date ?? .distantPast
			let age = Date().timeIntervalSince(mtime)
			guard age <= Self.maxAge else {
				note("stale", String(format: "%.0fs old", age))
				return ["error": "stale"]
			}
			let stdout = try String(contentsOfFile: feedPath, encoding: .utf8)
			note("ok", "")
			return ["code": 0, "stdout": stdout]
		} catch {
			note("unreadable", error.localizedDescription)
			return ["error": "unreadable", "message": error.localizedDescription]
		}
	}

	/// Log only when the outcome kind changes, not once per second.
	private func note(_ outcome: String, _ detail: String) {
		guard outcome != lastOutcome else { return }
		lastOutcome = outcome
		Self.log.notice("feed: \(outcome, privacy: .public) \(detail, privacy: .public)")
	}
}
