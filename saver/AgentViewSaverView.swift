import ScreenSaver
import WebKit

@objc(AgentViewSaverView)
final class AgentViewSaverView: ScreenSaverView {
	private var webView: WKWebView?
	private var stopObserver: NSObjectProtocol?

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
			content.addScriptMessageHandler(HerdrBridge(), contentWorld: .page, name: "herdr")
		}
		let web = WKWebView(frame: bounds, configuration: config)
		web.autoresizingMask = [.width, .height]
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
		webView?.evaluateJavaScript("window.saver && window.saver.resume()")
	}

	override func stopAnimation() {
		super.stopAnimation()
		pause()
	}

	override func animateOneFrame() {}

	override var hasConfigureSheet: Bool { false }

	private func pause() {
		webView?.evaluateJavaScript("window.saver && window.saver.pause()")
	}
}
