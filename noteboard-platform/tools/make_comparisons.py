"""Reference frame (ads and account details greyed out) | Rust V2 | web (Milestone 1).
Run: python tools/make_comparisons.py <video frames dir> <app dir>"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

frames, app = sys.argv[1], sys.argv[2]
v2 = os.path.join(app, "shots", "after-v2")
web = os.path.join(app, "shots", "web-m1")
out = os.path.join(app, "noteboard-platform", "docs", "comparison")
os.makedirs(out, exist_ok=True)
sets = [
    ("light-home", "dense/s148.png", "none.png", "light-home.png"),
    ("dark-home", "dense/s178.png", "dark.png", "dark-home.png"),
    ("board-selected", "t005.png", "select.png", "board-selected.png"),
    ("line-selected", "dense/s055.png", "line.png", "line-selected.png"),
    ("settings", "dense/s093.png", "settings.png", "settings.png"),
]
try:
    fnt = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 22)
except OSError:
    fnt = ImageFont.load_default()


def cover(im):
    d = ImageDraw.Draw(im)
    sx, sy = im.width / 1910, im.height / 888
    for x0, y0, x1, y1 in [(1410, 8, 1615, 36), (1575, 485, 1905, 875), (1545, 45, 1910, 330)]:
        d.rectangle((x0 * sx, y0 * sy, x1 * sx, y1 * sy), fill=(128, 128, 128))
    return im


for name, r, a, b in sets:
    tiles = []
    ri = cover(Image.open(os.path.join(frames, r)).convert("RGB"))
    tiles.append(("Reference (ads, account greyed)", ri.resize((1360, int(ri.height * 1360 / ri.width)))))
    for label, folder, f in [("Desktop V2 (Rust)", v2, a), ("Web M1 (Angular)", web, b)]:
        p = os.path.join(folder, f)
        if os.path.exists(p):
            tiles.append((label, Image.open(p).convert("RGB").resize((1360, 860))))
    h = max(t[1].height for t in tiles) + 40
    sheet = Image.new("RGB", (1360 * len(tiles) + 20 * (len(tiles) - 1), h), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    x = 0
    for label, im in tiles:
        sheet.paste(im, (x, 40))
        d.text((x + 10, 8), label, fill=(40, 40, 40), font=fnt)
        x += 1380
    sheet.thumbnail((2400, 2400))
    sheet.save(os.path.join(out, name + ".png"))
    print("wrote", name)
