"""Noteboard's own icon (same artwork as tools/make_icons.py) at the sizes the native apps need:
Android launcher + adaptive icons and splash screens, the iOS app icon and splash, and the master
PNG the Windows (Tauri) icon set is generated from (`npx tauri icon`). Original artwork, Pillow only.
Run: python tools/make_native_icons.py <noteboard-platform dir>"""
import glob
import os
import sys

from PIL import Image, ImageDraw

root = sys.argv[1]
BG = (47, 50, 55, 255)        # #2f3237, the workspace text colour
CARD = (255, 255, 255, 255)
FOLD = (233, 215, 140, 255)   # #e9d78c, the accent
LINE = (180, 183, 189, 255)
CANVAS = (234, 235, 238, 255)  # #eaebee, the light board colour (splash background)


def card(d: ImageDraw.ImageDraw, s: float, pad: float, ox: float = 0, oy: float = 0) -> None:
    x0, y0, x1, y1 = ox + pad + s * 0.04, oy + pad, ox + s - pad - s * 0.04, oy + s - pad
    fold = (x1 - x0) * 0.3
    d.polygon([(x0, y0), (x1 - fold, y0), (x1, y0 + fold), (x1, y1), (x0, y1)], fill=CARD)
    d.polygon([(x1 - fold, y0), (x1 - fold, y0 + fold), (x1, y0 + fold)], fill=FOLD)
    w = x1 - x0
    for i, frac in enumerate((0.62, 0.8, 0.5)):
        y = y0 + (y1 - y0) * (0.42 + i * 0.16)
        d.rounded_rectangle((x0 + w * 0.14, y, x0 + w * (0.14 + frac * 0.72), y + s * 0.035), radius=s * 0.02, fill=LINE)


def icon(size: int, shape: str = "rounded") -> Image.Image:
    """shape: rounded (tile), square (full bleed), circle, foreground (transparent, adaptive-icon safe zone)."""
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if shape == "rounded":
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=s * 0.22, fill=BG)
        card(d, s, s * 0.2)
    elif shape == "square":
        d.rectangle((0, 0, s, s), fill=BG)
        card(d, s, s * 0.22)
    elif shape == "circle":
        d.ellipse((0, 0, s - 1, s - 1), fill=BG)
        card(d, s, s * 0.25)
    else:  # adaptive foreground: 108dp canvas, keep the art inside the central 66dp
        card(d, s, s * 0.31)
    return im.resize((size, size), Image.LANCZOS)


def splash(w: int, h: int) -> Image.Image:
    im = Image.new("RGBA", (w, h), CANVAS)
    side = int(min(w, h) * 0.28)
    im.alpha_composite(icon(side), ((w - side) // 2, (h - side) // 2))
    return im


# ---------- Android ----------
res = os.path.join(root, "apps/mobile/android/app/src/main/res")
if os.path.isdir(res):
    for dpi, scale in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
        d = os.path.join(res, f"mipmap-{dpi}")
        os.makedirs(d, exist_ok=True)
        icon(int(48 * scale), "rounded").save(os.path.join(d, "ic_launcher.png"))
        icon(int(48 * scale), "circle").save(os.path.join(d, "ic_launcher_round.png"))
        icon(int(108 * scale), "foreground").save(os.path.join(d, "ic_launcher_foreground.png"))
    with open(os.path.join(res, "values/ic_launcher_background.xml"), "w") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#2F3237</color>\n</resources>\n')
    for f in glob.glob(os.path.join(res, "drawable*/splash.png")):
        w, h = Image.open(f).size
        splash(w, h).save(f)

# ---------- iOS ----------
ios = os.path.join(root, "apps/mobile/ios/App/App/Assets.xcassets")
if os.path.isdir(ios):
    for f in glob.glob(os.path.join(ios, "AppIcon.appiconset/*.png")):
        w, _ = Image.open(f).size
        icon(w, "square").convert("RGB").save(f)  # iOS masks the corners itself; no transparency allowed
    for f in glob.glob(os.path.join(ios, "Splash.imageset/*.png")):
        w, h = Image.open(f).size
        splash(w, h).save(f)

# ---------- Windows (Tauri) master ----------
desk = os.path.join(root, "apps/desktop")
os.makedirs(desk, exist_ok=True)
icon(1024, "rounded").save(os.path.join(desk, "app-icon.png"))
print("native icons written")
