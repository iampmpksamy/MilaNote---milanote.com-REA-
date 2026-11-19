"""Draws Noteboard's own icon (a dark rounded tile with a folded note card) at every size the web
app, the PWA and the CasaOS tile need. Original artwork made with Pillow; no third-party assets.
Run: python tools/make_icons.py <noteboard-platform dir> <app dir>"""
import os
import sys

from PIL import Image, ImageDraw

platform, app = sys.argv[1], sys.argv[2]
public = os.path.join(platform, "apps", "web", "public")
icons = os.path.join(public, "icons")
casaos = os.path.join(app, "deploy", "casaos")
os.makedirs(icons, exist_ok=True)
os.makedirs(casaos, exist_ok=True)

BG = (47, 50, 55, 255)        # the workspace text colour, #2f3237
CARD = (255, 255, 255, 255)
FOLD = (233, 215, 140, 255)   # the accent, #e9d78c
LINE = (180, 183, 189, 255)


def draw(size: int, maskable: bool = False) -> Image.Image:
    s = size * 4  # draw large, then shrink for smooth edges
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if maskable:
        d.rectangle((0, 0, s, s), fill=BG)
        pad = s * 0.24
    else:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=s * 0.22, fill=BG)
        pad = s * 0.2
    x0, y0, x1, y1 = pad + s * 0.04, pad, s - pad - s * 0.04, s - pad
    fold = (x1 - x0) * 0.3
    d.polygon([(x0, y0), (x1 - fold, y0), (x1, y0 + fold), (x1, y1), (x0, y1)], fill=CARD)
    d.polygon([(x1 - fold, y0), (x1 - fold, y0 + fold), (x1, y0 + fold)], fill=FOLD)
    w = x1 - x0
    for i, frac in enumerate((0.62, 0.8, 0.5)):
        y = y0 + (y1 - y0) * (0.42 + i * 0.16)
        d.rounded_rectangle((x0 + w * 0.14, y, x0 + w * (0.14 + frac * 0.72), y + s * 0.035), radius=s * 0.02, fill=LINE)
    return im.resize((size, size), Image.LANCZOS)


for n in (192, 512):
    draw(n).save(os.path.join(icons, f"icon-{n}.png"))
draw(512, maskable=True).save(os.path.join(icons, "maskable-512.png"))
draw(180).save(os.path.join(icons, "apple-touch-icon.png"))
draw(256).save(os.path.join(casaos, "icon.png"))
draw(64).save(os.path.join(public, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print("icons written")
