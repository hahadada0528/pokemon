#!/usr/bin/env python3
"""Extend National Dex with Hisui (PLA) + Paldea/SV (incl. DLC) #899–1025.

- Fetch species/stats/images/evolution from PokeAPI
- Update evolution chains on existing #1–898 (new branches)
- Assign 洗翠 / 帕底亚 spawn areas from regional pokedex lists
- Preserve Phione ↛ Manaphy (separate finals)
- Does NOT rewrite existing regional spawn rates for 关都…伽勒尔
"""

from __future__ import annotations

import json
import random
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
IMG_DIR = DATA_DIR / "images"
SHINY_DIR = IMG_DIR / "shiny"

OLD_MAX = 898
MAX_ID = 1025
WORKERS = 20
MIN_ARTWORK_BYTES = 20_000

AREA_HISUI = "洗翠"
AREA_PALDEA = "帕底亚"

# Keep Phione / Manaphy as separate non-linked finals (project rule).
PHIONE_ID = 489
MANAPHY_ID = 490


def curl_bytes(url: str, retries: int = 5) -> bytes:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            result = subprocess.run(
                [
                    "curl",
                    "-fsSL",
                    "--max-time",
                    "45",
                    "-A",
                    "Mozilla/5.0 pokemon-extend/1.0",
                    url,
                ],
                capture_output=True,
                check=False,
            )
            if result.returncode == 0 and result.stdout:
                return result.stdout
            last_err = RuntimeError(
                result.stderr.decode("utf-8", errors="replace") or f"curl exit {result.returncode}"
            )
        except Exception as e:  # noqa: BLE001
            last_err = e
        time.sleep(0.35 * (attempt + 1))
    raise RuntimeError(f"Failed to GET {url}: {last_err}")


def curl_json(url: str) -> dict:
    return json.loads(curl_bytes(url).decode("utf-8"))


def species_id_from_url(url: str) -> int:
    m = re.search(r"/pokemon-species/(\d+)/?", url)
    if not m:
        raise ValueError(url)
    return int(m.group(1))


def name_zh_or_en(species: dict) -> tuple[str, str]:
    en = species["name"]
    zh = en
    for n in species.get("names", []):
        lang = n["language"]["name"].lower()
        if lang == "en":
            en = n["name"]
        elif lang == "zh-hans":
            zh = n["name"]
            break
        elif lang == "zh-hant" and zh == species["name"]:
            zh = n["name"]
    for n in species.get("names", []):
        if n["language"]["name"].lower() == "zh-hans":
            zh = n["name"]
            break
    return en, zh


def artwork_urls(poke_id: int) -> list[str]:
    return [
        f"https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/{poke_id}.png",
        f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{poke_id}.png",
        f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{poke_id}.png",
    ]


def shiny_urls(poke_id: int) -> list[str]:
    return [
        f"https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/shiny/{poke_id}.png",
        f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/shiny/{poke_id}.png",
        f"https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/shiny/{poke_id}.png",
    ]


def img_name(poke_id: int) -> str:
    return f"{poke_id:03d}.png"


def round_power_base(total: int) -> int:
    """Nearest 10, halves round away from zero (405 → 410)."""
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


def spawn_rate_for(entry: dict, stage: int) -> float:
    rng = random.Random(entry["id"] * 9973 + 42)
    _, rarity = rarity_of(entry)
    base_primary = {
        "very-common": rng.uniform(30, 42),
        "common": rng.uniform(22, 32),
        "uncommon": rng.uniform(10, 18),
        "rare": rng.uniform(3.5, 8),
        "ultra-rare": rng.uniform(1.2, 3),
        "legendary": rng.uniform(0.12, 0.45),
        "mythical": rng.uniform(0.05, 0.22),
    }[rarity]
    base_primary *= STAGE_RATE.get(stage, 0.09)
    return round(max(0.05, base_primary * (0.92 + rng.random() * 0.16)), 2)


def parse_chain_node(node: dict) -> dict:
    sid = species_id_from_url(node["species"]["url"])
    children = []
    for child in node.get("evolves_to", []):
        details = []
        for d in child.get("evolution_details", []) or []:
            details.append(
                {
                    "trigger": (d.get("trigger") or {}).get("name"),
                    "min_level": d.get("min_level"),
                    "item": (d.get("item") or {}).get("name"),
                    "held_item": (d.get("held_item") or {}).get("name"),
                    "known_move": (d.get("known_move") or {}).get("name"),
                    "known_move_type": (d.get("known_move_type") or {}).get("name"),
                    "location": (d.get("location") or {}).get("name"),
                    "min_happiness": d.get("min_happiness"),
                    "min_affection": d.get("min_affection"),
                    "min_beauty": d.get("min_beauty"),
                    "time_of_day": d.get("time_of_day") or None,
                    "gender": d.get("gender"),
                    "needs_overworld_rain": d.get("needs_overworld_rain"),
                    "turn_upside_down": d.get("turn_upside_down"),
                    "trade_species": (d.get("trade_species") or {}).get("name"),
                    "relative_physical_stats": d.get("relative_physical_stats"),
                }
            )
            details[-1] = {k: v for k, v in details[-1].items() if v not in (None, False, "")}
        children.append(
            {
                "id": species_id_from_url(child["species"]["url"]),
                "conditions": details,
                "evolves_to": parse_chain_node(child)["evolves_to"],
            }
        )
    return {"id": sid, "evolves_to": children}


def flatten_family(tree: dict) -> list[int]:
    ids = [tree["id"]]
    for child in tree["evolves_to"]:
        ids.extend(flatten_family({"id": child["id"], "evolves_to": child["evolves_to"]}))
    return ids


def collect_edges(tree: dict, edges: list | None = None) -> list:
    if edges is None:
        edges = []
    for child in tree["evolves_to"]:
        edges.append({"from": tree["id"], "to": child["id"], "conditions": child["conditions"]})
        collect_edges({"id": child["id"], "evolves_to": child["evolves_to"]}, edges)
    return edges


def evolution_for(poke_id: int, chain_id: int, chains: dict[int, dict]) -> dict:
    ch = chains.get(chain_id)
    if not ch:
        return {
            "chain_id": chain_id,
            "family": [poke_id],
            "evolves_from": None,
            "evolves_to": [],
            "stage": 1,
        }
    from_id = None
    to_list = []
    for e in ch["edges"]:
        if e["to"] == poke_id:
            from_id = e["from"]
        if e["from"] == poke_id:
            to_list.append({"id": e["to"], "conditions": e["conditions"]})

    stage = 1
    if from_id is not None:
        depth = {ch["tree"]["id"]: 1}

        def walk(node, d):
            for c in node["evolves_to"]:
                depth[c["id"]] = d + 1
                walk(c, d + 1)

        walk(ch["tree"], 1)
        stage = depth.get(poke_id, 1)

    to_list = [t for t in to_list if t["id"] <= MAX_ID]
    family = [i for i in ch["family"] if i <= MAX_ID]
    if from_id is not None and from_id > MAX_ID:
        from_id = None

    # Project rule: Phione does not evolve into Manaphy.
    if poke_id == PHIONE_ID:
        to_list = [t for t in to_list if t["id"] != MANAPHY_ID]
        family = [i for i in family if i != MANAPHY_ID]
        if not family:
            family = [PHIONE_ID]
    if poke_id == MANAPHY_ID:
        if from_id == PHIONE_ID:
            from_id = None
        family = [i for i in family if i != PHIONE_ID]
        if not family:
            family = [MANAPHY_ID]

    return {
        "chain_id": chain_id,
        "family": family,
        "evolves_from": from_id,
        "evolves_to": to_list,
        "stage": stage,
    }


def pokedex_species_ids(name: str) -> set[int]:
    data = curl_json(f"https://pokeapi.co/api/v2/pokedex/{name}")
    out: set[int] = set()
    for e in data["pokemon_entries"]:
        sid = species_id_from_url(e["pokemon_species"]["url"])
        if sid <= MAX_ID:
            out.add(sid)
    return out


def needs_image(dest: Path) -> bool:
    return not dest.exists() or dest.stat().st_size < MIN_ARTWORK_BYTES


def download_to(dest: Path, urls: list[str]) -> bool:
    if not needs_image(dest):
        return True
    last: Exception | None = None
    for url in urls:
        try:
            data = curl_bytes(url)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            if dest.stat().st_size >= MIN_ARTWORK_BYTES or url == urls[-1]:
                return dest.stat().st_size > 0
        except Exception as e:  # noqa: BLE001
            last = e
    print(f"  WARN image {dest.name}: {last}", file=sys.stderr)
    return dest.exists() and dest.stat().st_size > 0


def fetch_species_bundle(poke_id: int) -> dict:
    species = curl_json(f"https://pokeapi.co/api/v2/pokemon-species/{poke_id}")
    poke = curl_json(f"https://pokeapi.co/api/v2/pokemon/{poke_id}")
    en, zh = name_zh_or_en(species)
    stats = {s["stat"]["name"]: s["base_stat"] for s in poke["stats"]}
    total = sum(stats.values())
    types = [t["type"]["name"] for t in sorted(poke["types"], key=lambda x: x["slot"])]
    evo_url = species["evolution_chain"]["url"]
    evo_id = int(evo_url.rstrip("/").split("/")[-1])
    habitat = (species.get("habitat") or {}).get("name")
    urls = artwork_urls(poke_id)
    power_base = round_power_base(total)
    entry_flags = {
        "is_legendary": species["is_legendary"],
        "is_mythical": species["is_mythical"],
        "capture_rate": species["capture_rate"],
    }
    rarity_mult, rarity = rarity_of(entry_flags)
    return {
        "id": poke_id,
        "name_en": en,
        "name_zh": zh,
        "identifier": species["name"],
        "capture_rate": species["capture_rate"],
        "generation": int(species["generation"]["url"].rstrip("/").split("/")[-1]),
        "is_legendary": species["is_legendary"],
        "is_mythical": species["is_mythical"],
        "image": f"images/{img_name(poke_id)}",
        "types": types,
        "image_shiny": f"images/shiny/{img_name(poke_id)}",
        "image_shiny_url": shiny_urls(poke_id)[0],
        "image_url": urls[0],
        "base_stats": {
            "hp": stats.get("hp", 0),
            "attack": stats.get("attack", 0),
            "defense": stats.get("defense", 0),
            "special_attack": stats.get("special-attack", 0),
            "special_defense": stats.get("special-defense", 0),
            "speed": stats.get("speed", 0),
            "total": total,
            "power_base": power_base,
        },
        "power_base": power_base,
        "rarity": rarity,
        "rarity_mult": rarity_mult,
        "species_power": power_base * rarity_mult,
        "evolution_chain_id": evo_id,
        "habitat": habitat,
        "_image_urls": urls,
        "_shiny_urls": shiny_urls(poke_id),
    }


def main() -> None:
    pokemon_path = DATA_DIR / "pokemon.json"
    entries: list[dict] = json.loads(pokemon_path.read_text(encoding="utf-8"))
    by_id = {e["id"]: e for e in entries}
    assert OLD_MAX in by_id and max(by_id) == OLD_MAX, f"expected max id {OLD_MAX}"

    print("Loading regional pokedex lists...")
    hisui_ids = pokedex_species_ids("hisui")
    paldea_ids = (
        pokedex_species_ids("paldea")
        | pokedex_species_ids("kitakami")
        | pokedex_species_ids("blueberry")
    )
    print(f"  洗翠 {len(hisui_ids)} · 帕底亚(含DLC) {len(paldea_ids)}")

    new_ids = list(range(OLD_MAX + 1, MAX_ID + 1))
    cache_path = DATA_DIR / "extend_899_1025_cache.json"
    if cache_path.exists():
        print(f"Loading new-species cache {cache_path}...")
        new_raw = {int(k): v for k, v in json.loads(cache_path.read_text(encoding="utf-8")).items()}
    else:
        new_raw = {}

    missing = [i for i in new_ids if i not in new_raw]
    if missing:
        print(f"Fetching {len(missing)} new species bundles...")
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(fetch_species_bundle, i): i for i in missing}
            done = 0
            for fut in as_completed(futures):
                i = futures[fut]
                try:
                    new_raw[i] = fut.result()
                except Exception as e:  # noqa: BLE001
                    print(f"  ERROR #{i}: {e}", file=sys.stderr)
                done += 1
                if done % 20 == 0 or done == len(missing):
                    print(f"  species {done}/{len(missing)}", flush=True)
        cache_path.write_text(
            json.dumps({str(k): v for k, v in sorted(new_raw.items())}, ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )
        print(f"Cached → {cache_path}")

    # Download artwork for new ids
    print("Downloading artwork (normal + shiny)...")
    todo_img = []
    for i in new_ids:
        raw = new_raw[i]
        todo_img.append((IMG_DIR / img_name(i), raw["_image_urls"]))
        todo_img.append((SHINY_DIR / img_name(i), raw["_shiny_urls"]))
    todo_img = [(d, u) for d, u in todo_img if needs_image(d)]
    if todo_img:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = [pool.submit(download_to, d, u) for d, u in todo_img]
            done = 0
            for fut in as_completed(futures):
                fut.result()
                done += 1
                if done % 40 == 0 or done == len(todo_img):
                    print(f"  images {done}/{len(todo_img)}", flush=True)

    # Evolution chains: all chain ids from old meta + new
    print("Collecting evolution chain ids...")
    chain_ids: set[int] = set()
    # Prefer chain ids from existing evolution blocks + new fetches
    for e in entries:
        cid = (e.get("evolution") or {}).get("chain_id")
        if cid:
            chain_ids.add(int(cid))
    for raw in new_raw.values():
        chain_ids.add(int(raw["evolution_chain_id"]))

    # Also refresh chain ids for species that gain new evolutions (from species API for parents)
    # Fetch species-extra for known parents that may have changed: use new_raw chain families later.
    chains_cache = DATA_DIR / "evolution_chains_1025.json"
    if chains_cache.exists():
        print(f"Loading chains cache {chains_cache}...")
        chains = {int(k): v for k, v in json.loads(chains_cache.read_text(encoding="utf-8")).items()}
    else:
        chains = {}

    need_chains = [cid for cid in chain_ids if cid not in chains]
    # Always re-fetch chains that include any new species — detect via API
    # Simpler: re-fetch ALL chain_ids to pick up new branches (Hisui/SV).
    print(f"Fetching {len(chain_ids)} evolution chains (refresh for new branches)...")
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {
            pool.submit(curl_json, f"https://pokeapi.co/api/v2/evolution-chain/{cid}/"): cid
            for cid in chain_ids
        }
        done = 0
        for fut in as_completed(futures):
            cid = futures[fut]
            try:
                raw = fut.result()
                tree = parse_chain_node(raw["chain"])
                family = flatten_family(tree)
                edges = collect_edges(tree)
                chains[cid] = {"chain_id": cid, "tree": tree, "family": family, "edges": edges}
            except Exception as e:  # noqa: BLE001
                print(f"  ERROR chain #{cid}: {e}", file=sys.stderr)
            done += 1
            if done % 40 == 0 or done == len(chain_ids):
                print(f"  chains {done}/{len(chain_ids)}", flush=True)

    # Discover additional chain ids referenced only by new species (already included)
    # Also fetch chains for any family member we might have missed via species endpoint
    extra_chain_ids: set[int] = set()
    for ch in chains.values():
        for sid in ch["family"]:
            if sid > OLD_MAX and sid <= MAX_ID and sid in new_raw:
                extra_chain_ids.add(new_raw[sid]["evolution_chain_id"])
    for cid in extra_chain_ids - set(chains):
        try:
            raw = curl_json(f"https://pokeapi.co/api/v2/evolution-chain/{cid}/")
            tree = parse_chain_node(raw["chain"])
            chains[cid] = {
                "chain_id": cid,
                "tree": tree,
                "family": flatten_family(tree),
                "edges": collect_edges(tree),
            }
        except Exception as e:  # noqa: BLE001
            print(f"  ERROR extra chain #{cid}: {e}", file=sys.stderr)

    chains_cache.write_text(
        json.dumps({str(k): v for k, v in sorted(chains.items())}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )

    # Map species → chain_id
    species_chain: dict[int, int] = {}
    for cid, ch in chains.items():
        for sid in ch["family"]:
            if sid <= MAX_ID:
                species_chain[sid] = cid
    for raw in new_raw.values():
        species_chain[raw["id"]] = raw["evolution_chain_id"]
    for e in entries:
        cid = (e.get("evolution") or {}).get("chain_id")
        if cid and e["id"] not in species_chain:
            species_chain[e["id"]] = int(cid)

    def existing_rate(entry: dict) -> float | None:
        areas = entry.get("spawn_areas") or []
        if not areas:
            return None
        return float(areas[0]["rate"])

    def ensure_area(entry: dict, area: str, rate: float) -> None:
        areas = entry.setdefault("spawn_areas", [])
        if any(a["area"] == area for a in areas):
            return
        areas.append({"area": area, "rate": rate})
        entry["regions"] = [a["area"] for a in areas]

    # Update evolution on existing entries + add new region membership
    print("Updating #1–898 evolution + 洗翠/帕底亚 regions...")
    evo_changed = 0
    for e in entries:
        pid = e["id"]
        cid = species_chain.get(pid) or (e.get("evolution") or {}).get("chain_id")
        if cid:
            new_evo = evolution_for(pid, int(cid), chains)
            old_to = [t["id"] for t in (e.get("evolution") or {}).get("evolves_to") or []]
            new_to = [t["id"] for t in new_evo["evolves_to"]]
            if old_to != new_to or (e.get("evolution") or {}).get("family") != new_evo["family"]:
                evo_changed += 1
            e["evolution"] = new_evo

        rate = existing_rate(e)
        stage = (e.get("evolution") or {}).get("stage") or 1
        if rate is None:
            rate = spawn_rate_for(e, stage)
        if pid in hisui_ids:
            ensure_area(e, AREA_HISUI, rate)
        if pid in paldea_ids:
            ensure_area(e, AREA_PALDEA, rate)

    print(f"  evolution families updated: {evo_changed}")

    # Build new entries
    print("Building #899–1025 entries...")
    new_entries = []
    for i in new_ids:
        raw = dict(new_raw[i])
        cid = raw.pop("evolution_chain_id")
        habitat = raw.pop("habitat", None)
        raw.pop("_image_urls", None)
        raw.pop("_shiny_urls", None)
        evo = evolution_for(i, cid, chains)
        rate = spawn_rate_for(raw, evo["stage"])
        spawns = []
        if i in hisui_ids:
            spawns.append({"area": AREA_HISUI, "rate": rate})
        if i in paldea_ids:
            spawns.append({"area": AREA_PALDEA, "rate": rate})
        if not spawns:
            # fallback: gen8 hisui leftovers → 洗翠, else 帕底亚
            area = AREA_HISUI if i <= 905 else AREA_PALDEA
            spawns.append({"area": area, "rate": rate})
        has_img = (IMG_DIR / img_name(i)).exists()
        has_shiny = (SHINY_DIR / img_name(i)).exists()
        entry = {
            **{k: raw[k] for k in raw if k not in ("image", "image_shiny")},
            "image": f"images/{img_name(i)}" if has_img else None,
            "image_shiny": f"images/shiny/{img_name(i)}" if has_shiny else None,
            "evolution": evo,
            "spawn_areas": spawns,
            "regions": [a["area"] for a in spawns],
        }
        new_entries.append(entry)

    # Force Phione/Manaphy split on final write
    for e in entries:
        if e["id"] == PHIONE_ID:
            e["evolution"] = {
                **e["evolution"],
                "evolves_from": None,
                "evolves_to": [],
                "family": [PHIONE_ID],
                "stage": 1,
            }
        if e["id"] == MANAPHY_ID:
            e["evolution"] = {
                **e["evolution"],
                "evolves_from": None,
                "evolves_to": [],
                "family": [MANAPHY_ID],
                "stage": 1,
            }

    merged = entries + new_entries
    merged.sort(key=lambda x: x["id"])
    assert len(merged) == MAX_ID, len(merged)

    pokemon_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(merged)} → {pokemon_path}")

    # Quick checks
    samples = [234, 123, 217, 57, 203, 206, 899, 900, 906, 1000, 1025, 489, 490]
    by = {e["id"]: e for e in merged}
    for pid in samples:
        e = by[pid]
        print(
            f"  #{pid} {e['name_zh']} evo_to={[t['id'] for t in e['evolution']['evolves_to']]} "
            f"regions={e.get('regions')} power={e.get('species_power')}"
        )
    hisui_n = sum(1 for e in merged if any(a["area"] == AREA_HISUI for a in e["spawn_areas"]))
    paldea_n = sum(1 for e in merged if any(a["area"] == AREA_PALDEA for a in e["spawn_areas"]))
    print(f"Spawn counts: 洗翠={hisui_n} 帕底亚={paldea_n}")


if __name__ == "__main__":
    main()
