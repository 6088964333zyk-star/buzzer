#!/usr/bin/env python3
"""
Render the built-in world map used by the map_pin question type.

Source: Natural Earth 1:110m land polygons (ne_110m_land.geojson),
        https://github.com/nvkelso/natural-earth-vector
License: public domain ("Everything here is public domain." — Natural Earth LICENSE.md)

Projection: equirectangular, x = (lon + 180) / 360, y = (90 - lat) / 180, so a
point's image fractions are exactly its map_pin coordinates (aspect ratio 2).
See docs/design-t7-map-question.md, D1 / Step 5.

One-off; the output is committed. Re-run only to change the map's look:
    python scripts/render_world_map.py
    python scripts/render_world_map.py --geojson ne_110m_land.geojson   # offline / no certs
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

SOURCE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_110m_land.geojson"
)
WIDTH, HEIGHT = 1200, 600
OCEAN, LAND, GRID = "#cfe3f2", "#9cc89a", "#b5d1e6"
ROOT = Path(__file__).resolve().parent.parent
TARGETS = [
    ROOT / f"frontend/{app}/public/world-map.svg" for app in ("player", "host", "admin")
]


def _project(lon: float, lat: float) -> str:
    x = (lon + 180) / 360 * WIDTH
    y = (90 - lat) / 180 * HEIGHT
    return f"{x:.1f},{y:.1f}"


def _rings(geometry: dict) -> list[list[list[float]]]:
    if geometry["type"] == "Polygon":
        return geometry["coordinates"]
    if geometry["type"] == "MultiPolygon":
        return [ring for poly in geometry["coordinates"] for ring in poly]
    return []


def render(geojson: dict) -> str:
    paths = []
    for feature in geojson["features"]:
        for ring in _rings(feature["geometry"]):
            points = " L".join(_project(lon, lat) for lon, lat in ring)
            paths.append(f"M{points}Z")
    graticule = "".join(
        f'<line x1="{x}" y1="0" x2="{x}" y2="{HEIGHT}"/>'
        for x in range(0, WIDTH + 1, 100)
    ) + "".join(
        f'<line x1="0" y1="{y}" x2="{WIDTH}" y2="{y}"/>'
        for y in range(0, HEIGHT + 1, 100)
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" '
        f'viewBox="0 0 {WIDTH} {HEIGHT}">'
        f"<!-- Natural Earth 1:110m land, public domain; equirectangular -->"
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="{OCEAN}"/>'
        f'<g stroke="{GRID}" stroke-width="1">{graticule}</g>'
        f'<path fill="{LAND}" stroke="#6f9e6d" stroke-width="0.6" d="{" ".join(paths)}"/>'
        f"</svg>\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument(
        "--geojson",
        type=Path,
        help="read a local ne_110m_land.geojson instead of downloading",
    )
    args = parser.parse_args()
    if args.geojson:
        geojson = json.loads(args.geojson.read_text())
    else:
        with urllib.request.urlopen(SOURCE_URL, timeout=30) as resp:
            geojson = json.load(resp)
    svg = render(geojson)
    for target in TARGETS:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(svg)
        print(f"wrote {target.relative_to(ROOT)} ({len(svg) // 1024} KB)")


if __name__ == "__main__":
    main()
