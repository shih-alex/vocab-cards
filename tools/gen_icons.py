"""Generate the app icons for 單字卡.

Outputs (in ../icons):
  icon.svg              vector icon (rounded square), used as the favicon
  icon-192.png          "any" icon, rounded square with transparent corners
  icon-512.png          "any" icon, rounded square with transparent corners
  icon-maskable-512.png full-bleed background, motif inside the 80% safe zone
  apple-touch-icon.png  180x180, full-bleed, no transparency (iOS rounds it)

The motif is two stacked flashcards with a serif "Aa" on the front card. All
geometry lives in a 512-unit design space and is rendered twice: to SVG and,
supersampled, to PNG with Pillow. The "Aa" glyphs are converted to outlines
with fontTools so the SVG does not depend on installed fonts.

Usage:  python tools/gen_icons.py
"""

from __future__ import annotations

import math
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
FONT_PATH = Path(r"C:\Windows\Fonts\georgiab.ttf")

D = 512                      # design space
SS = 4                       # supersampling factor for PNG rendering

MAROON_TOP = (0x86, 0x23, 0x33)
MAROON_BOTTOM = (0x70, 0x1A, 0x27)   # average ~ #7B1E2B
MAROON = "#7B1E2B"
SHADOW = (0x2E, 0x06, 0x0E)
BACK_CARD_ALPHA = 0.34
BG_RADIUS = 114                      # rounded-square corner radius ("any" icon)

# Cards, in design units relative to the canvas centre.
CARD_W, CARD_H, CARD_R = 292, 212, 30
FRONT = dict(cx=12, cy=30, angle=0.0)
BACK = dict(cx=-14, cy=-28, angle=-9.0)
SHADOW_DY, SHADOW_BLUR, SHADOW_ALPHA = 9, 9, 0.30

TEXT = "Aa"
TEXT_CAP = 0.47 * CARD_H             # height of the "A" in design units


# ---------------------------------------------------------------- glyph outlines

class FlattenPen(BasePen):
    """Records glyph contours as flattened polylines (list of point lists)."""

    def __init__(self, glyphset, steps: int = 24):
        super().__init__(glyphset)
        self.steps = steps
        self.contours: list[list[tuple[float, float]]] = []
        self._cur: list[tuple[float, float]] = []

    def _moveTo(self, pt):
        self._cur = [pt]

    def _lineTo(self, pt):
        self._cur.append(pt)

    def _qCurveToOne(self, p1, p2):
        p0 = self._cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            mt = 1 - t
            self._cur.append((
                mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
                mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
            ))

    def _curveToOne(self, p1, p2, p3):
        p0 = self._cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            mt = 1 - t
            self._cur.append((
                mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
                mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1],
            ))

    def _closePath(self):
        if len(self._cur) > 2:
            self.contours.append(self._cur)
        self._cur = []

    _endPath = _closePath


def text_outline():
    """Return (svg_path_d, contours) for TEXT, positioned in design space so the
    ink box is centred on the front card (before any variant scaling)."""
    font = TTFont(str(FONT_PATH))
    glyphset = font.getGlyphSet()
    cmap = font.getBestCmap()
    upem = font["head"].unitsPerEm
    cap = font["OS/2"].sCapHeight or 0.69 * upem
    scale = TEXT_CAP / cap

    # Lay the glyphs out along the baseline (font units, y up) with kerning ignored.
    names, x = [], 0
    for ch in TEXT:
        name = cmap[ord(ch)]
        names.append((name, x))
        x += font["hmtx"][name][0]

    # Measure the ink box in font units.
    probe = FlattenPen(glyphset)
    for name, dx in names:
        glyphset[name].draw(TransformPen(probe, (1, 0, 0, 1, dx, 0)))
    xs = [p[0] for c in probe.contours for p in c]
    ys = [p[1] for c in probe.contours for p in c]
    ink_cx = (min(xs) + max(xs)) / 2
    ink_cy = (min(ys) + max(ys)) / 2

    # Font units (y up) -> design units (y down), ink centred on the front card.
    tx = D / 2 + FRONT["cx"] - ink_cx * scale
    ty = D / 2 + FRONT["cy"] + ink_cy * scale

    svg_pen = SVGPathPen(glyphset, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    flat = FlattenPen(glyphset)
    for name, dx in names:
        m = (scale, 0, 0, -scale, tx + dx * scale, ty)
        glyphset[name].draw(TransformPen(svg_pen, m))
        glyphset[name].draw(TransformPen(flat, m))
    return svg_pen.getCommands(), flat.contours


# ---------------------------------------------------------------- geometry helpers

def card_corners(card, k: float = 1.0):
    """Corner points of a card (ignoring rounding) after rotation, scaled by k."""
    a = math.radians(card["angle"])
    pts = []
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        x, y = sx * CARD_W / 2, sy * CARD_H / 2
        pts.append(((card["cx"] + x * math.cos(a) - y * math.sin(a)) * k,
                    (card["cy"] + x * math.sin(a) + y * math.cos(a)) * k))
    return pts


def motif_radius() -> float:
    """Max distance of any card corner from the canvas centre (design units)."""
    return max(math.hypot(x, y) for c in (FRONT, BACK) for x, y in card_corners(c))


def motif_scale(variant: str) -> float:
    if variant == "maskable":
        # The safe zone is the centred circle of radius 0.4 * size; keep the card
        # corners comfortably inside it so circular launcher masks don't crowd them.
        return min(1.0, 0.37 * D / motif_radius())
    if variant == "apple":
        return 0.94       # iOS crops a bit more tightly; pull the motif in slightly
    return 1.0


# ---------------------------------------------------------------- PNG rendering

def gradient(size: int) -> Image.Image:
    col = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        col.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(MAROON_TOP, MAROON_BOTTOM)))
    return col.resize((size, size), Image.Resampling.NEAREST)


def rounded_rect_layer(size, cx, cy, angle, k, fill_rgba):
    """Full-canvas RGBA layer with one (rotated) card drawn on it."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    u = size / D * k
    w, h, r = CARD_W * u, CARD_H * u, CARD_R * u
    ccx, ccy = size / 2 + cx * size / D * k, size / 2 + cy * size / D * k
    ImageDraw.Draw(layer).rounded_rectangle(
        (ccx - w / 2, ccy - h / 2, ccx + w / 2, ccy + h / 2), radius=r, fill=fill_rgba)
    if angle:
        # PIL rotates counter-clockwise for positive angles; SVG rotate() is clockwise.
        layer = layer.rotate(-angle, resample=Image.Resampling.BICUBIC, center=(ccx, ccy))
    return layer


def render(size: int, variant: str, contours) -> Image.Image:
    S = size * SS
    k = motif_scale(variant)
    u = S / D

    if variant == "any":
        img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=BG_RADIUS * u, fill=255)
        img.paste(gradient(S), (0, 0), mask)
    else:
        img = gradient(S).convert("RGBA")

    # Back card: translucent white, rotated.
    back = rounded_rect_layer(S, BACK["cx"], BACK["cy"], BACK["angle"], k,
                              (255, 255, 255, round(255 * BACK_CARD_ALPHA)))
    img.alpha_composite(back)

    # Soft drop shadow under the front card.
    sh = rounded_rect_layer(S, FRONT["cx"], FRONT["cy"] + SHADOW_DY, FRONT["angle"], k,
                            SHADOW + (round(255 * SHADOW_ALPHA),))
    sh = sh.filter(ImageFilter.GaussianBlur(SHADOW_BLUR * u * k))
    img.alpha_composite(sh)

    # Front card.
    img.alpha_composite(rounded_rect_layer(S, FRONT["cx"], FRONT["cy"], FRONT["angle"], k,
                                           (255, 255, 255, 255)))

    # "Aa": even-odd fill of the flattened contours (XOR of each contour's polygon).
    def tf(p):
        return ((D / 2 + (p[0] - D / 2) * k) * u, (D / 2 + (p[1] - D / 2) * k) * u)

    ink = Image.new("1", (S, S), 0)
    for c in contours:
        one = Image.new("1", (S, S), 0)
        ImageDraw.Draw(one).polygon([tf(p) for p in c], fill=1)
        ink = ImageChops.logical_xor(ink, one)
    text_layer = Image.new("RGBA", (S, S), (0x7B, 0x1E, 0x2B, 255))
    text_layer.putalpha(ink.convert("L"))
    img.alpha_composite(text_layer)

    out = img.resize((size, size), Image.Resampling.LANCZOS)
    if variant == "apple":
        out = out.convert("RGB")
    return out


# ---------------------------------------------------------------- SVG

def svg_card(card, fill, extra=""):
    x, y = D / 2 + card["cx"] - CARD_W / 2, D / 2 + card["cy"] - CARD_H / 2
    rot = ""
    if card["angle"]:
        rot = f' transform="rotate({card["angle"]:g} {D / 2 + card["cx"]:g} {D / 2 + card["cy"]:g})"'
    return (f'<rect x="{x:g}" y="{y:g}" width="{CARD_W}" height="{CARD_H}" rx="{CARD_R}"'
            f' fill="{fill}"{rot}{extra}/>')


def build_svg(path_d: str) -> str:
    top = "#%02X%02X%02X" % MAROON_TOP
    bottom = "#%02X%02X%02X" % MAROON_BOTTOM
    shadow = "#%02X%02X%02X" % SHADOW
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {D} {D}">
  <title>單字卡</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{top}"/>
      <stop offset="1" stop-color="{bottom}"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="{SHADOW_DY}" stdDeviation="{SHADOW_BLUR}" flood-color="{shadow}" flood-opacity="{SHADOW_ALPHA}"/>
    </filter>
  </defs>
  <rect width="{D}" height="{D}" rx="{BG_RADIUS}" fill="url(#bg)"/>
  {svg_card(BACK, "#FFFFFF", f' fill-opacity="{BACK_CARD_ALPHA}"')}
  {svg_card(FRONT, "#FFFFFF", ' filter="url(#shadow)"')}
  <path fill="{MAROON}" d="{path_d}"/>
</svg>
"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    path_d, contours = text_outline()

    (OUT / "icon.svg").write_text(build_svg(path_d), encoding="utf-8")
    render(192, "any", contours).save(OUT / "icon-192.png", optimize=True)
    render(512, "any", contours).save(OUT / "icon-512.png", optimize=True)
    render(512, "maskable", contours).save(OUT / "icon-maskable-512.png", optimize=True)
    render(180, "apple", contours).save(OUT / "apple-touch-icon.png", optimize=True)

    print(f"motif radius {motif_radius():.1f} / maskable scale {motif_scale('maskable'):.3f}")
    for p in sorted(OUT.iterdir()):
        print(f"  {p.name:26s} {p.stat().st_size / 1024:6.1f} KB")


if __name__ == "__main__":
    main()
