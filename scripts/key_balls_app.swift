import AppKit
import CoreGraphics
import Foundation

let outURL = URL(fileURLWithPath: "/Users/hhdd/pokemon/data/key_presses.json")
var presses = 0
var listening = false

func loadCount() {
  guard let data = try? Data(contentsOf: outURL),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let saved = object["presses"] as? Int else { return }
  presses = saved
}

func writeCount() {
  let payload: [String: Int] = ["presses": presses]
  guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
  try? FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)
  try? data.write(to: outURL, options: .atomic)
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  var window: NSWindow?
  var statusLabel: NSTextField?
  var detailLabel: NSTextField?

  func applicationDidFinishLaunching(_ notification: Notification) {
    loadCount()
    writeCount()
    buildWindow()
    listening = startTap()
    refresh()
    Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { _ in
      self.refresh()
    }
    window?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func buildWindow() {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 420, height: 220),
      styleMask: [.titled, .closable, .miniaturizable],
      backing: .buffered,
      defer: false
    )
    window.title = "按键获球"
    window.center()

    let title = NSTextField(labelWithString: "按键获球")
    title.font = .systemFont(ofSize: 22, weight: .semibold)
    title.frame = NSRect(x: 24, y: 160, width: 372, height: 32)

    let status = NSTextField(labelWithString: "")
    status.font = .monospacedDigitSystemFont(ofSize: 28, weight: .medium)
    status.frame = NSRect(x: 24, y: 112, width: 372, height: 40)

    let detail = NSTextField(wrappingLabelWithString: "")
    detail.font = .systemFont(ofSize: 13)
    detail.textColor = .secondaryLabelColor
    detail.frame = NSRect(x: 24, y: 28, width: 372, height: 76)

    window.contentView?.addSubview(title)
    window.contentView?.addSubview(status)
    window.contentView?.addSubview(detail)
    self.window = window
    statusLabel = status
    detailLabel = detail
  }

  func refresh() {
    statusLabel?.stringValue = "已按 \(presses) 次"
    if listening {
      detailLabel?.stringValue = "每 10 秒内只要按过键，图鉴里的精灵球加 10。只看有没有按，不记录按了什么。关闭这个窗口就会停止计数。图鉴页面需要开着，或之后再打开，球数会补上。"
    } else {
      detailLabel?.stringValue = "还不能读取按键。请到 系统设置 → 隐私与安全性 → 辅助功能，允许「按键获球」，然后重新打开这个启动器。"
    }
  }
}

func startTap() -> Bool {
  let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
  guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: mask,
    callback: { _, type, event, _ in
      if type == .keyDown && event.getIntegerValueField(.keyboardEventAutorepeat) == 0 {
        presses += 1
        writeCount()
      }
      return Unmanaged.passUnretained(event)
    },
    userInfo: nil
  ) else {
    return false
  }
  let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
  CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)
  return true
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
