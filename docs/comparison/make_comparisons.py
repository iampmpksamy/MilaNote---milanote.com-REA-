"""Side-by-side pictures: a reference video frame (ads and personal details greyed out),
the app before this round, and after. Run: python make_comparisons.py <frames dir> <app dir>"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

frames, app = sys.argv[1], sys.argv[2]
after = os.path.join(app, "shots", "after-v2")
before = os.path.join(app, "shots", "before-v2")
out = os.path.join(app, "docs", "comparison")
pairs = [
    ("light-home", "dense/s148.png", "none.png", "none.png"),
    ("dark-home", "dense/s178.png", "dark.png", None),
    ("board-selected-toolbar", "t005.png", "select.png", "select.png"),
    ("board-rename", "dense/s028.png", "rename.png", None),
    ("line-selected-toolbar", "dense/s055.png", "line.png", None),
    ("settings-appearance", "dense/s093.png", "settings.png", None),
    ("dark-note", "dense/s168.png", "dark-edit.png", None),
]
try:
    fnt = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 22)
except OSError:
    fnt = ImageFont.load_default()


def cover(im):
    """Grey out the promotion banner, the referral link and the account panel."""
    d = ImageDraw.Draw(im)
    w, h = im.size
    sx, sy = w / 1910, h / 888
    for x0, y0, x1, y1 in [(1410, 8, 1615, 36), (1575, 485, 1905, 875), (1545, 45, 1910, 330)]:
        d.rectangle((x0 * sx, y0 * sy, x1 * sx, y1 * sy), fill=(128, 128, 128))
    return im


for name, r, a, b in pairs:
    ri = cover(Image.open(os.path.join(frames, r)).convert("RGB"))
    ri = ri.resize((1360, int(ri.height * 1360 / ri.width)))
    tiles = [("Reference (covered: ads, account)", ri)]
    if b and os.path.exists(os.path.join(before, b)):
        tiles.append(("Before", Image.open(os.path.join(before, b)).convert("RGB")))
    tiles.append(("After", Image.open(os.path.join(after, a)).convert("RGB")))
    height = max(t[1].height for t in tiles) + 40
    sheet = Image.new("RGB", (1360 * len(tiles) + 20 * (len(tiles) - 1), height), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    x = 0
    for label, im in tiles:
        sheet.paste(im, (x, 40))
        d.text((x + 10, 8), label, fill=(40, 40, 40), font=fnt)
        x += 1360 + 20
    sheet.thumbnail((2400, 2400))
    sheet.save(os.path.join(out, name + ".png"))
    print("wrote", name)
