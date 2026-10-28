#!/usr/bin/env python3
"""Add coin-unlock alternate formes (not Mega). Skips IDs already in pokemon.json."""

from __future__ import annotations

import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
IMG = DATA / "images"
SHINY = IMG / "shiny"
MIN_ART = 20_000
WORKERS = 16
CACHE_PATH = DATA / "alt_forms_detail_cache.json"

# identifier → unlock cost, Chinese/English labels, host species id
FORMS: list[dict] = [
    {"ident": "kyogre-primal", "cost": 10000, "zh": "原始盖欧卡", "en": "Primal Kyogre", "of": 382},
    {"ident": "groudon-primal", "cost": 10000, "zh": "原始固拉多", "en": "Primal Groudon", "of": 383},
    {"ident": "zacian-crowned", "cost": 10000, "zh": "苍响（剑之王）", "en": "Zacian Crowned Sword", "of": 888},
    {"ident": "zamazenta-crowned", "cost": 10000, "zh": "藏玛然特（盾之王）", "en": "Zamazenta Crowned Shield", "of": 889},
    {"ident": "eternatus-eternamax", "cost": 10000, "zh": "无极汰那（无极巨化）", "en": "Eternatus Eternamax", "of": 890},
    {"ident": "shaymin-sky", "cost": 10000, "zh": "谢米（天空形态）", "en": "Shaymin Sky Forme", "of": 492},
    {"ident": "greninja-ash", "cost": 10000, "zh": "甲贺忍蛙（小智形态）", "en": "Ash-Greninja", "of": 658},
    {"ident": "meloetta-pirouette", "cost": 10000, "zh": "美洛耶塔（舞步形态）", "en": "Meloetta Pirouette", "of": 648},
    {"ident": "floette-eternal", "cost": 10000, "zh": "花叶蒂（永恒之花）", "en": "Floette Eternal Flower", "of": 670},
    {"ident": "hoopa-unbound", "cost": 10000, "zh": "胡帕（解放）", "en": "Hoopa Unbound", "of": 720},
    {"ident": "lycanroc-dusk", "cost": 5000, "zh": "鬃岩狼人（黄昏形态）", "en": "Lycanroc Dusk", "of": 745},
    {"ident": "terapagos-terastal", "cost": 7000, "zh": "太乐巴戈斯（太晶形态）", "en": "Terapagos Terastal", "of": 1024},
    {"ident": "terapagos-stellar", "cost": 10000, "zh": "太乐巴戈斯（星晶形态）", "en": "Terapagos Stellar", "of": 1024},
    {"ident": "rotom-heat", "cost": 3000, "zh": "加热洛托姆", "en": "Heat Rotom", "of": 479},
    {"ident": "rotom-wash", "cost": 3000, "zh": "清洗洛托姆", "en": "Wash Rotom", "of": 479},
    {"ident": "rotom-frost", "cost": 3000, "zh": "结冰洛托姆", "en": "Frost Rotom", "of": 479},
    {"ident": "rotom-fan", "cost": 3000, "zh": "旋转洛托姆", "en": "Fan Rotom", "of": 479},
    {"ident": "rotom-mow", "cost": 3000, "zh": "切割洛托姆", "en": "Mow Rotom", "of": 479},
    {"ident": "zygarde-10", "cost": 3000, "zh": "基格尔德（10%）", "en": "Zygarde 10%", "of": 718},
    {"ident": "zygarde-complete", "cost": 10000, "zh": "基格尔德（100%）", "en": "Zygarde Complete", "of": 718},
    {"ident": "tornadus-therian", "cost": 5000, "zh": "龙卷云（灵兽）", "en": "Tornadus Therian", "of": 641},
    {"ident": "thundurus-therian", "cost": 5000, "zh": "雷电云（灵兽）", "en": "Thundurus Therian", "of": 642},
    {"ident": "landorus-therian", "cost": 5000, "zh": "土地云（灵兽）", "en": "Landorus Therian", "of": 645},
    {"ident": "enamorus-therian", "cost": 5000, "zh": "眷恋云（灵兽）", "en": "Enamorus Therian", "of": 905},
    {"ident": "deoxys-attack", "cost": 5000, "zh": "代欧奇希斯（攻击）", "en": "Deoxys Attack", "of": 386},
    {"ident": "deoxys-defense", "cost": 5000, "zh": "代欧奇希斯（防御）", "en": "Deoxys Defense", "of": 386},
    {"ident": "deoxys-speed", "cost": 5000, "zh": "代欧奇希斯（速度）", "en": "Deoxys Speed", "of": 386},
    {"ident": "dialga-origin", "cost": 5000, "zh": "帝牙卢卡（起源）", "en": "Dialga Origin", "of": 483},
    {"ident": "palkia-origin", "cost": 5000, "zh": "帕路奇亚（起源）", "en": "Palkia Origin", "of": 484},
    {"ident": "giratina-origin", "cost": 5000, "zh": "骑拉帝纳（起源）", "en": "Giratina Origin", "of": 487},
    {"ident": "keldeo-resolute", "cost": 5000, "zh": "凯路迪欧（觉悟）", "en": "Keldeo Resolute", "of": 647},
    {
        "ident": "necrozma-dusk",
        "cost": 10000,
        "zh": "奈克洛兹玛（黄昏之鬃）",
        "en": "Dusk Mane Necrozma",
        "of": 800,
        "requires": [800, 791],
        "from": [800, 791],
    },
    {
        "ident": "necrozma-dawn",
        "cost": 10000,
        "zh": "奈克洛兹玛（拂晓之翼）",
        "en": "Dawn Wings Necrozma",
        "of": 800,
        "requires": [800, 792],
        "from": [800, 792],
    },
    {
        "ident": "necrozma-ultra",
        "cost": 10000,
        "zh": "究极奈克洛兹玛",
        "en": "Ultra Necrozma",
        "of": 800,
        "from_ident": ["necrozma-dusk", "necrozma-dawn"],
        "requires_any_ident": ["necrozma-dusk", "necrozma-dawn"],
    },
    {
        "ident": "kyurem-black",
        "cost": 10000,
        "zh": "暗黑酋雷姆",
        "en": "Black Kyurem",
        "of": 646,
        "requires": [646, 644],
        "from": [646, 644],
    },
    {
        "ident": "kyurem-white",
        "cost": 10000,
        "zh": "焰白酋雷姆",
        "en": "White Kyurem",
        "of": 646,
        "requires": [646, 643],
        "from": [646, 643],
    },
    {
        "ident": "calyrex-ice",
        "cost": 10000,
        "zh": "白马蕾冠王",
        "en": "Ice Rider Calyrex",
        "of": 898,
        "requires": [898, 896],
        "from": [898, 896],
    },
    {
        "ident": "calyrex-shadow",
        "cost": 10000,
        "zh": "黑马蕾冠王",
        "en": "Shadow Rider Calyrex",
        "of": 898,
        "requires": [898, 897],
        "from": [898, 897],
    },
    {"ident": "palafin-hero", "cost": 10000, "zh": "海豚侠（全能形态）", "en": "Palafin Hero", "of": 964},
    {"ident": "wishiwashi-school", "cost": 10000, "zh": "弱丁鱼（鱼群的样子）", "en": "Wishiwashi School", "of": 746},
]


def curl_bytes(url: str, retries: int = 5) -> bytes:
    last = None
    for attempt in range(retries):
        r = subprocess.run(
            ["curl", "-fsSL", "--max-time", "45", "-A", "Mozilla/5.0 alt-forms/1.0", url],
            capture_output=True,
        )
        if r.returncode == 0 and r.stdout:
            return r.stdout
        last = r.stderr.decode() if r.stderr else r.returncode
        time.sleep(0.3 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def curl_json(url: str) -> dict:
    return json.loads(curl_bytes(url).decode())


def round_pb(total: int) -> int:
    return int(total / 10 + 0.5) * 10


def rarity_of(entry: dict) -> tuple[int, str]:
    if entry.get("is_mythical"):
        return 10, "mythical"
    if entry.get("is_legendary"):
        return 10, "legendary"
    cr = entry.get("capture_rate", 45)
    if cr <= 3:
        return 3, "ultra-rare"
    if cr <= 15:
        return 3, "rare"
    if cr <= 45:
        return 3, "uncommon"
    if cr <= 120:
        return 1, "common"
    return 1, "very-common"


def artwork_urls(pid: int) -> list[str]:
    return [
        f"https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/{pid}.png",
        f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{pid}.png",
    ]


def shiny_urls(pid: int) -> list[str]:
    return [
        f"https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/shiny/{pid}.png",
        f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/shiny/{pid}.png",
    ]


def download(dest: Path, urls: list[str]) -> bool:
    if dest.exists() and dest.stat().st_size >= MIN_ART:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    last = None
    for url in urls:
        try:
            data = curl_bytes(url)
            dest.write_bytes(data)
            if dest.stat().st_size >= MIN_ART or url == urls[-1]:
                return dest.stat().st_size > 0
        except Exception as e:  # noqa: BLE001
            last = e
    print(f"  WARN {dest.name}: {last}", file=sys.stderr)
    return dest.exists() and dest.stat().st_size > 0


IDENT_ALIASES = {
    "necrozma-dusk": ("necrozma-dusk", "necrozma-dusk-mane"),
    "necrozma-dawn": ("necrozma-dawn", "necrozma-dawn-wings"),
    "calyrex-ice": ("calyrex-ice", "calyrex-ice-rider"),
    "calyrex-shadow": ("calyrex-shadow", "calyrex-shadow-rider"),
}


def resolve_ids() -> dict[str, int]:
    listing = curl_json("https://pokeapi.co/api/v2/pokemon?limit=20000")
    by_name: dict[str, int] = {}
    for row in listing.get("results") or []:
        name = row.get("name") or ""
        url = row.get("url") or ""
        if not name or not url:
            continue
        by_name[name] = int(url.rstrip("/").split("/")[-1])
    found: dict[str, int] = {}
    for spec in FORMS:
        ident = spec["ident"]
        candidates = IDENT_ALIASES.get(ident, (ident,))
        for name in candidates:
            if name in by_name:
                found[ident] = by_name[name]
                break
    return found


def fetch_one(pid: int, ident: str) -> dict:
    pk = curl_json(f"https://pokeapi.co/api/v2/pokemon/{pid}")
    sp = curl_json(pk["species"]["url"])
    stats = {s["stat"]["name"]: s["base_stat"] for s in pk["stats"]}
    total = sum(stats.values())
    return {
        "id": pid,
        "identifier": pk.get("name") or ident,
        "species_id": int(pk["species"]["url"].rstrip("/").split("/")[-1]),
        "types": [t["type"]["name"] for t in sorted(pk["types"], key=lambda x: x["slot"])],
        "stats": stats,
        "total": total,
        "capture_rate": sp["capture_rate"],
        "is_legendary": sp["is_legendary"],
        "is_mythical": sp["is_mythical"],
    }


def main() -> None:
    dex = json.loads((DATA / "pokemon.json").read_text(encoding="utf-8"))
    by = {p["id"]: p for p in dex}

    print("Resolving form IDs...")
    ids = resolve_ids()
    missing = [f["ident"] for f in FORMS if f["ident"] not in ids]
    if missing:
        print("MISSING identifiers:", missing, file=sys.stderr)
        sys.exit(1)
    for f in FORMS:
        print(f"  {ids[f['ident']]} {f['ident']} cost={f['cost']}")

    if CACHE_PATH.exists():
        details = {int(k): v for k, v in json.loads(CACHE_PATH.read_text(encoding="utf-8")).items()}
    else:
        details = {}

    need = [(ids[f["ident"]], f["ident"]) for f in FORMS if ids[f["ident"]] not in details]
    if need:
        print(f"Fetching {len(need)} details...")

        def job(row: tuple[int, str]) -> tuple[int, dict]:
            return row[0], fetch_one(row[0], row[1])

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futs = [pool.submit(job, row) for row in need]
            done = 0
            for fut in as_completed(futs):
                pid, d = fut.result()
                details[pid] = d
                done += 1
                print(f"  detail {done}/{len(need)}", flush=True)
        CACHE_PATH.write_text(
            json.dumps({str(k): v for k, v in sorted(details.items())}, ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )

    print("Downloading artwork...")
    jobs = []
    for f in FORMS:
        pid = ids[f["ident"]]
        jobs.append((IMG / f"{pid:03d}.png", artwork_urls(pid)))
        jobs.append((SHINY / f"{pid:03d}.png", shiny_urls(pid)))
    jobs = [(d, u) for d, u in jobs if not (d.exists() and d.stat().st_size >= MIN_ART)]
    if jobs:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futs = [pool.submit(download, d, u) for d, u in jobs]
            done = 0
            for fut in as_completed(futs):
                fut.result()
                done += 1
                if done % 8 == 0 or done == len(jobs):
                    print(f"  images {done}/{len(jobs)}", flush=True)
    else:
        print("  images already present")

    new_entries = []
    skipped = 0
    for spec in FORMS:
        pid = ids[spec["ident"]]
        if pid in by:
            skipped += 1
            print(f"  skip existing #{pid} {spec['ident']}")
            continue
        d = details[pid]
        host = spec["of"]
        if host not in by:
            print(f"  WARN host #{host} missing for {spec['ident']}", file=sys.stderr)
        total = d["total"]
        pb = round_pb(total)
        flags = {
            "is_legendary": d["is_legendary"],
            "is_mythical": d["is_mythical"],
            "capture_rate": d["capture_rate"],
        }
        rm, rarity = rarity_of(flags)
        img = IMG / f"{pid:03d}.png"
        shiny = SHINY / f"{pid:03d}.png"
        gen = by.get(host, {}).get("generation") or 1
        entry = {
            "id": pid,
            "name_en": spec["en"],
            "name_zh": spec["zh"],
            "identifier": spec["ident"],
            "capture_rate": d["capture_rate"],
            "generation": 0,
            "is_legendary": d["is_legendary"],
            "is_mythical": d["is_mythical"],
            "image": f"images/{pid:03d}.png" if img.exists() else None,
            "types": d["types"],
            "image_shiny": f"images/shiny/{pid:03d}.png" if shiny.exists() else None,
            "image_shiny_url": shiny_urls(pid)[0],
            "image_url": artwork_urls(pid)[0],
            "evolution": {
                "chain_id": 300000 + pid,
                "family": [pid],
                "evolves_from": None,
                "evolves_to": [],
                "stage": 1,
            },
            "rarity": rarity,
            "spawn_areas": [],
            "base_stats": {
                "hp": d["stats"].get("hp", 0),
                "attack": d["stats"].get("attack", 0),
                "defense": d["stats"].get("defense", 0),
                "special_attack": d["stats"].get("special-attack", 0),
                "special_defense": d["stats"].get("special-defense", 0),
                "speed": d["stats"].get("speed", 0),
                "total": total,
                "power_base": pb,
            },
            "power_base": pb,
            "rarity_mult": rm,
            "species_power": pb * rm,
            "regions": [],
            "alt_form": True,
            "alt_of": host,
            "unlock_cost": spec["cost"],
        }
        if spec.get("requires"):
            entry["unlock_requires"] = list(spec["requires"])
        if spec.get("from"):
            entry["unlock_from"] = list(spec["from"])
        from_ident = spec.get("from_ident") or []
        any_ident = spec.get("requires_any_ident") or []
        if from_ident:
            entry["unlock_from"] = [ids[n] for n in from_ident]
        if any_ident:
            entry["unlock_requires_any"] = [ids[n] for n in any_ident]
        new_entries.append(entry)
        by[pid] = entry
        dex.append(entry)

    if not new_entries:
        print(f"No new alt forms (skipped {skipped})")
        return

    dex = sorted(by.values(), key=lambda p: p["id"])
    (DATA / "pokemon.json").write_text(json.dumps(dex, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(dex)} entries ({len(new_entries)} new alt forms, skipped {skipped})")
    for e in new_entries:
        print(f"  #{e['id']} {e['name_zh']} cost={e['unlock_cost']} of={e['alt_of']}")


if __name__ == "__main__":
    main()
