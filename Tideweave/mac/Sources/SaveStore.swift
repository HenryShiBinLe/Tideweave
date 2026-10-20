import Foundation

// 本机存档：与 desktop/storage.cjs 的规则一致——
// 只接受 {version:1, records:{...}}，单个存档不超过 4MB；
// 写入走「临时文件 → fsync → 备份旧档 → 原子改名」，主档损坏时回退到 .bak。
struct SaveStore {
    static let maxBytes = 4 * 1024 * 1024

    enum Failure: LocalizedError {
        case incompatible, tooLarge
        var errorDescription: String? {
            switch self {
            case .incompatible: return "存档格式不兼容。"
            case .tooLarge: return "存档超过大小限制。"
            }
        }
    }

    let directory: URL
    var file: URL { directory.appendingPathComponent("progress.json") }
    var backup: URL { directory.appendingPathComponent("progress.json.bak") }

    init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// 校验一段 JSON 文本，通过则返回解析后的对象
    @discardableResult
    static func validate(_ raw: Data) throws -> [String: Any] {
        if raw.count > maxBytes { throw Failure.tooLarge }
        guard let object = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
              let version = object["version"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
              object["records"] is [String: Any]
        else { throw Failure.incompatible }
        return object
    }

    /// 读档：先主档后备份；都读不到时给出与 Electron 版相同的提示
    func load() -> (data: [String: Any]?, warning: String) {
        var warning = ""
        for candidate in [file, backup] {
            guard FileManager.default.fileExists(atPath: candidate.path) else { continue }
            do {
                let object = try Self.validate(try Data(contentsOf: candidate))
                return (object, candidate == backup ? "主存档损坏，已恢复上一次备份。" : warning)
            } catch {
                warning = "存档无法读取，请从设置导入备份；原文件未删除。"
            }
        }
        return (nil, warning)
    }

    func save(_ raw: Data) throws {
        try Self.validate(raw)
        let temporary = directory.appendingPathComponent("progress.json.tmp")
        FileManager.default.createFile(atPath: temporary.path, contents: nil)
        let handle = try FileHandle(forWritingTo: temporary)
        do {
            try handle.write(contentsOf: raw)
            try handle.synchronize()
            try handle.close()
        } catch {
            try? handle.close()
            throw error
        }
        // 旧主档仍然有效时才拿它覆盖备份，避免用坏档顶掉好备份
        if let old = try? Data(contentsOf: file), (try? Self.validate(old)) != nil {
            try? FileManager.default.removeItem(at: backup)
            try? FileManager.default.copyItem(at: file, to: backup)
        }
        // rename(2) 在同一卷内是原子的，直接覆盖目标
        if rename(temporary.path, file.path) != 0 {
            throw CocoaError(.fileWriteUnknown)
        }
    }
}
