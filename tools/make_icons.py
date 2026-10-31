#!/usr/bin/env python3
"""Generate the PWA icons for the Focus timer.

Creates:
  icons/icon-192.png            192x192  rounded-square, purpose "any"
  icons/icon-512.png            512x512  rounded-square, purpose "any"
  icons/icon-maskable-192.png   192x192  full bleed, purpose "maskable"
  icons/icon-maskable-512.png   512x512  full bleed, purpose "maskable"
  icons/apple-touch-icon.png    180x180  full bleed, opaque

Run with:  python3 tools/make_icons.py
"""

import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(os.path.dirname(HERE), "icons")

ACCENT_1 = (124, 140, 255)   # #7c8cff
ACCENT_2 = (177, 140, 255)   # #b18cff
SS = 4                       # supersampling factor


def lerp(a, b, t):
    return a + (b - a) * t


def gradient(size):
    """Diagonal gradient, generated small and scaled up for smoothness."""
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x / 63.0) * 0.45 + (y / 63.0) * 0.55
            t = min(1.0, max(0.0, t))
            px[x, y] = (
                int(lerp(ACCENT_1[0], ACCENT_2[0], t)),
                int(lerp(ACCENT_1[1], ACCENT_2[1], t)),
                int(lerp(ACCENT_1[2], ACCENT_2[2], t)),
            )
    return small.resize((size, size), Image.BICUBIC).convert("RGBA")


def point_on_circle(cx, cy, r, degrees):
    rad = math.radians(degrees)
    return cx + r * math.cos(rad), cy + r * math.sin(rad)


def draw_stopwatch(canvas, cx, cy, radius, ring_width):
    """White stopwatch: track ring, 270-degree progress arc, knob, centre dot."""
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    bbox = [cx - radius, cy - radius, cx + radius, cy + radius]

    # Track ring (translucent) — the full circle.
    d.ellipse(bbox, outline=(255, 255, 255, 70), width=ring_width)

    # Progress arc — 270 degrees clockwise from the top.
    d.arc(bbox, 270, 180, fill=(255, 255, 255, 255), width=ring_width)

    # Rounded caps for the arc.
    cap_r = ring_width / 2.0
    for angle in (270, 180):
        px, py = point_on_circle(cx, cy, radius, angle)
        d.ellipse(
            [px - cap_r, py - cap_r, px + cap_r, py + cap_r],
            fill=(255, 255, 255, 255),
        )

    # Crown and stem of the stopwatch.
    stem_w = radius * 0.16
    stem_top = cy - radius - radius * 0.30
    stem_bottom = cy - radius + radius * 0.06
    d.rounded_rectangle(
        [cx - stem_w / 2, stem_top, cx + stem_w / 2, stem_bottom],
        radius=stem_w * 0.4,
        fill=(255, 255, 255, 255),
    )

    crown_w = radius * 0.56
    crown_h = radius * 0.24
    crown_top = stem_top - crown_h
    d.rounded_rectangle(
        [cx - crown_w / 2, crown_top, cx + crown_w / 2, crown_top + crown_h],
        radius=crown_h * 0.45,
        fill=(255, 255, 255, 255),
    )

    # Centre dot.
    dot_r = radius * 0.13
    d.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=(255, 255, 255, 255))

    return Image.alpha_composite(canvas, layer)


def build_icon(size, maskable=False, opaque=False):
    work = size * SS
    img = gradient(work)

    if not maskable and not opaque:
        # Rounded-square "any" icon background.
        mask = Image.new("L", (work, work), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, work - 1, work - 1], radius=int(work * 0.225), fill=255
        )
        img.putalpha(mask)

    # Glyph geometry.
    scale = 0.76 if maskable else 1.0
    radius = work * 0.285 * scale
    ring_width = max(2, int(work * 0.055 * scale))
    cx = work / 2.0
    cy = work * 0.525

    img = draw_stopwatch(img, cx, cy, radius, ring_width)

    img = img.resize((size, size), Image.LANCZOS)

    if opaque:
        flat = Image.new("RGB", (size, size), ACCENT_1)
        flat.paste(img, (0, 0), img)
        return flat

    return img


def main():
    os.makedirs(ICON_DIR, exist_ok=True)

    jobs = [
        ("icon-192.png", 192, dict(maskable=False)),
        ("icon-512.png", 512, dict(maskable=False)),
        ("icon-maskable-192.png", 192, dict(maskable=True)),
        ("icon-maskable-512.png", 512, dict(maskable=True)),
        ("apple-touch-icon.png", 180, dict(maskable=True, opaque=True)),
    ]

    for name, size, kwargs in jobs:
        img = build_icon(size, **kwargs)
        path = os.path.join(ICON_DIR, name)
        img.save(path, "PNG", optimize=True)
        print("wrote %s (%dx%d)" % (path, img.width, img.height))


if __name__ == "__main__":
    main()
