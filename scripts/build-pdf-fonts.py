"""Regenerate the TrueType faces the invoice PDF embeds.

pdfkit reads TrueType and OpenType only: handed the woff2 the storefront ships
it raises `RangeError: Offset is outside the bounds of the DataView`. So the
same four faces are committed a second time, as TTF, under `apps/api/assets/`.
This script is how they were produced, so a font refresh is a re-run rather
than a guess.

    pip install fonttools brotli
    python scripts/build-pdf-fonts.py

The sources are the woff2 files under `apps/storefront/public/fonts/`, which
are the Latin + Latin-Extended subsets the storefront serves. That subset is
what the invoice needs: French accents and `U+202F`, the narrow no-break space
the charte's price format uses as a thousands separator.

The Arabic faces (Tajawal-Regular and Tajawal-Bold, OFL 1.1) are not produced
here. They are vendored whole as TTF under the same folder.
"""

import os
import sys

from fontTools.ttLib import TTFont

PAIRS = [
    ("apps/storefront/public/fonts/inter-400.woff2", "apps/api/assets/fonts/Inter-Regular.ttf"),
    ("apps/storefront/public/fonts/inter-600.woff2", "apps/api/assets/fonts/Inter-SemiBold.ttf"),
    ("apps/storefront/public/fonts/baloo2-600.woff2", "apps/api/assets/fonts/Baloo2-SemiBold.ttf"),
    (
        "apps/storefront/public/fonts/jetbrains-mono-400.woff2",
        "apps/api/assets/fonts/JetBrainsMono-Regular.ttf",
    ),
]

# Every character the invoice can print that a bare Latin-1 subset might miss.
REQUIRED = "éèêëàâçùûôîïœÉÈÀÇ«»°" + "  "


def main() -> int:
    failed = False
    for src, dst in PAIRS:
        font = TTFont(src)
        font.flavor = None
        font.save(dst)
        cmap = font.getBestCmap()
        missing = [c for c in REQUIRED if ord(c) not in cmap]
        status = "ok" if not missing else f"MISSING {missing}"
        print(f"{os.path.basename(dst):28} {os.path.getsize(dst):>7} bytes  {status}")
        failed = failed or bool(missing)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
