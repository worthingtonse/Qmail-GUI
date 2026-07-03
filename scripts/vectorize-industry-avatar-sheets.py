#!/usr/bin/env python3
"""Split 4x4 industry icon sheets and trace cells into colorable SVG candidates.

Reuses the tracing/grid-detection machinery from vectorize-ai-avatar-sheets.py.
"""

from __future__ import annotations

import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BASE_SCRIPT = PROJECT_ROOT / "scripts" / "vectorize-ai-avatar-sheets.py"
INPUT_DIR = PROJECT_ROOT / "public" / "qmail-avatars" / "industry"
OUTPUT_DIR = PROJECT_ROOT / "public" / "qmail-avatars" / "industry-svg-candidates"
GRID_SIZE = 4

spec = importlib.util.spec_from_file_location("vectorize_base", BASE_SCRIPT)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.OUTPUT_DIR = OUTPUT_DIR  # write_review_html / write_contact_sheet use this


def short_sheet_name(index: int) -> str:
    return f"sheet-{index + 1:02d}"


def ordered_sources() -> list[Path]:
    """Keep candidate numbering stable: manifest order first, new sheets appended."""
    available = {
        path.name: path
        for path in INPUT_DIR.iterdir()
        if path.is_file() and path.suffix.lower() in base.SUPPORTED_SUFFIXES
    }
    ordered: list[Path] = []
    manifest_path = OUTPUT_DIR / "manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for sheet in manifest.get("sheets", []):
            name = sheet.get("source_file")
            if name in available:
                ordered.append(available.pop(name))
    ordered.extend(available[name] for name in sorted(available))
    return ordered


def main() -> None:
    sources = ordered_sources()
    if not sources:
        raise RuntimeError(f"No supported source images found in {INPUT_DIR}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    candidates: list[dict[str, object]] = []
    masks = []
    sheet_records: list[dict[str, object]] = []
    for sheet_index, source in enumerate(sources):
        sheet_name = short_sheet_name(sheet_index)
        binary = base.load_binary_image(source)
        binary, row_boundaries, column_boundaries = base.detect_grid(binary, GRID_SIZE)
        first_candidate = len(candidates)
        for row in range(GRID_SIZE):
            for column in range(GRID_SIZE):
                candidate_id = len(candidates)
                try:
                    mask = base.extract_cell(
                        binary, row, column, row_boundaries, column_boundaries
                    )
                except ValueError as exc:
                    raise ValueError(f"{source.name}: {exc}") from exc
                path_data, contour_count = base.mask_to_path(mask)
                color = base.symbol_color(candidate_id)
                filename = f"industry-{candidate_id:03d}.svg"
                base.write_svg(OUTPUT_DIR / filename, path_data, color, sheet_name, row, column)
                candidates.append(
                    {
                        "id": candidate_id,
                        "file": filename,
                        "source": sheet_name,
                        "source_file": source.name,
                        "row": row + 1,
                        "column": column + 1,
                        "grid_size": GRID_SIZE,
                        "color": color,
                        "contours": contour_count,
                        "search": f"{candidate_id:03d} {sheet_name} row {row + 1} column {column + 1}",
                    }
                )
                masks.append(mask)
        sheet_records.append(
            {
                "source": sheet_name,
                "source_file": source.name,
                "grid_size": GRID_SIZE,
                "first_candidate": first_candidate,
                "last_candidate": len(candidates) - 1,
            }
        )

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "candidate_count": len(candidates),
        "source_count": len(sources),
        "threshold": base.THRESHOLD,
        "sheets": sheet_records,
        "candidates": [
            {key: value for key, value in item.items() if key != "search"}
            for item in candidates
        ],
    }
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    base.write_review_html(candidates)
    base.write_contact_sheet(candidates, masks)
    print(f"Generated {len(candidates)} SVG candidates from {len(sources)} sheets in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
