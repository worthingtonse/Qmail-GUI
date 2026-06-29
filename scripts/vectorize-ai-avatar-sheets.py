#!/usr/bin/env python3
"""Split AI icon sheets and trace monochrome cells into colorable SVG candidates."""

from __future__ import annotations

import colorsys
import html
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


PROJECT_ROOT = Path(__file__).resolve().parents[1]
INPUT_DIR = PROJECT_ROOT / "public" / "qmail-avatars" / "AI"
OUTPUT_DIR = PROJECT_ROOT / "public" / "qmail-avatars" / "AI-svg-candidates"

# These two sheets contain 3x3 grids. All other supported sheets are 5x5.
THREE_BY_THREE = {"gg.png", "ww.png"}
SUPPORTED_SUFFIXES = {".png", ".webp"}
THRESHOLD = 170
CELL_INSET_RATIO = 0.025
SVG_PADDING = 5.0
GOLDEN_ANGLE = 137.508


def symbol_color(index: int) -> str:
    hue = ((index * GOLDEN_ANGLE) % 360) / 360
    red, green, blue = colorsys.hls_to_rgb(hue, 0.60, 0.70)
    return f"#{round(red * 255):02x}{round(green * 255):02x}{round(blue * 255):02x}"


def load_binary_image(path: Path) -> np.ndarray:
    rgba = np.asarray(Image.open(path).convert("RGBA"), dtype=np.float32)
    alpha = rgba[:, :, 3:4] / 255.0
    rgb = rgba[:, :, :3] * alpha + 255.0 * (1.0 - alpha)
    gray = rgb[:, :, 0] * 0.299 + rgb[:, :, 1] * 0.587 + rgb[:, :, 2] * 0.114
    return gray < THRESHOLD


def remove_border_foreground(mask: np.ndarray) -> np.ndarray:
    """Remove divider lines or artifacts connected to a cell crop's border."""
    result = mask.copy()
    height, width = result.shape
    stack: list[tuple[int, int]] = []
    for x in range(width):
        if result[0, x]:
            stack.append((0, x))
        if result[height - 1, x]:
            stack.append((height - 1, x))
    for y in range(height):
        if result[y, 0]:
            stack.append((y, 0))
        if result[y, width - 1]:
            stack.append((y, width - 1))

    while stack:
        y, x = stack.pop()
        if not result[y, x]:
            continue
        result[y, x] = False
        if y:
            stack.append((y - 1, x))
        if y + 1 < height:
            stack.append((y + 1, x))
        if x:
            stack.append((y, x - 1))
        if x + 1 < width:
            stack.append((y, x + 1))
    return result


def remove_sheet_dividers(mask: np.ndarray) -> np.ndarray:
    """Remove near-solid rules used as table dividers in some generated sheets."""
    result = mask.copy()
    divider_rows = result.mean(axis=1) > 0.90
    divider_columns = result.mean(axis=0) > 0.90
    result[divider_rows, :] = False
    result[:, divider_columns] = False
    return result


def axis_boundaries(mask: np.ndarray, grid_size: int, axis: int) -> list[int]:
    """Find the lowest-ink gutter near each expected grid division."""
    projection = mask.sum(axis=axis).astype(float)
    length = len(projection)
    active = np.flatnonzero(projection > 0)
    active_span = (int(active[-1]) - int(active[0]) + 1) / length
    if active_span < 0.72:
        return whitespace_gap_boundaries(mask, grid_size, axis)
    cell_size = length / grid_size
    smoothing_width = max(3, round(cell_size * 0.02))
    scores = np.convolve(projection, np.ones(smoothing_width), mode="same")
    search_radius = round(cell_size * 0.35)
    boundaries = [0]
    for division in range(1, grid_size):
        expected = round(division * cell_size)
        left = max(boundaries[-1] + 5, expected - search_radius)
        right = min(length - 5, expected + search_radius)
        window = scores[left : right + 1]
        minimum = window.min()
        choices = np.flatnonzero(np.isclose(window, minimum)) + left
        boundary = min((int(choice) for choice in choices), key=lambda choice: abs(choice - expected))
        boundaries.append(boundary)
    boundaries.append(length)
    return boundaries


def whitespace_gap_boundaries(mask: np.ndarray, grid_size: int, axis: int) -> list[int]:
    projection = mask.sum(axis=axis)
    minimum_ink = max(1, round(mask.shape[axis] * 0.0015))
    active = np.flatnonzero(projection >= minimum_ink)
    gaps = sorted(
        ((int(active[index + 1] - active[index]), index) for index in range(len(active) - 1)),
        reverse=True,
    )
    split_indices = sorted(index for gap, index in gaps[: grid_size - 1] if gap > 1)
    if len(split_indices) != grid_size - 1:
        raise ValueError(f"Could not identify {grid_size} compact icon bands")
    groups = np.split(active, [index + 1 for index in split_indices])
    return [
        0,
        *[
            round((int(groups[index][-1]) + int(groups[index + 1][0])) / 2)
            for index in range(grid_size - 1)
        ],
        len(projection),
    ]


def divider_boundaries(line_flags: np.ndarray, grid_size: int) -> list[int] | None:
    positions = np.flatnonzero(line_flags)
    if not len(positions):
        return None
    runs = np.split(positions, np.where(np.diff(positions) > 1)[0] + 1)
    length = len(line_flags)
    centers = [
        round((int(run[0]) + int(run[-1])) / 2)
        for run in runs
        if int(run[0]) > length * 0.02 and int(run[-1]) < length * 0.98
    ]
    if len(centers) != grid_size - 1:
        return None
    return [0, *centers, length]


def detect_grid(mask: np.ndarray, grid_size: int) -> tuple[np.ndarray, list[int], list[int]]:
    divider_rows = mask.mean(axis=1) > 0.90
    divider_columns = mask.mean(axis=0) > 0.90
    cleaned = remove_sheet_dividers(mask)
    row_boundaries = divider_boundaries(divider_rows, grid_size)
    column_boundaries = divider_boundaries(divider_columns, grid_size)
    if row_boundaries is None:
        row_boundaries = axis_boundaries(cleaned, grid_size, axis=1)
    if column_boundaries is None:
        column_boundaries = axis_boundaries(cleaned, grid_size, axis=0)
    return cleaned, row_boundaries, column_boundaries


def extract_cell(
    mask: np.ndarray,
    row: int,
    column: int,
    row_boundaries: list[int],
    column_boundaries: list[int],
) -> np.ndarray:
    x0, x1 = column_boundaries[column : column + 2]
    y0, y1 = row_boundaries[row : row + 2]
    inset = max(2, round(min(x1 - x0, y1 - y0) * CELL_INSET_RATIO))
    cell = mask[y0 + inset : y1 - inset, x0 + inset : x1 - inset]
    ys, xs = np.nonzero(cell)
    if not len(xs):
        raise ValueError(f"Cell row {row + 1}, column {column + 1} is empty")
    padding = 2
    left = max(0, int(xs.min()) - padding)
    right = min(cell.shape[1], int(xs.max()) + padding + 1)
    top = max(0, int(ys.min()) - padding)
    bottom = min(cell.shape[0], int(ys.max()) + padding + 1)
    return cell[top:bottom, left:right]


Point = tuple[int, int]


def direction(start: Point, end: Point) -> int:
    dx, dy = end[0] - start[0], end[1] - start[1]
    return {(1, 0): 0, (0, 1): 1, (-1, 0): 2, (0, -1): 3}[(dx, dy)]


def trace_pixel_boundaries(mask: np.ndarray) -> list[list[Point]]:
    """Trace foreground pixel edges into closed outer and hole contours."""
    height, width = mask.shape
    padded = np.pad(mask, 1, constant_values=False)
    above = padded[0:height, 1 : width + 1]
    below = padded[2 : height + 2, 1 : width + 1]
    left = padded[1 : height + 1, 0:width]
    right = padded[1 : height + 1, 2 : width + 2]
    outgoing: dict[Point, set[Point]] = defaultdict(set)

    for y, x in np.argwhere(mask & ~above):
        outgoing[(int(x), int(y))].add((int(x + 1), int(y)))
    for y, x in np.argwhere(mask & ~right):
        outgoing[(int(x + 1), int(y))].add((int(x + 1), int(y + 1)))
    for y, x in np.argwhere(mask & ~below):
        outgoing[(int(x + 1), int(y + 1))].add((int(x), int(y + 1)))
    for y, x in np.argwhere(mask & ~left):
        outgoing[(int(x), int(y + 1))].add((int(x), int(y)))

    contours: list[list[Point]] = []
    turn_priority = {1: 0, 0: 1, 3: 2, 2: 3}  # right, straight, left, back
    while outgoing:
        start = next(iter(outgoing))
        end = next(iter(outgoing[start]))
        outgoing[start].remove(end)
        if not outgoing[start]:
            del outgoing[start]
        contour = [start]
        previous, current = start, end
        guard = 0
        while current != start:
            contour.append(current)
            candidates = outgoing.get(current)
            if not candidates:
                raise ValueError("Encountered an open contour while tracing")
            incoming_direction = direction(previous, current)
            next_point = min(
                candidates,
                key=lambda candidate: turn_priority[
                    (direction(current, candidate) - incoming_direction) % 4
                ],
            )
            candidates.remove(next_point)
            if not candidates:
                del outgoing[current]
            previous, current = current, next_point
            guard += 1
            if guard > mask.size * 4:
                raise ValueError("Contour tracing did not close")
        contours.append(contour)
    return contours


def polygon_area(points: list[Point]) -> float:
    return 0.5 * sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    )


def remove_collinear(points: list[Point]) -> list[Point]:
    if len(points) <= 3:
        return points
    cleaned: list[Point] = []
    for index, point in enumerate(points):
        previous = points[index - 1]
        following = points[(index + 1) % len(points)]
        cross = (point[0] - previous[0]) * (following[1] - point[1]) - (
            point[1] - previous[1]
        ) * (following[0] - point[0])
        if cross:
            cleaned.append(point)
    return cleaned if len(cleaned) >= 3 else points


def point_line_distance(point: Point, start: Point, end: Point) -> float:
    if start == end:
        return math.dist(point, start)
    numerator = abs(
        (end[1] - start[1]) * point[0]
        - (end[0] - start[0]) * point[1]
        + end[0] * start[1]
        - end[1] * start[0]
    )
    return numerator / math.dist(start, end)


def rdp(points: list[Point], epsilon: float) -> list[Point]:
    if len(points) <= 2:
        return points
    distances = [point_line_distance(point, points[0], points[-1]) for point in points[1:-1]]
    if not distances:
        return [points[0], points[-1]]
    maximum = max(distances)
    if maximum <= epsilon:
        return [points[0], points[-1]]
    split = distances.index(maximum) + 1
    return rdp(points[: split + 1], epsilon)[:-1] + rdp(points[split:], epsilon)


def simplify_closed(points: list[Point], epsilon: float) -> list[Point]:
    points = remove_collinear(points)
    if len(points) <= 4:
        return points
    second = max(range(1, len(points)), key=lambda index: math.dist(points[0], points[index]))
    first_arc = rdp(points[: second + 1], epsilon)
    second_arc = rdp(points[second:] + [points[0]], epsilon)
    simplified = first_arc[:-1] + second_arc[:-1]
    return simplified if len(simplified) >= 3 else points


def format_number(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def mask_to_path(mask: np.ndarray) -> tuple[str, int]:
    contours = trace_pixel_boundaries(mask)
    epsilon = max(0.5, max(mask.shape) / 350)
    contours = [
        simplify_closed(contour, epsilon)
        for contour in contours
        if len(contour) >= 3 and abs(polygon_area(contour)) >= 1.5
    ]
    if not contours:
        raise ValueError("No usable contours remained after tracing")

    height, width = mask.shape
    scale = (100 - SVG_PADDING * 2) / max(width, height)
    offset_x = (100 - width * scale) / 2
    offset_y = (100 - height * scale) / 2
    commands: list[str] = []
    for contour in contours:
        transformed = [
            (offset_x + x * scale, offset_y + y * scale) for x, y in contour
        ]
        first, *remaining = transformed
        command = f"M {format_number(first[0])} {format_number(first[1])}"
        command += "".join(
            f" L {format_number(x)} {format_number(y)}" for x, y in remaining
        )
        commands.append(command + " Z")
    return " ".join(commands), len(contours)


def write_svg(path: Path, path_data: str, color: str, source: str, row: int, column: int) -> None:
    source_attribute = html.escape(source, quote=True)
    svg = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" '
        f'viewBox="0 0 100 100" style="color: {color};" '
        f'data-source="{source_attribute}" data-row="{row + 1}" data-column="{column + 1}">\n'
        f'  <path fill="currentColor" fill-rule="evenodd" d="{path_data}"/>\n'
        '</svg>\n'
    )
    path.write_text(svg, encoding="utf-8", newline="\n")


def write_review_html(candidates: list[dict[str, object]]) -> None:
    cards = []
    for candidate in candidates:
        cards.append(
            f'''<article class="candidate" data-search="{html.escape(str(candidate['search']), quote=True)}">
  <div class="preview">
    <img class="frame" src="../frames/bit.svg" alt="">
    <img class="symbol" src="{candidate['file']}" alt="Candidate {candidate['id']:03d}">
  </div>
  <strong>{candidate['id']:03d}</strong>
  <small>{html.escape(str(candidate['source']))}<br>row {candidate['row']}, column {candidate['column']}</small>
</article>'''
        )
    document = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>AI avatar SVG candidates</title>
<style>
:root {{ color-scheme: dark; font-family: system-ui, sans-serif; background: #10151f; color: #eef3ff; }}
body {{ margin: 0; padding: 24px; }}
header {{ position: sticky; top: 0; z-index: 2; padding: 12px 0; background: #10151fee; backdrop-filter: blur(8px); }}
h1 {{ margin: 0 0 8px; font-size: 24px; }}
input {{ width: min(520px, 90vw); padding: 10px 12px; border: 1px solid #526079; border-radius: 8px; background: #182131; color: inherit; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)); gap: 12px; }}
.candidate {{ min-width: 0; padding: 12px; border: 1px solid #2d3850; border-radius: 10px; background: #171f2d; text-align: center; }}
.candidate[hidden] {{ display: none; }}
.preview {{ position: relative; width: 120px; height: 120px; margin: auto; }}
.frame {{ position: absolute; inset: 0; width: 100%; height: 100%; }}
.symbol {{ position: absolute; left: 27%; top: 14%; width: 46%; height: 64%; object-fit: contain; }}
strong {{ display: block; font-size: 18px; }}
small {{ display: block; overflow-wrap: anywhere; color: #aebbd2; line-height: 1.3; }}
</style></head><body>
<header><h1>{len(candidates)} AI avatar SVG candidates</h1>
<input id="filter" type="search" placeholder="Filter by candidate number or source filename"></header>
<main class="grid">{''.join(cards)}</main>
<script>
const input = document.querySelector('#filter');
input.addEventListener('input', () => {{ const q = input.value.toLowerCase(); document.querySelectorAll('.candidate').forEach(card => card.hidden = !card.dataset.search.includes(q)); }});
</script></body></html>'''
    (OUTPUT_DIR / "review.html").write_text(document, encoding="utf-8", newline="\n")


def write_contact_sheet(candidates: list[dict[str, object]], masks: list[np.ndarray]) -> None:
    columns, card_width, card_height = 8, 140, 145
    rows = math.ceil(len(candidates) / columns)
    sheet = Image.new("RGB", (columns * card_width, rows * card_height), "#10151f")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, (candidate, mask) in enumerate(zip(candidates, masks, strict=True)):
        column, row = index % columns, index // columns
        x, y = column * card_width, row * card_height
        draw.rounded_rectangle((x + 4, y + 4, x + card_width - 4, y + card_height - 4), 8, fill="#171f2d", outline="#2d3850")
        icon_mask = Image.fromarray((mask * 255).astype(np.uint8), mode="L")
        icon_mask.thumbnail((100, 100), Image.Resampling.LANCZOS)
        icon = Image.new("RGB", icon_mask.size, str(candidate["color"]))
        icon_x = x + (card_width - icon.width) // 2
        icon_y = y + 10 + (100 - icon.height) // 2
        sheet.paste(icon, (icon_x, icon_y), icon_mask)
        draw.text((x + 10, y + 114), f"{candidate['id']:03d}", fill="#ffffff", font=font)
        source = str(candidate["source"])
        draw.text((x + 10, y + 128), source[:20], fill="#aebbd2", font=font)
    sheet.save(OUTPUT_DIR / "review-contact-sheet.png", optimize=True)


def main() -> None:
    sources = sorted(
        path for path in INPUT_DIR.iterdir() if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
    )
    if not sources:
        raise RuntimeError(f"No supported source images found in {INPUT_DIR}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    candidates: list[dict[str, object]] = []
    masks: list[np.ndarray] = []
    sheet_records: list[dict[str, object]] = []
    for source in sources:
        grid_size = 3 if source.name.lower() in THREE_BY_THREE else 5
        binary = load_binary_image(source)
        binary, row_boundaries, column_boundaries = detect_grid(binary, grid_size)
        first_candidate = len(candidates)
        for row in range(grid_size):
            for column in range(grid_size):
                candidate_id = len(candidates)
                try:
                    mask = extract_cell(
                        binary,
                        row,
                        column,
                        row_boundaries,
                        column_boundaries,
                    )
                except ValueError as exc:
                    raise ValueError(f"{source.name}: {exc}") from exc
                path_data, contour_count = mask_to_path(mask)
                color = symbol_color(candidate_id)
                filename = f"candidate-{candidate_id:03d}.svg"
                write_svg(OUTPUT_DIR / filename, path_data, color, source.name, row, column)
                candidates.append(
                    {
                        "id": candidate_id,
                        "file": filename,
                        "source": source.name,
                        "row": row + 1,
                        "column": column + 1,
                        "grid_size": grid_size,
                        "color": color,
                        "contours": contour_count,
                        "search": f"{candidate_id:03d} {source.name.lower()} row {row + 1} column {column + 1}",
                    }
                )
                masks.append(mask)
        sheet_records.append(
            {
                "source": source.name,
                "grid_size": grid_size,
                "first_candidate": first_candidate,
                "last_candidate": len(candidates) - 1,
            }
        )

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "candidate_count": len(candidates),
        "source_count": len(sources),
        "threshold": THRESHOLD,
        "sheets": sheet_records,
        "candidates": [{key: value for key, value in item.items() if key != "search"} for item in candidates],
    }
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    write_review_html(candidates)
    write_contact_sheet(candidates, masks)
    print(f"Generated {len(candidates)} SVG candidates from {len(sources)} sheets in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
