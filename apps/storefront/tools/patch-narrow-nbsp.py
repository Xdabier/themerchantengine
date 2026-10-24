"""Add U+202F to every shipped storefront face.

Brand floor section 3.2 sets the price format as `1 240 DT`, separated by
U+202F, the narrow no-break space. `Intl.NumberFormat('fr-TN', ...)` emits
that character, so every price on the site contains it.

Google's `latin` subset declares `U+2000-206F` in its `unicode-range` but the
files it ships do not actually carry U+202F, in Baloo 2, Inter, or JetBrains
Mono. Declaring the range therefore is not enough on its own: the browser
picks the face for that codepoint, finds no glyph, and hands that one
character to the system fallback, which breaks the tabular-nums column the
same section 3.2 mandates.

This script maps U+202F onto a glyph the face already has:

  - Baloo 2 and Inter carry U+2009, the thin space. U+202F is the same width;
    the two differ only in line-breaking behaviour, which is a property of the
    codepoint, not of the glyph.
  - JetBrains Mono carries no U+2009. It is monospaced, so every glyph shares
    one advance width and U+0020 is the correct source.

Run from the workspace root, after `pip install fonttools brotli`:

    python apps/storefront/tools/patch-narrow-nbsp.py

It is idempotent: a face that already maps U+202F is left untouched.
"""

from __future__ import annotations

import pathlib
import sys

from fontTools.ttLib import TTFont

NARROW_NBSP = 0x202F
THIN_SPACE = 0x2009
SPACE = 0x0020

FONT_DIR = pathlib.Path(__file__).resolve().parents[1] / "public" / "fonts"


def codepoints(font: TTFont) -> set[int]:
    seen: set[int] = set()
    for table in font["cmap"].tables:
        seen |= set(table.cmap.keys())
    return seen


def patch(path: pathlib.Path) -> str:
    font = TTFont(path)
    present = codepoints(font)
    if NARROW_NBSP in present:
        return "already mapped"

    source = THIN_SPACE if THIN_SPACE in present else SPACE
    if source not in present:
        return f"SKIPPED: neither U+{THIN_SPACE:04X} nor U+{SPACE:04X} present"

    glyph_name = next(
        table.cmap[source] for table in font["cmap"].tables if source in table.cmap
    )
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap[NARROW_NBSP] = glyph_name

    font.flavor = "woff2"
    font.save(path)
    return f"mapped U+202F to {glyph_name} (from U+{source:04X})"


def main() -> int:
    if not FONT_DIR.is_dir():
        sys.stderr.write(f"Font dir not found at {FONT_DIR}\n")
        return 2

    for path in sorted(FONT_DIR.glob("*.woff2")):
        before = path.stat().st_size
        result = patch(path)
        after = path.stat().st_size
        print(f"{path.name:26} {before:>6} -> {after:>6} B  {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
