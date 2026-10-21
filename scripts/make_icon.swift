import AppKit

func drawBall(size: CGFloat) -> NSImage {
  let image = NSImage(size: NSSize(width: size, height: size))
  image.lockFocus()
  let inset = size * 0.06
  let rect = NSRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
  let ball = NSBezierPath(ovalIn: rect)

  NSGraphicsContext.current?.saveGraphicsState()
  ball.addClip()
  NSColor.white.setFill()
  rect.fill()
  NSColor(srgbRed: 0.86, green: 0.12, blue: 0.16, alpha: 1).setFill()
  NSRect(x: 0, y: size / 2, width: size, height: size / 2).fill()
  NSColor.black.setFill()
  let band = size * 0.11
  NSRect(x: 0, y: size / 2 - band / 2, width: size, height: band).fill()
  NSGraphicsContext.current?.restoreGraphicsState()

  ball.lineWidth = size * 0.045
  NSColor.black.setStroke()
  ball.stroke()

  let button = size * 0.22
  let buttonRect = NSRect(x: (size - button) / 2, y: (size - button) / 2, width: button, height: button)
  NSColor.white.setFill()
  NSBezierPath(ovalIn: buttonRect).fill()
  let ring = NSBezierPath(ovalIn: buttonRect.insetBy(dx: size * 0.012, dy: size * 0.012))
  ring.lineWidth = size * 0.04
  NSColor.black.setStroke()
  ring.stroke()
  let pupil = size * 0.07
  NSColor.black.setFill()
  NSBezierPath(ovalIn: NSRect(x: (size - pupil) / 2, y: (size - pupil) / 2, width: pupil, height: pupil)).fill()

  image.unlockFocus()
  return image
}

func writePNG(_ image: NSImage, to url: URL) {
  guard let tiff = image.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff),
        let data = rep.representation(using: .png, properties: [:]) else {
    fputs("png failed\n", stderr)
    exit(1)
  }
  try! data.write(to: url)
}

let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try? FileManager.default.removeItem(at: root)
try! FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
let sizes = [16, 32, 128, 256, 512]
for size in sizes {
  writePNG(drawBall(size: CGFloat(size)), to: root.appendingPathComponent("icon_\(size)x\(size).png"))
  let retina = size * 2
  writePNG(drawBall(size: CGFloat(retina)), to: root.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
