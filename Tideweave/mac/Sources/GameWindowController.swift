import AppKit
import WebKit

// 主窗口：一个 WKWebView 加载 tideweave://app/index.html，
// 并以 window.tideweave 的形式提供与 Electron 版 preload.cjs 相同的接口，前端不用区分两种壳。
@MainActor
final class GameWindowController: NSObject, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandlerWithReply {
    let window: NSWindow
    private var webView: WKWebView!
    private let store: SaveStore
    private let distRoot: URL

    // 关窗流程：先让前端存档，前端回 confirmClose(true) 后才真正关
    private var closingHandlerReady = false
    private var closingInFlight = false
    private var closeConfirmed = false
    var canTerminate: Bool { closeConfirmed || !closingHandlerReady }

    // 注入到页面最前面的桥接脚本：所有参数和返回值都走 JSON 字符串，避免 WebKit 自动类型转换带来的偏差
    private static let bridgeScript = """
    (() => {
      const port = window.webkit.messageHandlers.tideweave;
      const call = (op, payload) => port.postMessage({op, payload: payload === undefined ? null : JSON.stringify(payload)})
        .then(r => r == null ? r : JSON.parse(r));
      let closing = null;
      // 原生侧在用户关窗 / ⌘Q 时调用；前端没注册回调就直接放行
      window.__tideweaveClosing = () => { if (closing) closing(); else call('confirmClose', true); };
      Object.defineProperty(window, 'tideweave', {value: Object.freeze({
        load: () => call('load'),
        save: data => call('save', data),
        export: data => call('export', data),
        import: () => call('import'),
        fullscreen: () => call('fullscreen'),
        quit: () => call('quit'),
        onClosing: callback => { closing = callback; call('closingReady'); },
        confirmClose: ok => call('confirmClose', ok === true)
      })});
      // 标题栏取色：读出页面最顶端一像素处实际看到的颜色（逐层叠加半透明背景，例如弹窗遮罩），
      // 交给原生侧把标题栏染成同色，让系统标题栏和页面顶栏连成一体
      const parse = s => { const m = s && s.match(/[\\d.]+/g); return m ? m.map(Number) : null; };
      let lastTop = '', queued = false;
      const reportTop = () => {
        queued = false;
        if (!document.body) return;
        let r = 0, g = 0, b = 0, remain = 1;
        for (const el of document.elementsFromPoint(4, 1)) {
          const c = parse(getComputedStyle(el).backgroundColor);
          if (!c || c.length < 3) continue;
          const a = c.length > 3 ? c[3] : 1;
          if (a <= 0) continue;
          r += c[0] * a * remain; g += c[1] * a * remain; b += c[2] * a * remain; remain *= 1 - a;
          if (remain < 0.01) break;
        }
        // 一路透明到底时，按页面底色补齐
        const base = parse(getComputedStyle(document.body).backgroundColor) || [241, 243, 239];
        if (base.length > 3 && base[3] === 0) base.splice(0, 3, 241, 243, 239);
        r += base[0] * remain; g += base[1] * remain; b += base[2] * remain;
        const top = [r, g, b].map(Math.round).join(',');
        if (top !== lastTop) { lastTop = top; port.postMessage({op: 'topColor', payload: JSON.stringify(top)}); }
      };
      const queueTop = () => { if (!queued) { queued = true; requestAnimationFrame(reportTop); } };
      document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(queueTop).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style']});
        addEventListener('resize', queueTop);
        queueTop();
      });
      // 去掉 WebKit 默认的「重新载入」右键菜单，输入框里保留以便复制粘贴
      document.addEventListener('contextmenu', e => {
        if (!e.target.closest?.('input,textarea,[contenteditable]')) e.preventDefault();
      }, true);
    })();
    """

    init(store: SaveStore, distRoot: URL) {
        self.store = store
        self.distRoot = distRoot
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 940)
        let size = NSSize(width: min(1440, screen.width), height: min(940, screen.height))
        window = NSWindow(contentRect: NSRect(origin: .zero, size: size),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        super.init()

        window.title = "脉序 · Tideweave"
        window.contentMinSize = NSSize(width: 720, height: 620)
        // 标题栏透明后显示的是窗口底色；运行时由页面上报顶部颜色（见 applyTopColor），
        // 标题文字隐藏——游戏顶栏自带品牌名，窗口名仍出现在「窗口」菜单和调度中心里
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.titlebarSeparatorStyle = .none
        applyTopColor(red: 0xf1, green: 0xf3, blue: 0xef)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("TideweaveMain")

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(root: distRoot), forURLScheme: BundleSchemeHandler.scheme)
        // 桌面版只用原生存档，不需要也不保留任何网页存储
        config.websiteDataStore = .nonPersistent()
        config.mediaTypesRequiringUserActionForPlayback = []
        let controller = config.userContentController
        controller.addUserScript(WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.addScriptMessageHandler(self, contentWorld: .page, name: "tideweave")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.allowsMagnification = false
        webView.allowsBackForwardNavigationGestures = false
        webView.underPageBackgroundColor = window.backgroundColor
        // 调试时可用 `defaults write local.tideweave.mac WebInspector -bool true` 打开 Safari 网页检查器
        if #available(macOS 13.3, *) {
            webView.isInspectable = UserDefaults.standard.bool(forKey: "WebInspector")
        }
        window.contentView = webView
    }

    /// 先装好「禁止联网」规则再加载页面，与 Electron 版拦截所有 http/ws 请求的做法一致
    func start() {
        let rules = #"[{"trigger":{"url-filter":"^(https?|wss?)://"},"action":{"type":"block"}}]"#
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "tideweave-offline", encodedContentRuleList: rules) { [weak self] list, _ in
            guard let self else { return }
            if let list { self.webView.configuration.userContentController.add(list) }
            self.webView.load(URLRequest(url: BundleSchemeHandler.entry))
        }
        // 页面加载完再显示窗口，避免白屏闪烁；加载异常时兜底显示
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.show() }
    }

    private func show() {
        guard !window.isVisible else { return }
        window.makeKeyAndOrderFront(nil)
    }

    /// 把标题栏染成页面顶部的颜色；深色时切到深色外观，红绿灯和菜单弹层随之变成深色样式
    private func applyTopColor(red: Double, green: Double, blue: Double) {
        let color = NSColor(srgbRed: red / 255, green: green / 255, blue: blue / 255, alpha: 1)
        window.backgroundColor = color
        webView?.underPageBackgroundColor = color
        let luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
        window.appearance = NSAppearance(named: luminance < 0.5 ? .darkAqua : .aqua)
    }

    // MARK: 关窗与退出

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if canTerminate { return true }
        if !closingInFlight {
            closingInFlight = true
            webView.evaluateJavaScript("window.__tideweaveClosing()") { [weak self] _, error in
                // 页面已经失去响应时不能把用户困在窗口里，直接放行
                if error != nil { self?.finishClosing(ok: true) }
            }
        }
        return false
    }

    private func finishClosing(ok: Bool) {
        closingInFlight = false
        guard ok else { return } // 存档失败：前端会提示，窗口保持打开
        closeConfirmed = true
        window.close()
    }

    /// ⌘Q 或菜单退出：走与关窗相同的存档确认流程
    func requestTermination() {
        window.performClose(nil)
    }

    // MARK: 导航

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        // 只允许加载自己的入口页，其余导航（外链、拖入文件等）一律拒绝
        let allowed = action.request.url?.scheme == BundleSchemeHandler.scheme && action.targetFrame?.isMainFrame == true
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        show()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // 网页进程崩溃后重新载入；存档在原生侧，不会丢
        closingHandlerReady = false
        closingInFlight = false
        webView.load(URLRequest(url: BundleSchemeHandler.entry))
    }

    // MARK: 桥接

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
        // 只接受自己页面主框架发来的请求，对应 Electron 版的 senderFrame 校验
        guard message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.scheme == BundleSchemeHandler.scheme,
              let body = message.body as? [String: Any], let op = body["op"] as? String
        else { return replyHandler(nil, "请求来源无效。") }
        let payload = (body["payload"] as? String).map { Data($0.utf8) }

        do {
            switch op {
            case "load":
                let result = store.load()
                replyHandler(try json(["data": result.data.map { $0 as Any } ?? NSNull(), "warning": result.warning,
                                       "portable": false, "platform": "mac", "savePath": store.file.path]), nil)
            case "save":
                try store.save(payload ?? Data())
                replyHandler(#"{"ok":true}"#, nil)
            case "export":
                exportSave(payload ?? Data(), reply: replyHandler)
            case "import":
                importSave(reply: replyHandler)
            case "fullscreen":
                let willBeFullScreen = !window.styleMask.contains(.fullScreen)
                window.toggleFullScreen(nil)
                replyHandler(willBeFullScreen ? "true" : "false", nil)
            case "quit":
                replyHandler(nil, nil)
                DispatchQueue.main.async { NSApp.terminate(nil) }
            case "topColor":
                // 载荷形如 "38,42,41"
                let parts = payload.flatMap { try? JSONSerialization.jsonObject(with: $0, options: .fragmentsAllowed) as? String }?
                    .split(separator: ",").compactMap { Double($0) } ?? []
                if parts.count == 3 { applyTopColor(red: parts[0], green: parts[1], blue: parts[2]) }
                replyHandler(nil, nil)
            case "closingReady":
                closingHandlerReady = true
                replyHandler(nil, nil)
            case "confirmClose":
                replyHandler(nil, nil)
                let ok = payload.flatMap { try? JSONSerialization.jsonObject(with: $0, options: .fragmentsAllowed) } as? Bool ?? false
                DispatchQueue.main.async { self.finishClosing(ok: ok) }
            default:
                replyHandler(nil, "未知请求：\(op)")
            }
        } catch {
            replyHandler(nil, error.localizedDescription)
        }
    }

    private func exportSave(_ raw: Data, reply: @escaping @MainActor (Any?, String?) -> Void) {
        do { try SaveStore.validate(raw) } catch { return reply(nil, error.localizedDescription) }
        let panel = NSSavePanel()
        panel.title = "导出进度"
        panel.nameFieldStringValue = "Tideweave-progress.json"
        panel.allowedContentTypes = [.json]
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { return reply("false", nil) }
            do {
                try raw.write(to: url, options: .atomic)
                reply("true", nil)
            } catch {
                reply(nil, error.localizedDescription)
            }
        }
    }

    private func importSave(reply: @escaping @MainActor (Any?, String?) -> Void) {
        let panel = NSOpenPanel()
        panel.title = "导入进度"
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { return reply(nil, nil) }
            do {
                let size = (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if size > SaveStore.maxBytes { throw SaveStore.Failure.tooLarge }
                let raw = try Data(contentsOf: url)
                try SaveStore.validate(raw)
                reply(String(decoding: raw, as: UTF8.self), nil)
            } catch {
                reply(nil, error.localizedDescription)
            }
        }
    }

    private func json(_ object: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
    }
}
