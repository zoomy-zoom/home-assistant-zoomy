"""Draw the Zoomy brand images: custom_components/zoomy/brand/icon.png and icon@2x.png.

Home Assistant 2026.9 and later serve a custom integration's own brand
images from its "brand" folder (homeassistant/components/brands/__init__.py,
_serve_from_custom_integration), and HACS accepts brand/icon.png instead of
an entry in the home-assistant/brands repository
(hacs/integration custom_components/hacs/validate/brands.py).  The other
images (logo, dark_*) fall back to icon.png in Home Assistant.

The mark: a yellow "Z" inside a light ring on a dark disc, as on the Zoomy
web site's touch icon, drawn again from its measurements so it is sharp at
256 and 512 pixels.  Transparent outside the disc.

Needs Pillow (it comes with Home Assistant, so the test venv has it):
    python scripts/make_brand_images.py
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
BRAND = os.path.join(HERE, "..", "custom_components", "zoomy", "brand")

NAVY = (14, 20, 29)
RING = (207, 224, 245)
AMBER = (242, 176, 30)

# Design units (the touch icon is 180 x 180): the disc and ring are centred on
# (90, 90).  A dark margin outside the ring (as on the square touch icon) keeps
# the light ring visible on a light page; the picture is cropped to that disc.
CROP_FROM, CROP_SIZE = 5.0, 170.0
CENTRE = 90.0
DISC = 84.0
RING_OUTER, RING_INNER = 75.0, 63.0
Z_POINTS = [(62.0, 64.0), (117.0, 64.0), (62.0, 115.5), (117.0, 115.5)]
Z_WIDTH = 16.0
SUPERSAMPLE = 8


def draw(size: int) -> Image.Image:
    """Return the mark as a size x size RGBA image."""
    big = size * SUPERSAMPLE
    scale = big / CROP_SIZE

    def at(x: float, y: float) -> tuple[float, float]:
        return ((x - CROP_FROM) * scale, (y - CROP_FROM) * scale)

    def disc(radius: float, colour: tuple[int, int, int]) -> None:
        (x0, y0), (x1, y1) = at(CENTRE - radius, CENTRE - radius), at(CENTRE + radius, CENTRE + radius)
        pen.ellipse([x0, y0, x1, y1], fill=colour + (255,))

    # Transparent pixels carry the disc colour, so the edge never fringes.
    image = Image.new("RGBA", (big, big), NAVY + (0,))
    pen = ImageDraw.Draw(image)
    disc(DISC, NAVY)
    disc(RING_OUTER, RING)
    disc(RING_INNER, NAVY)
    width = Z_WIDTH * scale
    pen.line([at(x, y) for x, y in Z_POINTS], fill=AMBER + (255,), width=round(width), joint="curve")
    for x, y in (Z_POINTS[0], Z_POINTS[-1]):  # round caps
        cx, cy = at(x, y)
        pen.ellipse([cx - width / 2, cy - width / 2, cx + width / 2, cy + width / 2], fill=AMBER + (255,))
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    """Write icon.png (256) and icon@2x.png (512)."""
    os.makedirs(BRAND, exist_ok=True)
    for name, size in (("icon.png", 256), ("icon@2x.png", 512)):
        path = os.path.join(BRAND, name)
        draw(size).save(path, optimize=True)
        print(f"{os.path.normpath(path)}: {size} x {size}, {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
