import ScreenSaver
import WebKit
import os

@objc(AgentViewSaverView)
final class AgentViewSaverView: ScreenSaverView, WKNavigationDelegate {
	private static let log = Logger(subsystem: "com.cygnisec.agentview.saver", category: "view")
	private var webView: WKWebView?
	private var stopObserver: NSObjectProtocol?
	/// True while the saver is stopped: a page that (re)loads while paused
	/// must not start animating before the next startAnimation().
	private var paused = true
	private var link: DaemonLink?

	override init?(frame: NSRect, isPreview: Bool) {
		super.init(frame: frame, isPreview: isPreview)
		setUp(preview: isPreview)
	}

	required init?(coder: NSCoder) {
		super.init(coder: coder)
		setUp(preview: false)
	}

	deinit {
		if let stopObserver { DistributedNotificationCenter.default().removeObserver(stopObserver) }
		link?.stop()
	}

	private func setUp(preview: Bool) {
		animationTimeInterval = 1 // the page animates itself; animateOneFrame is a no-op
		let config = WKWebViewConfiguration()
		let content = config.userContentController
		if preview {
			content.addUserScript(WKUserScript(
				source: "window.AGENTVIEW_PREVIEW = true;",
				injectionTime: .atDocumentStart,
				forMainFrameOnly: true
			))
		} else {
			link = DaemonLink { [weak self] text in self?.deliver(text) }
		}
		let web = WKWebView(frame: bounds, configuration: config)
		// legacyScreenSaver's window is visible, but WebKit's occlusion tracking
		// marks the page hidden there: no requestAnimationFrame, throttled timers,
		// a blank screen. Private SPI; skipped if a future WebKit drops it.
		if web.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")) {
			web.setValue(false, forKey: "windowOcclusionDetectionEnabled")
		} else {
			Self.log.notice("occlusion SPI unavailable, page may not animate")
		}
		web.autoresizingMask = [.width, .height]
		web.navigationDelegate = self
		addSubview(web)
		let root = Bundle(for: Self.self).resourceURL!.appendingPathComponent("web")
		web.loadFileURL(root.appendingPathComponent("saver.html"), allowingReadAccessTo: root)
		webView = web

		// legacyScreenSaver often keeps instances alive after dismissal
		stopObserver = DistributedNotificationCenter.default().addObserver(
			forName: Notification.Name("com.apple.screensaver.willstop"),
			object: nil,
			queue: .main
		) { [weak self] _ in self?.pause() }
	}

	override func startAnimation() {
		super.startAnimation()
		paused = false
		webView?.evaluateJavaScript("window.saver && window.saver.resume()")
		link?.start()
	}

	override func stopAnimation() {
		super.stopAnimation()
		pause()
	}

	override func animateOneFrame() {}

	override var hasConfigureSheet: Bool { false }

	private func pause() {
		link?.stop()
		paused = true
		webView?.evaluateJavaScript("window.saver && window.saver.pause()")
	}

	/// One daemon frame into the page; the page decides live vs demo.
	private func deliver(_ text: String) {
		guard !paused, let webView else { return }
		webView.callAsyncJavaScript(
			"window.saver && window.saver.world(msg)",
			arguments: ["msg": text],
			in: nil,
			in: .page,
			completionHandler: nil
		)
	}

	// MARK: - WKNavigationDelegate

	func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
		// a (re)load that lands while we're paused (page load raced pause, or
		// the web content process was restarted) must not come up animating
		if paused {
			webView.evaluateJavaScript("window.saver && window.saver.pause()")
		}
	}

	func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
		Self.log.notice("web content process terminated, reloading")
		webView.reload()
	}
}
