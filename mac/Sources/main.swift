import AppKit

// App 入口：建菜单、定存档目录、开主窗口。
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var game: GameWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // 菜单里自己放了「进入全屏幕」，关掉系统自动追加的那一项，避免重复
        UserDefaults.standard.set(false, forKey: "NSFullScreenMenuItemEverywhere")
        NSApp.mainMenu = buildMainMenu()

        guard let dist = Bundle.main.resourceURL?.appendingPathComponent("dist"),
              FileManager.default.fileExists(atPath: dist.appendingPathComponent("index.html").path)
        else { return fatal("App 包内缺少游戏资源（Resources/dist），请重新构建。") }

        // 存档放在 ~/Library/Application Support/Tideweave；不写进 .app 包里，否则会破坏签名
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        do {
            let store = try SaveStore(directory: support.appendingPathComponent("Tideweave", isDirectory: true))
            game = GameWindowController(store: store, distRoot: dist)
            game?.start()
        } catch {
            fatal("无法创建存档目录：\(error.localizedDescription)")
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let game, !game.canTerminate else { return .terminateNow }
        // 先让前端存档，存完关窗后由「最后一个窗口关闭即退出」接着退出
        game.requestTermination()
        return .terminateCancel
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        game?.window.makeKeyAndOrderFront(nil)
        return true
    }

    private func fatal(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "脉序无法启动"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func buildMainMenu() -> NSMenu {
        let main = NSMenu()
        func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let menu = NSMenu(title: title)
            items.forEach(menu.addItem)
            let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            holder.submenu = menu
            main.addItem(holder)
            return menu
        }
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mask: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = mask
            return item
        }

        _ = submenu("Tideweave", [
            item("关于 Tideweave", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            item("隐藏 Tideweave", #selector(NSApplication.hide(_:)), "h"),
            item("隐藏其他", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("全部显示", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("退出 Tideweave", #selector(NSApplication.terminate(_:)), "q"),
        ])
        // 编辑菜单不放「撤销/重做」：⌘Z 交给游戏自己处理（撤销上一步操作）
        _ = submenu("编辑", [
            item("剪切", #selector(NSText.cut(_:)), "x"),
            item("拷贝", #selector(NSText.copy(_:)), "c"),
            item("粘贴", #selector(NSText.paste(_:)), "v"),
            item("全选", #selector(NSText.selectAll(_:)), "a"),
        ])
        _ = submenu("显示", [
            item("进入全屏幕", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        let windowMenu = submenu("窗口", [
            item("最小化", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("缩放", #selector(NSWindow.performZoom(_:))),
            .separator(),
            item("关闭", #selector(NSWindow.performClose(_:)), "w"),
        ])
        NSApp.windowsMenu = windowMenu
        return main
    }
}

// 顶层代码本来就跑在主线程，这里向编译器声明这一点
MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
}
