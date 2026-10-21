import Foundation
import WebKit

// 用自定义协议 tideweave://app/ 提供 App 包内的 dist/。
// 不直接用 file://：WKWebView 里 file:// 的源是 null，ES 模块和 CSP 的 'self' 都会出问题。
// /api/ 开头的请求转发给云同步服务：对网页来说仍是同源请求，CSP 和服务端跨域设置都不用改。
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "tideweave"
    static let entry = URL(string: "tideweave://app/index.html")!

    private let root: URL
    private let syncServer: URL?
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData // 条件请求（ETag）交给同步层自己处理
        config.timeoutIntervalForRequest = 10
        return URLSession(configuration: config)
    }()
    // 只转发同步协议用到的请求头 / 响应头
    private static let forwardedRequestHeaders = ["Content-Type", "X-Sync-Code", "If-Match", "If-None-Match"]
    private static let forwardedResponseHeaders = ["Content-Type", "ETag", "Retry-After"]
    // 被 WebKit 中途停掉的请求不能再回调，否则会直接崩溃
    private var stopped = Set<ObjectIdentifier>()

    init(root: URL, syncServer: URL?) {
        self.root = root.standardizedFileURL
        self.syncServer = syncServer
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
        if url.path.hasPrefix("/api/") { return proxy(task, url: url) }
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

    private func proxy(_ task: WKURLSchemeTask, url: URL) {
        guard let syncServer,
              var parts = URLComponents(url: syncServer, resolvingAgainstBaseURL: false)
        else { return fail(task, code: 503) }
        parts.path = parts.path.replacingOccurrences(of: "/+$", with: "", options: .regularExpression) + url.path
        parts.query = url.query
        guard let target = parts.url else { return fail(task, code: 400) }

        var request = URLRequest(url: target)
        request.httpMethod = task.request.httpMethod ?? "GET"
        request.httpBody = task.request.httpBody
        for name in Self.forwardedRequestHeaders {
            if let value = task.request.value(forHTTPHeaderField: name) { request.setValue(value, forHTTPHeaderField: name) }
        }
        let id = ObjectIdentifier(task)
        session.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self, self.stopped.remove(id) == nil else { return }
                // 连不上服务时让 fetch 失败，同步层据此显示“离线，稍后重试”
                guard let http = response as? HTTPURLResponse else {
                    return task.didFailWithError(error ?? URLError(.cannotConnectToHost))
                }
                var headers: [String: String] = [:]
                for name in Self.forwardedResponseHeaders {
                    if let value = http.value(forHTTPHeaderField: name) { headers[name] = value }
                }
                task.didReceive(HTTPURLResponse(url: url, statusCode: http.statusCode, httpVersion: "HTTP/1.1", headerFields: headers)!)
                if let data, !data.isEmpty { task.didReceive(data) }
                task.didFinish()
            }
        }.resume()
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
