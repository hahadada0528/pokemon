#!/usr/bin/env python3
"""Add regional forms as independent dex entries with evolution rules:

- 若进化前一阶也是地区形态 → 独立进化线
- 若进化前一阶与原型相同 → 挂到原型前一阶上作为分支
- 顺带修正：仅地区形态可进化出的全国图鉴种（葱游兵等）不再挂在原型上
"""

from __future__ import annotations

import json
import random
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
WORKERS = 20

REGION_EN = {"阿罗拉": "Alolan", "伽勒尔": "Galarian", "洗翠": "Hisuian", "帕底亚": "Paldean"}
# Paldean Tauros: one dex entry (combat art), skip blaze/aqua breeds.
SKIP_FORMS = {"tauros-paldea-blaze-breed", "tauros-paldea-aqua-breed"}
TAUROS_ZH = {
    "tauros-paldea-combat-breed": "帕底亚肯泰罗",
}
TAUROS_EN = {
    "tauros-paldea-combat-breed": "Paldean Tauros",
}
FORM_GEN = {"阿罗拉": 7, "伽勒尔": 8, "洗翠": 8, "帕底亚": 9}

# poke_id → evolves_to poke_ids (or national ids for new species)
# Independent lines + within-line branches among regional forms
FORM_EVO: dict[int, list[int]] = {
    # Alola independent
    10091: [10092],  # rattata-alola → raticate-alola
    10101: [10102],
    10103: [10104],
    10105: [10106],
    10107: [10108],
    10109: [10110],
    10110: [10111],
    10112: [10113],
    # Galar independent
    10161: [863],  # meowth-galar → perrserker
    10162: [10163],
    10164: [10165, 10172],  # slowpoke-galar → slowbro-galar / slowking-galar
    10166: [865],  # farfetchd-galar → sirfetchd
    10173: [864],  # corsola-galar → cursola
    10174: [10175],
    10175: [862],  # linoone-galar → obstagoon
    10176: [10177],
    10179: [867],  # yamask-galar → runerigus
    # Hisui / Paldea independent
    10229: [10230],
    10231: [10232],
    10234: [904],  # qwilfish-hisui → overqwil
    10235: [903],  # sneasel-hisui → sneasler
    10238: [10239],
    10241: [10242],  # sliggoo-hisui → goodra-hisui (branched from goomy)
    10253: [980],  # wooper-paldea → clodsire
}

# Shared normal pre-evo → add regional form as branch target
# (parent_national_id, regional_form_poke_id)
BRANCH_FROM_NORMAL: list[tuple[int, int]] = [
    (25, 10100),  # pikachu → raichu-alola
    (102, 10114),  # exeggcute → exeggutor-alola
    (104, 10115),  # cubone → marowak-alola
    (109, 10167),  # koffing → weezing-galar
    (439, 10168),  # mime-jr → mr-mime-galar
    (156, 10233),  # quilava → typhlosion-hisui
    (502, 10236),  # dewott → samurott-hisui
    (548, 10237),  # petilil → lilligant-hisui
    (627, 10240),  # rufflet → braviary-hisui
    (704, 10241),  # goomy → sliggoo-hisui
    (712, 10243),  # bergmite → avalugg-hisui
    (723, 10244),  # dartrix → decidueye-hisui
]

# Regional form that continues after a branch (pre is regional)
# already in FORM_EVO: 10168 → 866, 10241 → 10242
FORM_EVO[10168] = [866]  # mr-mime-galar → mr-rime

# Base species: remove evolves_to that belong only to regional forms
BASE_REMOVE_EVO: dict[int, set[int]] = {
    52: {863},  # meowth ↛ perrserker
    83: {865},
    122: {866},  # mr-mime ↛ mr-rime
    194: {980},
    211: {904},
    215: {903},
    222: {864},
    264: {862},  # kantonian linoone ↛ obstagoon
    562: {867},
}

# After edits, rewrite evolves_from / family for these national ids that moved
# Maps national_id → new evolves_from (form id or None)
NATIONAL_FROM_OVERRIDE: dict[int, int | None] = {
    862: 10175,  # obstagoon from linoone-galar
    863: 10161,  # perrserker from meowth-galar
    864: 10173,
    865: 10166,
    866: 10168,
    867: 10179,
    903: 10235,
    904: 10234,
    980: 10253,
}


def curl_bytes(url: str, retries: int = 5) -> bytes:
    last = None
    for attempt in range(retries):
        r = subprocess.run(
            ["curl", "-fsSL", "--max-time", "45", "-A", "Mozilla/5.0 regional-forms/1.0", url],
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


STAGE_RATE = {1: 1.0, 2: 0.28, 3: 0.09}


def spawn_rate(entry: dict, stage: int) -> float:
    rng = random.Random(entry["id"] * 9973 + 77)
    _, rarity = rarity_of(entry)
    base = {
        "very-common": rng.uniform(30, 42),
        "common": rng.uniform(22, 32),
        "uncommon": rng.uniform(10, 18),
        "rare": rng.uniform(3.5, 8),
        "ultra-rare": rng.uniform(1.2, 3),
        "legendary": rng.uniform(0.12, 0.45),
        "mythical": rng.uniform(0.05, 0.22),
    }[rarity]
    base *= STAGE_RATE.get(stage, 0.09)
    return round(max(0.05, base * (0.92 + rng.random() * 0.16)), 2)


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


def display_names(form: str, region: str, base_zh: str, base_en: str) -> tuple[str, str]:
    if form in TAUROS_ZH:
        return TAUROS_ZH[form], TAUROS_EN[form]
    return f"{region}{base_zh}", f"{REGION_EN[region]} {base_en}"


def evo_cond(trigger: str = "level-up", **extra) -> list[dict]:
    d = {"trigger": trigger, **extra}
    return [{k: v for k, v in d.items() if v is not None}]


def set_evolves_to(entry: dict, target_ids: list[int], conditions: list[dict] | None = None) -> None:
    cond = conditions or evo_cond()
    entry["evolution"]["evolves_to"] = [{"id": tid, "conditions": cond} for tid in target_ids]


def rebuild_families(by: dict[int, dict]) -> None:
    """Rebuild family lists from evolves_to / evolves_from edges (no dupes)."""
    children: dict[int, list[int]] = {i: [] for i in by}
    parent: dict[int, int | None] = {i: None for i in by}
    for pid, p in by.items():
        evo = p.get("evolution") or {}
        for t in evo.get("evolves_to") or []:
            tid = t["id"]
            if tid in by and tid not in children[pid]:
                children[pid].append(tid)
    for pid, kids in children.items():
        for tid in kids:
            parent[tid] = pid
    for pid, p in by.items():
        ef = (p.get("evolution") or {}).get("evolves_from")
        if ef is not None and ef in by and parent.get(pid) is None:
            parent[pid] = ef
            if pid not in children[ef]:
                children[ef].append(pid)

    def root_of(i: int) -> int:
        seen = set()
        while parent.get(i) is not None and i not in seen:
            seen.add(i)
            i = parent[i]  # type: ignore
        return i

    def walk(i: int) -> list[int]:
        out = [i]
        for c in children.get(i) or []:
            out.extend(walk(c))
        return out

    for pid, p in by.items():
        r = root_of(pid)
        fam = walk(r)
        seen_ids: set[int] = set()
        uniq: list[int] = []
        for x in fam:
            if x not in seen_ids:
                seen_ids.add(x)
                uniq.append(x)
        p["evolution"]["family"] = uniq
        p["evolution"]["evolves_from"] = parent.get(pid)
        depth = {r: 1}

        def fill(n: int, d: int) -> None:
            for c in children.get(n) or []:
                depth[c] = d + 1
                fill(c, d + 1)

        fill(r, 1)
        p["evolution"]["stage"] = depth.get(pid, 1)
        old_cond = {t["id"]: t.get("conditions") for t in (p["evolution"].get("evolves_to") or [])}
        p["evolution"]["evolves_to"] = [
            {"id": c, "conditions": old_cond.get(c) or evo_cond()} for c in children[pid]
        ]


def main() -> None:
    forms_meta = json.loads((DATA / "regional_forms_pokemon_ids.json").read_text(encoding="utf-8"))
    dex = json.loads((DATA / "pokemon.json").read_text(encoding="utf-8"))
    by = {p["id"]: p for p in dex}
    assert 1025 in by and max(i for i in by if i < 10000) == 1025

    # Skip if already added
    existing_forms = [p for p in dex if p["id"] >= 10000]
    if existing_forms:
        print(f"Found {len(existing_forms)} existing form entries — rebuilding from scratch of forms")
        dex = [p for p in dex if p["id"] < 10000]
        by = {p["id"]: p for p in dex}

    print("Fetching form pokemon + species flags...")
    form_cache_path = DATA / "regional_forms_detail_cache.json"
    if form_cache_path.exists():
        details = {int(k): v for k, v in json.loads(form_cache_path.read_text()).items()}
    else:
        details = {}

    need = [row for row in forms_meta if row["poke_id"] not in details]
    if need:
        def fetch_one(row: dict) -> tuple[int, dict]:
            pid = row["poke_id"]
            pk = curl_json(f"https://pokeapi.co/api/v2/pokemon/{pid}")
            sp = curl_json(pk["species"]["url"])
            stats = {s["stat"]["name"]: s["base_stat"] for s in pk["stats"]}
            total = sum(stats.values())
            return pid, {
                "id": pid,
                "species_id": row["species_id"],
                "form": row["form"],
                "region": row["region"],
                "base_zh": row["name_zh"],
                "types": [t["type"]["name"] for t in sorted(pk["types"], key=lambda x: x["slot"])],
                "stats": stats,
                "total": total,
                "capture_rate": sp["capture_rate"],
                "is_legendary": sp["is_legendary"],
                "is_mythical": sp["is_mythical"],
                "species_name_en": next(
                    (n["name"] for n in sp["names"] if n["language"]["name"] == "en"), sp["name"]
                ),
            }

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futs = [pool.submit(fetch_one, row) for row in need]
            done = 0
            for fut in as_completed(futs):
                pid, d = fut.result()
                details[pid] = d
                done += 1
                if done % 15 == 0 or done == len(need):
                    print(f"  detail {done}/{len(need)}", flush=True)
        form_cache_path.write_text(
            json.dumps({str(k): v for k, v in sorted(details.items())}, ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )

    print("Downloading form artwork...")
    jobs = []
    for row in forms_meta:
        if row["form"] in SKIP_FORMS:
            continue
        pid = row["poke_id"]
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
                if done % 20 == 0 or done == len(jobs):
                    print(f"  images {done}/{len(jobs)}", flush=True)

    # --- Patch base species evolutions (remove regional-only targets) ---
    print("Patching base evolution targets...")
    for pid, remove in BASE_REMOVE_EVO.items():
        p = by[pid]
        before = [t["id"] for t in p["evolution"]["evolves_to"]]
        p["evolution"]["evolves_to"] = [t for t in p["evolution"]["evolves_to"] if t["id"] not in remove]
        after = [t["id"] for t in p["evolution"]["evolves_to"]]
        if before != after:
            print(f"  #{pid} {p['name_zh']}: {before} → {after}")

    # Add branch targets on shared parents
    for parent_id, form_id in BRANCH_FROM_NORMAL:
        p = by[parent_id]
        existing = {t["id"] for t in p["evolution"]["evolves_to"]}
        if form_id not in existing:
            p["evolution"]["evolves_to"].append({"id": form_id, "conditions": evo_cond()})
            print(f"  branch #{parent_id} {p['name_zh']} += {form_id}")

    # Build form entries
    print("Building form entries...")
    new_entries = []
    for row in forms_meta:
        if row["form"] in SKIP_FORMS:
            continue
        pid = row["poke_id"]
        d = details[pid]
        region = d["region"]
        zh, en = display_names(d["form"], region, d["base_zh"], d["species_name_en"])
        total = d["total"]
        pb = round_pb(total)
        flags = {
            "is_legendary": d["is_legendary"],
            "is_mythical": d["is_mythical"],
            "capture_rate": d["capture_rate"],
        }
        # Galarian birds keep legendary
        rm, rarity = rarity_of(flags)
        to_ids = FORM_EVO.get(pid, [])
        # provisional stage: 1 if no form-pre in FORM_EVO pointing here as only parent among forms
        stage = 1
        entry = {
            "id": pid,
            "name_en": en,
            "name_zh": zh,
            "identifier": d["form"],
            "capture_rate": d["capture_rate"],
            "generation": FORM_GEN[region],
            "is_legendary": d["is_legendary"],
            "is_mythical": d["is_mythical"],
            "image": f"images/{pid:03d}.png" if (IMG / f"{pid:03d}.png").exists() else None,
            "types": d["types"],
            "image_shiny": f"images/shiny/{pid:03d}.png"
            if (SHINY / f"{pid:03d}.png").exists()
            else None,
            "image_shiny_url": shiny_urls(pid)[0],
            "image_url": artwork_urls(pid)[0],
            "evolution": {
                "chain_id": 100000 + pid,
                "family": [pid],
                "evolves_from": None,
                "evolves_to": [{"id": t, "conditions": evo_cond()} for t in to_ids],
                "stage": stage,
            },
            "rarity": rarity,
            "spawn_areas": [],  # fill after stage known
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
            "regions": [region],
            "regional_form": region,
            "base_species_id": d["species_id"],
        }
        new_entries.append(entry)

    # Merge
    for e in new_entries:
        by[e["id"]] = e
        dex.append(e)

    # Set evolves_from for form-to-form from FORM_EVO reverse + BRANCH parents
    form_ids = {e["id"] for e in new_entries}
    for src, targets in FORM_EVO.items():
        for tid in targets:
            if tid in by:
                by[tid]["evolution"]["evolves_from"] = src
    for parent_id, form_id in BRANCH_FROM_NORMAL:
        by[form_id]["evolution"]["evolves_from"] = parent_id

    for nid, fid in NATIONAL_FROM_OVERRIDE.items():
        by[nid]["evolution"]["evolves_from"] = fid

    # Ensure form evolves_to lists match FORM_EVO
    for fid, targets in FORM_EVO.items():
        if fid in by:
            set_evolves_to(by[fid], targets)

    rebuild_families(by)

    # Spawn areas for forms (after stage)
    for e in new_entries:
        region = e["regional_form"]
        stage = e["evolution"]["stage"]
        rate = spawn_rate(e, stage)
        e["spawn_areas"] = [{"area": region, "rate": rate}]
        e["regions"] = [region]

    # Phione / Manaphy untouched
    for pid in (489, 490):
        by[pid]["evolution"]["evolves_to"] = []
        by[pid]["evolution"]["evolves_from"] = None
        by[pid]["evolution"]["family"] = [pid]
        by[pid]["evolution"]["stage"] = 1

    dex = sorted(by.values(), key=lambda p: p["id"])
    (DATA / "pokemon.json").write_text(json.dumps(dex, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(dex)} entries ({len(new_entries)} regional forms)")

    # Verification samples
    samples = [
        10091, 10092, 25, 26, 10100, 52, 10107, 10108, 10161, 863,
        211, 10234, 904, 215, 10235, 903, 194, 10253, 980,
        83, 10166, 865, 264, 10175, 862, 704, 10241, 10242, 439, 122, 10168, 866,
    ]
    for pid in samples:
        p = by[pid]
        print(
            f"  #{pid} {p['name_zh']}: from={p['evolution']['evolves_from']} "
            f"to={[t['id'] for t in p['evolution']['evolves_to']]} "
            f"fam_len={len(p['evolution']['family'])} stage={p['evolution']['stage']}"
        )


if __name__ == "__main__":
    main()
