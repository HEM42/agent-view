import Foundation
import os

/// The saver's line to the Agent View daemon. The saver sandbox allows
/// outbound loopback connections (probed 2026-10-09), and URLSession sends no
/// Origin header, which the daemon requires of non-browser clients. Every
/// text frame goes to `onMessage` on the main queue; the page judges it.
/// All state lives on the main queue (timer, receive callbacks hop there).
final class DaemonLink {
	private static let log = Logger(subsystem: "com.cygnisec.agentview.saver", category: "daemon")
	static let url = URL(string: "ws://127.0.0.1:47371/v1/ws")!
	/// The daemon sends a world at least every second.
	private static let deadAfter: TimeInterval = 3
	private static let backoffMin: TimeInterval = 0.5
	private static let backoffMax: TimeInterval = 5
	/// One per process, not per kept-alive view.
	private static let session = URLSession(configuration: .ephemeral)

	private let onMessage: (String) -> Void
	private var task: URLSessionWebSocketTask?
	/// Bumped on every connect and drop: callbacks from an older socket are ignored.
	private var generation = 0
	private var running = false
	private var lastFrameAt = Date.distantPast
	private var openedAt = Date.distantPast
	private var lastTickAt = Date.distantPast
	private var backoff = DaemonLink.backoffMin
	private var watchdog: Timer?
	private var reconnect: DispatchWorkItem?
	private var lastOutcome = ""

	init(onMessage: @escaping (String) -> Void) {
		self.onMessage = onMessage
	}

	deinit {
		watchdog?.invalidate()
		task?.cancel(with: .goingAway, reason: nil)
	}

	/// Main queue. Idempotent.
	func start() {
		guard !running else { return }
		running = true
		// legacyScreenSaver keeps instances alive across activations, so each start must log its own outcome
		lastOutcome = ""
		backoff = Self.backoffMin
		lastTickAt = Date()
		let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in self?.tick() }
		RunLoop.main.add(timer, forMode: .common)
		watchdog = timer
		connect()
	}

	/// Main queue. The saver stopped: close the socket, nothing reconnects.
	func stop() {
		running = false
		watchdog?.invalidate()
		watchdog = nil
		reconnect?.cancel()
		reconnect = nil
		drop()
	}

	private func connect() {
		guard running else { return }
		generation += 1
		let gen = generation
		let t = Self.session.webSocketTask(with: Self.url)
		task = t
		openedAt = Date()
		t.resume()
		let version = Bundle(for: DaemonLink.self).object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
		t.send(.string(#"{"t":"hello","client":"saver","version":"\#(version)"}"#)) { _ in }
		receive(t, gen)
	}

	private func receive(_ t: URLSessionWebSocketTask, _ gen: Int) {
		t.receive { [weak self] result in
			DispatchQueue.main.async {
				guard let self, gen == self.generation else { return }
				switch result {
				case .success(.string(let text)):
					self.lastFrameAt = Date()
					self.backoff = Self.backoffMin
					self.note("connected", "")
					self.onMessage(text)
					self.receive(t, gen)
				case .success:
					self.receive(t, gen) // binary frames are not part of the protocol
				case .failure(let error):
					self.note("down", error.localizedDescription)
					self.drop()
					self.scheduleReconnect()
				}
			}
		}
	}

	private func tick() {
		let now = Date()
		// a gap far beyond the timer interval: the process was suspended (sleep),
		// so the socket's silence says nothing yet — restart the clocks
		if now.timeIntervalSince(lastTickAt) > Self.deadAfter {
			lastFrameAt = now
			openedAt = now
		}
		lastTickAt = now
		guard task != nil else { return }
		if now.timeIntervalSince(max(lastFrameAt, openedAt)) > Self.deadAfter {
			note("silent", "")
			drop()
			scheduleReconnect()
		}
	}

	private func drop() {
		generation += 1
		task?.cancel(with: .goingAway, reason: nil)
		task = nil
	}

	private func scheduleReconnect() {
		guard running, reconnect == nil else { return }
		let delay = backoff
		backoff = min(backoff * 2, Self.backoffMax)
		let item = DispatchWorkItem { [weak self] in
			self?.reconnect = nil
			self?.connect()
		}
		reconnect = item
		DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
	}

	/// Log only when the outcome kind changes, not once per frame.
	private func note(_ outcome: String, _ detail: String) {
		guard outcome != lastOutcome else { return }
		lastOutcome = outcome
		Self.log.notice("daemon: \(outcome, privacy: .public) \(detail, privacy: .public)")
	}
}
