#!/usr/bin/env python3
"""Enrich Pokémon data: shiny images, evolution chains, spawn areas + rates."""

from __future__ import annotations

import csv
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
MAX_ID = 1025
WORKERS = 24
MIN_ARTWORK_BYTES = 20_000

# 注意：线上 spawn_areas 已改为「地区图鉴」权重（见 scripts 或 data/pokemon.json）。
# 下列旧生物群系仅作历史 enrich 参考，勿再覆盖现行地区图鉴数据。
# 洗翠 / 帕底亚 由 scripts/extend_hisui_paldea.py 按地区图鉴写入，勿用本脚本覆盖。
AREAS = ["关都", "城都", "丰缘", "神奥", "合众", "卡洛斯", "阿罗拉", "伽勒尔", "洗翠", "帕底亚"]

# Type → preferred spawn areas (ordered, higher preference first)
TYPE_AREAS: dict[str, list[str]] = {
    "normal": ["草原", "树林", "山地"],
    "fire": ["火山", "沙漠", "山地"],
    "water": ["海洋", "洞穴"],
    "electric": ["草原", "山地", "洞穴"],
    "grass": ["树林", "草原"],
    "ice": ["冰川", "山地", "海洋"],
    "fighting": ["山地", "草原", "洞穴"],
    "poison": ["树林", "洞穴"],
    "ground": ["沙漠", "洞穴", "山地"],
    "flying": ["山地", "草原", "树林"],
    "psychic": ["洞穴", "山地", "树林"],
    "bug": ["树林", "草原"],
    "rock": ["山地", "洞穴", "沙漠"],
    "ghost": ["洞穴", "树林"],
    "dragon": ["山地", "洞穴", "火山"],
    "dark": ["洞穴", "树林", "山地"],
    "steel": ["山地", "洞穴", "沙漠"],
    "fairy": ["树林", "草原", "山地"],
}

# PokeAPI habitat → our areas
HABITAT_AREAS: dict[str, list[str]] = {
    "cave": ["洞穴", "山地"],
    "forest": ["树林", "草原"],
    "grassland": ["草原", "树林"],
    "mountain": ["山地", "洞穴"],
    "rare": ["山地", "洞穴", "冰川"],
    "rough-terrain": ["沙漠", "山地", "火山"],
    "sea": ["海洋"],
    "urban": ["草原", "树林"],
    "waters-edge": ["海洋", "草原"],
}


def curl_bytes(url: str, retries: int = 5) -> bytes:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            result = subprocess.run(
                ["curl", "-fsSL", "--max-time", "45", "-A", "pokemon-enrich/1.0", url],
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
        time.sleep(0.3 * (attempt + 1))
    raise RuntimeError(f"Failed to GET {url}: {last_err}")


def curl_json(url: str) -> dict:
    return json.loads(curl_bytes(url).decode("utf-8"))


def species_id_from_url(url: str) -> int:
    m = re.search(r"/pokemon-species/(\d+)/?", url)
    if not m:
        raise ValueError(url)
    return int(m.group(1))


def shiny_urls(poke_id: int) -> list[str]:
    return [
        f"https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/shiny/{poke_id}.png",
        f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/shiny/{poke_id}.png",
        f"https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/shiny/{poke_id}.png",
    ]


def needs_shiny(dest: Path) -> bool:
    return not dest.exists() or dest.stat().st_size < MIN_ARTWORK_BYTES


def download_shiny(poke_id: int) -> bool:
    dest = SHINY_DIR / f"{poke_id:03d}.png"
    if not needs_shiny(dest):
        return True
    last: Exception | None = None
    for url in shiny_urls(poke_id):
        try:
            data = curl_bytes(url)
            dest.write_bytes(data)
            if dest.stat().st_size >= MIN_ARTWORK_BYTES or url == shiny_urls(poke_id)[-1]:
                return dest.stat().st_size > 0
        except Exception as e:  # noqa: BLE001
            last = e
    print(f"  WARN shiny #{poke_id}: {last}", file=sys.stderr)
    return dest.exists() and dest.stat().st_size > 0


def parse_chain_node(node: dict) -> dict:
    """Recursively parse evolution chain into a compact tree + adjacency."""
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
            # drop null-only noise
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


def collect_edges(tree: dict, parent: int | None = None, edges: list | None = None) -> list:
    if edges is None:
        edges = []
    if parent is not None:
        # find conditions from parent's children list — handled by caller
        pass
    for child in tree["evolves_to"]:
        edges.append({"from": tree["id"], "to": child["id"], "conditions": child["conditions"]})
        collect_edges({"id": child["id"], "evolves_to": child["evolves_to"]}, tree["id"], edges)
    return edges


def fetch_pokemon_meta(poke_id: int) -> dict:
    pk = curl_json(f"https://pokeapi.co/api/v2/pokemon/{poke_id}")
    types = [t["type"]["name"] for t in sorted(pk["types"], key=lambda x: x["slot"])]
    return {"id": poke_id, "types": types}


def fetch_species_extra(poke_id: int) -> dict:
    sp = curl_json(f"https://pokeapi.co/api/v2/pokemon-species/{poke_id}")
    habitat = (sp.get("habitat") or {}).get("name")
    evo_url = sp["evolution_chain"]["url"]
    evo_id = int(evo_url.rstrip("/").split("/")[-1])
    return {
        "id": poke_id,
        "habitat": habitat,
        "evolution_chain_id": evo_id,
        "evolution_chain_url": evo_url,
    }


def rarity_multiplier(entry: dict) -> tuple[float, str]:
    """Return (rate scale 0–1, rarity label)."""
    if entry.get("is_mythical"):
        return 0.04, "mythical"
    if entry.get("is_legendary"):
        return 0.06, "legendary"
    cr = entry.get("capture_rate", 45)
    if cr <= 3:
        return 0.08, "ultra-rare"
    if cr <= 15:
        return 0.18, "rare"
    if cr <= 45:
        return 0.45, "uncommon"
    if cr <= 120:
        return 0.75, "common"
    return 1.0, "very-common"


# Final evolutions are much less common in the wild than their base forms.
STAGE_RATE = {1: 1.0, 2: 0.28, 3: 0.09}


def assign_spawn_areas(
    entry: dict,
    types: list[str],
    habitat: str | None,
    rng: random.Random,
    stage: int = 1,
) -> list[dict]:
    """Assign 1–3 areas with encounter rates (%) for each."""
    scores: dict[str, float] = {a: 0.0 for a in AREAS}

    for i, t in enumerate(types):
        weight = 1.0 if i == 0 else 0.65
        for j, area in enumerate(TYPE_AREAS.get(t, ["草原", "树林"])):
            if area not in scores:
                continue
            scores[area] += weight * (1.0 - j * 0.25)

    if habitat and habitat in HABITAT_AREAS:
        for j, area in enumerate(HABITAT_AREAS[habitat]):
            scores[area] += 1.2 * (1.0 - j * 0.3)

    # Special-ish type combos
    if "water" in types and "ground" in types:
        scores["海洋"] += 0.8
        scores["沙漠"] += 0.4
    if "fire" in types and "rock" in types:
        scores["火山"] += 1.0
    if "ice" in types:
        scores["冰川"] += 1.2
    if "dragon" in types:
        scores["山地"] += 0.8

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    # Keep areas with meaningful score; 1–3 areas
    positive = [(a, s) for a, s in ranked if s > 0]
    if not positive:
        positive = [("草原", 1.0)]

    n = 1
    if len(positive) >= 2 and positive[1][1] >= positive[0][1] * 0.45:
        n = 2
    if len(positive) >= 3 and positive[2][1] >= positive[0][1] * 0.35 and n == 2:
        n = 3
    # Legendaries / mythicals: usually a single signature biome
    if entry.get("is_legendary") or entry.get("is_mythical"):
        if len(positive) > 1 and positive[1][1] >= positive[0][1] * 0.85:
            n = 2
        else:
            n = 1

    chosen = positive[:n]
    total = sum(s for _, s in chosen) or 1.0
    scale, rarity = rarity_multiplier(entry)

    # Base encounter % in primary area: common ~28–42, uncommon ~12–22, rare ~3–9, legend ~0.3–1.5
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

    spawns = []
    for i, (area, score) in enumerate(chosen):
        share = score / total
        # Secondary areas get lower absolute rates
        rate = base_primary * share / (chosen[0][1] / total) * (1.0 if i == 0 else 0.85)
        rate = round(max(0.05, rate * (0.92 + rng.random() * 0.16)), 2)
        spawns.append({"area": area, "rate": rate})

    # Ensure rates feel ordered by preference
    spawns.sort(key=lambda x: x["rate"], reverse=True)
    return spawns


def build_evolution_index(chain_ids: set[int]) -> dict[int, dict]:
    """chain_id → parsed tree; also map species_id → evolution binding."""
    chains: dict[int, dict] = {}
    print(f"Fetching {len(chain_ids)} evolution chains...")
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
            if done % 25 == 0 or done == len(chain_ids):
                print(f"  chains {done}/{len(chain_ids)}", flush=True)
    return chains


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

    # stage: 1 = root, else depth
    stage = 1
    if from_id is not None:
        # BFS depth
        depth = {ch["tree"]["id"]: 1}

        def walk(node, d):
            for c in node["evolves_to"]:
                depth[c["id"]] = d + 1
                walk(c, d + 1)

        walk(ch["tree"], 1)
        stage = depth.get(poke_id, 1)

    # 图鉴到 #1025（PLA + 朱紫含 DLC）。霏欧纳不连玛纳霏（项目规则）。
    to_list = [t for t in to_list if t["id"] <= MAX_ID]
    family = [i for i in ch["family"] if i <= MAX_ID]
    if from_id is not None and from_id > MAX_ID:
        from_id = None
    if poke_id == 489:  # Phione
        to_list = [t for t in to_list if t["id"] != 490]
        family = [i for i in family if i != 490] or [489]
    if poke_id == 490:  # Manaphy
        if from_id == 489:
            from_id = None
        family = [i for i in family if i != 489] or [490]
    return {
        "chain_id": chain_id,
        "family": family,
        "evolves_from": from_id,
        "evolves_to": to_list,
        "stage": stage,
    }


def write_outputs(entries: list[dict]) -> None:
    json_path = DATA_DIR / "pokemon.json"
    json_path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # CSV: flatten spawn areas; evolution as compact strings
    csv_path = DATA_DIR / "pokemon.csv"
    rows = []
    for e in entries:
        areas = e.get("spawn_areas") or []
        rows.append(
            {
                "id": e["id"],
                "name_en": e["name_en"],
                "name_zh": e["name_zh"],
                "identifier": e["identifier"],
                "capture_rate": e["capture_rate"],
                "generation": e["generation"],
                "types": ",".join(e.get("types") or []),
                "is_legendary": e["is_legendary"],
                "is_mythical": e["is_mythical"],
                "image": e.get("image"),
                "image_shiny": e.get("image_shiny"),
                "evolution_chain_id": (e.get("evolution") or {}).get("chain_id"),
                "evolves_from": (e.get("evolution") or {}).get("evolves_from"),
                "evolves_to": ",".join(
                    str(x["id"]) for x in ((e.get("evolution") or {}).get("evolves_to") or [])
                ),
                "evolution_family": ",".join(
                    str(x) for x in ((e.get("evolution") or {}).get("family") or [])
                ),
                "spawn_areas": ";".join(f"{a['area']}:{a['rate']}" for a in areas),
                "rarity": e.get("rarity"),
            }
        )

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else [])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(entries)} → {json_path}")
    print(f"CSV → {csv_path}")


def main() -> None:
    SHINY_DIR.mkdir(parents=True, exist_ok=True)
    pokemon_path = DATA_DIR / "pokemon.json"
    entries = json.loads(pokemon_path.read_text(encoding="utf-8"))
    assert len(entries) == MAX_ID

    # --- meta cache ---
    meta_cache = DATA_DIR / "meta_cache.json"
    if meta_cache.exists():
        print(f"Loading meta cache {meta_cache}...")
        meta = json.loads(meta_cache.read_text(encoding="utf-8"))
        types_map = {int(k): v["types"] for k, v in meta["types"].items()}
        species_map = {int(k): v for k, v in meta["species"].items()}
    else:
        print("Fetching types + species extras...")
        types_map = {}
        species_map = {}
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            f_types = {pool.submit(fetch_pokemon_meta, i): i for i in range(1, MAX_ID + 1)}
            f_sp = {pool.submit(fetch_species_extra, i): i for i in range(1, MAX_ID + 1)}
            done = 0
            for fut in as_completed(f_types):
                i = f_types[fut]
                try:
                    types_map[i] = fut.result()["types"]
                except Exception as e:  # noqa: BLE001
                    print(f"  ERROR types #{i}: {e}", file=sys.stderr)
                    types_map[i] = []
                done += 1
                if done % 100 == 0:
                    print(f"  types {done}/{MAX_ID}", flush=True)
            done = 0
            for fut in as_completed(f_sp):
                i = f_sp[fut]
                try:
                    species_map[i] = fut.result()
                except Exception as e:  # noqa: BLE001
                    print(f"  ERROR species #{i}: {e}", file=sys.stderr)
                    species_map[i] = {
                        "id": i,
                        "habitat": None,
                        "evolution_chain_id": None,
                        "evolution_chain_url": None,
                    }
                done += 1
                if done % 100 == 0:
                    print(f"  species-extra {done}/{MAX_ID}", flush=True)
        meta_cache.write_text(
            json.dumps(
                {
                    "types": {str(k): {"types": v} for k, v in types_map.items()},
                    "species": {str(k): v for k, v in species_map.items()},
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"Cached meta → {meta_cache}")

    chain_ids = {
        s["evolution_chain_id"]
        for s in species_map.values()
        if s.get("evolution_chain_id") is not None
    }
    chains_cache = DATA_DIR / "evolution_chains.json"
    if chains_cache.exists():
        print(f"Loading evolution chains {chains_cache}...")
        chains = {int(k): v for k, v in json.loads(chains_cache.read_text(encoding="utf-8")).items()}
    else:
        chains = build_evolution_index(chain_ids)
        chains_cache.write_text(
            json.dumps({str(k): v for k, v in chains.items()}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Cached chains → {chains_cache}")

    # --- shiny downloads ---
    todo = [i for i in range(1, MAX_ID + 1) if needs_shiny(SHINY_DIR / f"{i:03d}.png")]
    print(f"Downloading shiny artwork ({len(todo)} needed)...")
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(download_shiny, i) for i in todo]
        done = 0
        for fut in as_completed(futures):
            fut.result()
            done += 1
            if done % 50 == 0 or done == len(todo):
                print(f"  shiny {done}/{len(todo)}", flush=True)

    # --- enrich entries ---
    print("Assigning spawn areas + binding evolution...")
    enriched = []
    for e in entries:
        pid = e["id"]
        rng = random.Random(pid * 9973 + 42)  # stable per-id
        types = types_map.get(pid, [])
        sp = species_map.get(pid, {})
        chain_id = sp.get("evolution_chain_id")
        evo = evolution_for(pid, chain_id, chains) if chain_id else {
            "chain_id": None,
            "family": [pid],
            "evolves_from": None,
            "evolves_to": [],
            "stage": 1,
        }
        _, rarity = rarity_multiplier(e)
        spawns = assign_spawn_areas(e, types, sp.get("habitat"), rng, stage=evo["stage"])
        shiny_rel = f"images/shiny/{pid:03d}.png"
        shiny_ok = (SHINY_DIR / f"{pid:03d}.png").exists()

        enriched.append(
            {
                **{k: e[k] for k in e if k not in ("image_url",)},
                "types": types,
                "image_url": e.get("image_url"),
                "image_shiny": shiny_rel if shiny_ok else None,
                "image_shiny_url": shiny_urls(pid)[0],
                "evolution": evo,
                "rarity": rarity,
                "spawn_areas": spawns,
            }
        )

    write_outputs(enriched)

    shiny_ok = sum(1 for i in range(1, MAX_ID + 1) if (SHINY_DIR / f"{i:03d}.png").exists())
    good_shiny = sum(
        1
        for i in range(1, MAX_ID + 1)
        if (SHINY_DIR / f"{i:03d}.png").exists()
        and (SHINY_DIR / f"{i:03d}.png").stat().st_size >= MIN_ARTWORK_BYTES
    )
    print(f"Shiny images: {shiny_ok}/{MAX_ID} ({good_shiny} official-artwork quality)")
    # samples
    for pid in (1, 25, 133, 144, 150, 898):
        x = enriched[pid - 1]
        print(
            f"  #{pid:03d} {x['name_zh']} types={x['types']} rarity={x['rarity']} "
            f"spawn={x['spawn_areas']} evo_from={x['evolution']['evolves_from']} "
            f"evo_to={[t['id'] for t in x['evolution']['evolves_to']]}"
        )


if __name__ == "__main__":
    main()
