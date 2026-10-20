import Foundation
import WebKit

// 用自定义协议 tideweave://app/ 提供 App 包内的 dist/。
// 不直接用 file://：WKWebView 里 file:// 的源是 null，ES 模块和 CSP 的 'self' 都会出问题。
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "tideweave"
    static let entry = URL(string: "tideweave://app/index.html")!

    private let root: URL
    // 被 WebKit 中途停掉的请求不能再回调，否则会直接崩溃
    private var stopped = Set<ObjectIdentifier>()

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    private static let mimeTypes: [String: String] = [
        "html": "text/html", "js": "text/javascript", "mjs": "text/javascript",
        "css": "text/css", "json": "application/json", "svg": "image/svg+xml",
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
        "woff2": "font/woff2", "woff": "font/woff", "ttf": "font/ttf", "otf": "font/otf",
        "mp3": "audio/mpeg", "ogg": "audio/ogg", "wav": "audio/wav", "txt": "text/plain",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "app" else {
            return fail(task, code: 400)
        }
        // 防目录穿越：解析后的路径必须仍在 dist/ 之内
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/") else { return fail(task, code: 403) }

        let id = ObjectIdentifier(task)
        // 场景图有好几 MB，放到后台读，回到主线程再交给 WebKit
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let data = try? Data(contentsOf: file)
            DispatchQueue.main.async { [weak self] in
                guard let self, self.stopped.remove(id) == nil else { return }
                guard let data else { return self.fail(task, code: 404) }
                let type = Self.mimeTypes[file.pathExtension.lowercased()] ?? "application/octet-stream"
                let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                               headerFields: ["Content-Type": type, "Content-Length": String(data.count)])!
                task.didReceive(response)
                task.didReceive(data)
                task.didFinish()
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private func fail(_ task: WKURLSchemeTask, code: Int) {
        if let url = task.request.url,
           let response = HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: nil) {
            task.didReceive(response)
            task.didFinish()
        } else {
            task.didFailWithError(URLError(.badURL))
        }
    }
}
