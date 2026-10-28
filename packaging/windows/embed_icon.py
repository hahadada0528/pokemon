#!/usr/bin/env python3
"""Embed packaging/windows/app.ico into a PE as RT_ICON / RT_GROUP_ICON."""
import struct
import sys
import zlib
from pathlib import Path

import lief


def png_chunk(tag: bytes, payload: bytes) -> bytes:
    crc = zlib.crc32(tag + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", crc)


def bmp_icon_to_png(blob: bytes) -> bytes:
    """Turn a bottom-up BGRA ICO bitmap into a PNG. Explorer rejects a raw 256 BMP."""
    header = struct.unpack_from("<IiiHHI", blob, 0)
    width, height, planes, bits = header[1], header[2], header[3], header[4]
    if header[0] != 40 or planes != 1 or bits != 32 or width <= 0 or height <= width:
        return blob
    xor = blob[40 : 40 + width * width * 4]
    if len(xor) != width * width * 4:
        return blob
    raw = bytearray()
    stride = width * 4
    for y in range(width - 1, -1, -1):
        raw.append(0)
        row = xor[y * stride : (y + 1) * stride]
        for i in range(0, stride, 4):
            b, g, r, a = row[i : i + 4]
            raw += bytes((r, g, b, a))
    ihdr = struct.pack(">IIBBBBB", width, width, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + png_chunk(b"IEND", b"")
    )


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: embed_icon.py app.exe app.ico", file=sys.stderr)
        return 2
    exe = Path(sys.argv[1])
    ico = Path(sys.argv[2])
    data = ico.read_bytes()
    _, typ, count = struct.unpack_from("<HHH", data, 0)
    if typ != 1 or count < 1:
        print("invalid ico", file=sys.stderr)
        return 1
    off = 6
    entries = []
    for _ in range(count):
        w, h, _ncolors, _res, planes, bits, size, image_offset = struct.unpack_from("<BBBBHHII", data, off)
        off += 16
        img = data[image_offset : image_offset + size]
        width = w or 256
        if width >= 256 and not img.startswith(b"\x89PNG\r\n\x1a\n"):
            img = bmp_icon_to_png(img)
        entries.append((width, h or 256, planes or 1, bits or 32, img))

    pe = lief.PE.parse(str(exe))
    root = lief.PE.ResourceDirectory()
    icon_type = lief.PE.ResourceDirectory()
    icon_type.id = 3
    group_type = lief.PE.ResourceDirectory()
    group_type.id = 14
    group = bytearray(struct.pack("<HHH", 0, 1, len(entries)))
    for idx, (w, h, planes, bits, img) in enumerate(entries, start=1):
        id_dir = lief.PE.ResourceDirectory()
        id_dir.id = idx
        data_node = lief.PE.ResourceData()
        data_node.id = 0x409
        data_node.content = bytes(img)
        id_dir.add_child(data_node)
        icon_type.add_child(id_dir)
        group += struct.pack(
            "<BBBBHHIH",
            0 if w >= 256 else w,
            0 if h >= 256 else h,
            0,
            0,
            planes,
            bits,
            len(img),
            idx,
        )
    gid = lief.PE.ResourceDirectory()
    gid.id = 1
    gdata = lief.PE.ResourceData()
    gdata.id = 0x409
    gdata.content = bytes(group)
    gid.add_child(gdata)
    group_type.add_child(gid)
    root.add_child(icon_type)
    root.add_child(group_type)
    # RT_MANIFEST 24 / id 1: double-click requests administrator instead of
    # requiring a manual "Run as administrator" each launch.
    manifest = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity type="win32" name="PokemonPokedex.Launcher" version="1.0.0.0" processorArchitecture="amd64"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
""".encode("utf-8")
    manifest_type = lief.PE.ResourceDirectory()
    manifest_type.id = 24
    manifest_id = lief.PE.ResourceDirectory()
    manifest_id.id = 1
    manifest_data = lief.PE.ResourceData()
    manifest_data.id = 0x409
    manifest_data.content = manifest
    manifest_id.add_child(manifest_data)
    manifest_type.add_child(manifest_id)
    root.add_child(manifest_type)
    pe.set_resources(root)
    pe.optional_header.subsystem = type(pe.optional_header.subsystem).WINDOWS_GUI

    cfg = lief.PE.Builder.config_t()
    cfg.resources = True
    builder = lief.PE.Builder(pe, cfg)
    builder.build()
    builder.write(str(exe))
    print(f"embedded {len(entries)} icons into {exe}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
