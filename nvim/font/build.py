"""Build alloy-icons.ttf from the PNG icons of the VS Code extension.

A terminal draws text only, so Neovim cannot show a PNG as a file icon.
This script turns each icon into one glyph in a private-use code point.
The glyph keeps the shape and loses the color. plugin/alloy.lua gives the color.

Needs: pip install fonttools pillow
Run:   python build.py
"""
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from PIL import Image

HERE = Path(__file__).parent
ASSETS = HERE.parent.parent / "vscode" / "assets"
# Code points in Supplementary Private Use Area-B. No other font uses them.
ICONS = {
    0x100000: "aly-symbol.png",
    0x100001: "alx-symbol.png",
    0x100002: "d-aly-symbol.png",
    0x100003: "alloy-toml-symbol.png",
}
GRID = 128  # Pixels on each side after the downscale. At icon size the steps do not show.
EM = 1024
UNIT = EM // GRID
DESCENT = 160  # The icon sits a little under the baseline, so it centers on the text line.


def glyph(png: Path):
    alpha = Image.open(png).convert("RGBA").getchannel("A")
    alpha = alpha.crop(alpha.getbbox())
    # Center the trimmed shape in a square, then scale it to the grid.
    side = max(alpha.size)
    square = Image.new("L", (side, side), 0)
    square.paste(alpha, ((side - alpha.width) // 2, (side - alpha.height) // 2))
    mask = square.resize((GRID, GRID), Image.LANCZOS).load()

    pen = TTGlyphPen(None)
    for row in range(GRID):
        col = 0
        while col < GRID:
            if mask[col, row] < 128:
                col += 1
                continue
            start = col
            while col < GRID and mask[col, row] >= 128:
                col += 1
            # One rectangle for each run of filled pixels in the row.
            x0, x1 = start * UNIT, col * UNIT
            y1 = (GRID - row) * UNIT - DESCENT
            y0 = y1 - UNIT
            pen.moveTo((x0, y0))
            pen.lineTo((x0, y1))
            pen.lineTo((x1, y1))
            pen.lineTo((x1, y0))
            pen.closePath()
    return pen.glyph()


def main():
    names = [".notdef"] + [f"alloy{i}" for i in range(len(ICONS))]
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    cmap = {}
    for name, (code, png) in zip(names[1:], ICONS.items()):
        glyphs[name] = glyph(ASSETS / png)
        cmap[code] = name

    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({n: (EM, 0) for n in names})
    fb.setupHorizontalHeader(ascent=EM - DESCENT, descent=-DESCENT)
    fb.setupNameTable({"familyName": "Alloy Icons", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=EM - DESCENT, sTypoDescender=-DESCENT, usWinAscent=EM - DESCENT, usWinDescent=DESCENT)
    fb.setupPost()
    fb.save(HERE / "alloy-icons.ttf")
    print("wrote", HERE / "alloy-icons.ttf")


if __name__ == "__main__":
    main()
