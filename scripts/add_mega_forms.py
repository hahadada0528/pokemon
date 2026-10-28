#!/usr/bin/env python3
"""Add Mega Evolutions as independent dex entries (not primal / gigantamax / totem).

Does not rebuild regional forms. Skips poke IDs already in pokemon.json.
"""

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
CACHE_PATH = DATA / "mega_forms_detail_cache.json"

SKIP_TOKENS = ("primal", "gmax", "gigantamax", "totem")
SKIP_IDENTS = {
    "tatsugiri-droopy-mega",
    "tatsugiri-stretchy-mega",
    "meowstic-female-mega",
    "magearna-original-mega",
}


def curl_bytes(url: str, retries: int = 5) -> bytes:
    last = None
    for attempt in range(retries):
        r = subprocess.run(
            ["curl", "-fsSL", "--max-time", "45", "-A", "Mozilla/5.0 mega-forms/1.0", url],
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


def pick_name(names: list[dict], langs: tuple[str, ...]) -> str | None:
    by_lang = {(n["language"]["name"] or "").lower(): n["name"] for n in names if n.get("name")}
    for lang in langs:
        if by_lang.get(lang.lower()):
            return by_lang[lang.lower()]
    return None


def mega_zh_from_base(base_zh: str, ident: str) -> str:
    ident = (ident or "").lower()
    suffix = ""
    if ident.endswith("-mega-x") or ident.endswith("mega-x"):
        suffix = "X"
    elif ident.endswith("-mega-y") or ident.endswith("mega-y"):
        suffix = "Y"
    elif ident.endswith("-mega-z") or ident.endswith("mega-z"):
        suffix = "Z"
    return f"超级{base_zh}{suffix}"


def is_mega_identifier(ident: str) -> bool:
    ident = (ident or "").lower()
    if ident in SKIP_IDENTS:
        return False
    if "-mega" not in ident:
        return False
    return not any(tok in ident for tok in SKIP_TOKENS)


def list_mega_pokemon() -> list[tuple[int, str]]:
    listing = curl_json("https://pokeapi.co/api/v2/pokemon?limit=20000")
    out: list[tuple[int, str]] = []
    for row in listing.get("results") or []:
        name = row.get("name") or ""
        if not is_mega_identifier(name):
            continue
        url = row.get("url") or ""
        pid = int(url.rstrip("/").split("/")[-1])
        out.append((pid, name))
    out.sort()
    return out


def fetch_one(pid: int, ident: str) -> dict:
    pk = curl_json(f"https://pokeapi.co/api/v2/pokemon/{pid}")
    sp = curl_json(pk["species"]["url"])
    form = None
    for f in pk.get("forms") or []:
        if (f.get("name") or "").lower() == ident.lower() or ident.lower() in (f.get("name") or "").lower():
            form = curl_json(f["url"])
            break
    if form is None and pk.get("forms"):
        form = curl_json(pk["forms"][0]["url"])
    form_names = (form or {}).get("names") or []
    stats = {s["stat"]["name"]: s["base_stat"] for s in pk["stats"]}
    total = sum(stats.values())
    species_id = int(pk["species"]["url"].rstrip("/").split("/")[-1])
    zh = pick_name(form_names, ("zh-hans", "zh-hant", "zh-Hans", "zh-Hant"))
    en = pick_name(form_names, ("en",)) or ident.replace("-", " ").title()
    if not zh:
        base_zh = pick_name(sp.get("names") or [], ("zh-hans", "zh-hant", "zh-Hans", "zh-Hant")) or ident
        zh = mega_zh_from_base(base_zh, ident)
    return {
        "id": pid,
        "identifier": pk.get("name") or ident,
        "species_id": species_id,
        "name_zh": zh,
        "name_en": en,
        "types": [t["type"]["name"] for t in sorted(pk["types"], key=lambda x: x["slot"])],
        "stats": stats,
        "total": total,
        "capture_rate": sp["capture_rate"],
        "is_legendary": sp["is_legendary"],
        "is_mythical": sp["is_mythical"],
        "generation": 6,
    }


def main() -> None:
    dex = json.loads((DATA / "pokemon.json").read_text(encoding="utf-8"))
    by = {p["id"]: p for p in dex}

    print("Listing Mega Pokémon from PokeAPI...")
    megas = list_mega_pokemon()
    print(f"  found {len(megas)} mega identifiers")
    for pid, name in megas:
        print(f"    {pid} {name}")

    if CACHE_PATH.exists():
        details = {int(k): v for k, v in json.loads(CACHE_PATH.read_text(encoding="utf-8")).items()}
    else:
        details = {}

    need = [(pid, ident) for pid, ident in megas if pid not in details]
    if need:
        print(f"Fetching {len(need)} mega details...")

        def job(row: tuple[int, str]) -> tuple[int, dict]:
            return row[0], fetch_one(row[0], row[1])

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futs = [pool.submit(job, row) for row in need]
            done = 0
            for fut in as_completed(futs):
                pid, d = fut.result()
                details[pid] = d
                done += 1
                if done % 10 == 0 or done == len(need):
                    print(f"  detail {done}/{len(need)}", flush=True)
        CACHE_PATH.write_text(
            json.dumps({str(k): v for k, v in sorted(details.items())}, ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )

    print("Downloading mega artwork...")
    jobs = []
    for pid, _ident in megas:
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
    else:
        print("  images already present")

    new_entries = []
    skipped = 0
    for pid, ident in megas:
        if pid in by:
            skipped += 1
            continue
        d = details[pid]
        base = by.get(d["species_id"])
        if base and base.get("name_zh"):
            form_zh = d.get("name_zh") or ""
            if (not form_zh) or any(ch.isascii() and ch.isalpha() for ch in form_zh.replace("X", "").replace("Y", "").replace("Z", "")):
                d["name_zh"] = mega_zh_from_base(base["name_zh"], d.get("identifier") or ident)
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
        entry = {
            "id": pid,
            "name_en": d["name_en"],
            "name_zh": d["name_zh"],
            "identifier": d["identifier"] if "-mega" in d["identifier"] else ident,
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
                "chain_id": 200000 + pid,
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
            "mega_form": True,
            "mega_of": d["species_id"],
        }
        new_entries.append(entry)
        by[pid] = entry
        dex.append(entry)

    if not new_entries:
        print(f"No new megas to add (skipped {skipped} already present)")
        return

    dex = sorted(by.values(), key=lambda p: p["id"])
    (DATA / "pokemon.json").write_text(json.dumps(dex, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(dex)} entries ({len(new_entries)} new megas, skipped {skipped})")
    for e in new_entries:
        print(f"  #{e['id']} {e['name_zh']} / {e['name_en']} mega_of={e['mega_of']} ident={e['identifier']}")


if __name__ == "__main__":
    main()
