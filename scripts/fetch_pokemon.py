#!/usr/bin/env python3
"""Fetch Pokémon #1–1025 (through PLA + Scarlet/Violet DLC): id, name, capture rate, artwork.

Uses curl for HTTPS (macOS Python often lacks CA certs for urllib).
Images from jsDelivr CDN (faster than raw.githubusercontent.com).
Prefer scripts/extend_hisui_paldea.py to append #899–1025 onto an existing enriched dex.
"""

from __future__ import annotations

import csv
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
IMG_DIR = DATA_DIR / "images"
MAX_ID = 1025  # Pecharunt — National Dex through SV Indigo Disk
WORKERS = 24
MIN_ARTWORK_BYTES = 20_000  # official-artwork is typically 50–300KB; 96px fallback is ~1KB


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
                    "pokemon-data-fetcher/1.0",
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
        time.sleep(0.3 * (attempt + 1))
    raise RuntimeError(f"Failed to GET {url}: {last_err}")


def curl_json(url: str) -> dict:
    return json.loads(curl_bytes(url).decode("utf-8"))


def name_zh_or_en(species: dict) -> tuple[str, str]:
    en = species["name"]
    zh = en
    for n in species.get("names", []):
        lang = n["language"]["name"].lower()
        if lang == "en":
            en = n["name"]
        elif lang in ("zh-hans", "zh-hant") and zh == species["name"]:
            # Prefer simplified; fall back to traditional if that's all we have
            if lang == "zh-hans":
                zh = n["name"]
            elif zh == species["name"]:
                zh = n["name"]
    # Second pass: always prefer zh-hans when present
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


def fetch_species(poke_id: int) -> dict:
    species = curl_json(f"https://pokeapi.co/api/v2/pokemon-species/{poke_id}")
    en, zh = name_zh_or_en(species)
    urls = artwork_urls(poke_id)
    return {
        "id": poke_id,
        "name_en": en,
        "name_zh": zh,
        "identifier": species["name"],
        "capture_rate": species["capture_rate"],
        "generation": int(species["generation"]["url"].rstrip("/").split("/")[-1]),
        "is_legendary": species["is_legendary"],
        "is_mythical": species["is_mythical"],
        "image_url": urls[0],
        "image_urls": urls,
        "image_file": f"images/{poke_id:03d}.png",
    }


def needs_image(dest: Path) -> bool:
    if not dest.exists():
        return True
    return dest.stat().st_size < MIN_ARTWORK_BYTES


def download_image(entry: dict) -> dict:
    dest = IMG_DIR / f"{entry['id']:03d}.png"
    if not needs_image(dest):
        entry["image_downloaded"] = True
        return entry
    last: Exception | None = None
    for url in entry["image_urls"]:
        try:
            data = curl_bytes(url)
            dest.write_bytes(data)
            # Prefer real artwork; if we only got tiny fallback, keep trying
            if dest.stat().st_size >= MIN_ARTWORK_BYTES or url == entry["image_urls"][-1]:
                entry["image_downloaded"] = True
                entry["image_url"] = url if dest.stat().st_size >= MIN_ARTWORK_BYTES else entry["image_urls"][0]
                return entry
        except Exception as e:  # noqa: BLE001
            last = e
    print(f"  WARN image fail #{entry['id']}: {last}", file=sys.stderr)
    entry["image_downloaded"] = dest.exists() and dest.stat().st_size > 0
    return entry


def write_outputs(entries: list[dict]) -> None:
    public = []
    for e in entries:
        img_path = IMG_DIR / f"{e['id']:03d}.png"
        has_img = img_path.exists() and img_path.stat().st_size > 0
        public.append(
            {
                "id": e["id"],
                "name_en": e["name_en"],
                "name_zh": e["name_zh"],
                "identifier": e["identifier"],
                "capture_rate": e["capture_rate"],
                "generation": e["generation"],
                "is_legendary": e["is_legendary"],
                "is_mythical": e["is_mythical"],
                "image": e["image_file"] if has_img else None,
                "image_url": e["image_url"],
            }
        )

    json_path = DATA_DIR / "pokemon.json"
    json_path.write_text(json.dumps(public, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    csv_path = DATA_DIR / "pokemon.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "id",
                "name_en",
                "name_zh",
                "identifier",
                "capture_rate",
                "generation",
                "is_legendary",
                "is_mythical",
                "image",
                "image_url",
            ],
        )
        writer.writeheader()
        writer.writerows(public)

    ok_imgs = sum(1 for p in public if p["image"])
    good_art = sum(
        1
        for i in range(1, MAX_ID + 1)
        if (IMG_DIR / f"{i:03d}.png").exists()
        and (IMG_DIR / f"{i:03d}.png").stat().st_size >= MIN_ARTWORK_BYTES
    )
    print(f"Wrote {len(public)} Pokémon → {json_path}")
    print(f"CSV → {csv_path}")
    print(f"Images → {IMG_DIR} ({ok_imgs} files, {good_art} official-artwork quality)")


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)

    species_cache = DATA_DIR / "species_raw.json"
    entries: list[dict]

    if species_cache.exists():
        print(f"Loading cached species from {species_cache}...")
        entries = json.loads(species_cache.read_text(encoding="utf-8"))
        # ensure image url fields for older cache
        for e in entries:
            e["image_urls"] = artwork_urls(e["id"])
            e["image_url"] = e["image_urls"][0]
            e["image_file"] = f"images/{e['id']:03d}.png"
    else:
        print(f"Fetching species data for #{1}–#{MAX_ID}...")
        entries = []
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(fetch_species, i): i for i in range(1, MAX_ID + 1)}
            done = 0
            for fut in as_completed(futures):
                poke_id = futures[fut]
                try:
                    entries.append(fut.result())
                except Exception as e:  # noqa: BLE001
                    print(f"  ERROR species #{poke_id}: {e}", file=sys.stderr)
                done += 1
                if done % 50 == 0 or done == MAX_ID:
                    print(f"  species {done}/{MAX_ID}", flush=True)
        entries.sort(key=lambda e: e["id"])
        species_cache.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Cached species → {species_cache}")

    if len(entries) != MAX_ID:
        print(f"WARNING: got {len(entries)}/{MAX_ID} species", file=sys.stderr)

    # Persist metadata early so data is usable even if image download is interrupted
    write_outputs(entries)

    todo = [e for e in entries if needs_image(IMG_DIR / f"{e['id']:03d}.png")]
    print(f"Downloading/refreshing artwork ({len(todo)} needed, {MAX_ID - len(todo)} already good)...")
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(download_image, e) for e in todo]
        done = 0
        for fut in as_completed(futures):
            fut.result()
            done += 1
            if done % 50 == 0 or done == len(todo):
                print(f"  images {done}/{len(todo)}", flush=True)

    write_outputs(entries)
    if entries:
        print(
            f"Sample: #{entries[0]['id']} {entries[0]['name_zh']}/{entries[0]['name_en']} "
            f"catch={entries[0]['capture_rate']}"
        )
        print(
            f"Last:   #{entries[-1]['id']} {entries[-1]['name_zh']}/{entries[-1]['name_en']} "
            f"catch={entries[-1]['capture_rate']}"
        )


if __name__ == "__main__":
    main()
