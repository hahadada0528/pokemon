#!/usr/bin/env python3
"""Embed packaging/windows/app.ico into a PE as RT_ICON / RT_GROUP_ICON."""
import struct
import sys
from pathlib import Path

import lief


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
        entries.append((w or 256, h or 256, planes or 1, bits or 32, img))

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
    pe.set_resources(root)

    cfg = lief.PE.Builder.config_t()
    cfg.resources = True
    builder = lief.PE.Builder(pe, cfg)
    builder.build()
    builder.write(str(exe))
    print(f"embedded {len(entries)} icons into {exe}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
