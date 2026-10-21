import CoreGraphics
import Foundation

let outPath = CommandLine.arguments.count > 1
  ? CommandLine.arguments[1]
  : FileManager.default.currentDirectoryPath + "/data/key_presses.json"
let outURL = URL(fileURLWithPath: outPath)

var presses = 0
if let data = try? Data(contentsOf: outURL),
   let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
   let saved = object["presses"] as? Int {
  presses = saved
}

func writeCount() {
  let payload: [String: Int] = ["presses": presses]
  guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
  let tmp = outURL.appendingPathExtension("tmp")
  do {
    try data.write(to: tmp, options: .atomic)
    _ = try? FileManager.default.replaceItemAt(outURL, withItemAt: tmp)
  } catch {
    try? data.write(to: outURL, options: .atomic)
  }
}

writeCount()
fputs("按键计数已开始，只记录次数。当前 \(presses)。输出 \(outPath)\n", stderr)

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
  fputs("无法监听按键。请在 系统设置 → 隐私与安全性 → 辅助功能 中允许运行它的终端或 Cursor。\n", stderr)
  exit(1)
}

let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
CFRunLoopRun()
