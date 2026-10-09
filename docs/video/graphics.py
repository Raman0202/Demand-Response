"""Title cards, problem card, end card and lower-third captions for the presentation video (enterprise palette)."""
import json
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080
OUT = '/tmp/media/gfx'
os.makedirs(OUT, exist_ok=True)
F = '/usr/share/fonts/opentype/inter/'
font = lambda w, s: ImageFont.truetype(F + {'b': 'Inter-Bold.otf', 's': 'Inter-SemiBold.otf', 'm': 'Inter-Medium.otf', 'r': 'Inter-Regular.otf', 'd': 'InterDisplay-Bold.otf'}[w], s)

NAVY = (23, 47, 78)
BRAND = (42, 88, 148)
BRAND_L = (92, 140, 198)
STEEL = (106, 118, 134)
INK = (39, 46, 55)
GREEN = (42, 135, 97)
OCHRE = (192, 126, 24)
CRIMSON = (184, 59, 58)


def backdrop(dark: bool) -> Image.Image:
    """Soft gradient with light pools and a faint ground grid — the product's spatial backdrop."""
    im = Image.new('RGB', (W, H), (243, 245, 248) if not dark else NAVY)
    px = im.load()
    for y in range(H):
        for x in range(0, W, 2):
            if dark:
                t = (x / W) * 0.6 + (y / H) * 0.4
                c = tuple(int(NAVY[i] * (1 - t) + (15, 31, 53)[i] * t) for i in range(3))
            else:
                t = (x / W) * 0.5 + (y / H) * 0.5
                c = tuple(int((246, 247, 249)[i] * (1 - t) + (236, 241, 247)[i] * t) for i in range(3))
            px[x, y] = c
            if x + 1 < W:
                px[x + 1, y] = c
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    if dark:
        g.ellipse((-300, -400, 1100, 700), fill=(92, 140, 198, 70))
        g.ellipse((1100, 500, 2300, 1500), fill=(42, 135, 97, 55))
    else:
        g.ellipse((-300, -400, 1100, 700), fill=(183, 207, 233, 120))
        g.ellipse((1100, 500, 2300, 1500), fill=(213, 237, 224, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    im = Image.alpha_composite(im.convert('RGBA'), glow)
    grid = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    line = (255, 255, 255, 10) if dark else (106, 118, 134, 14)
    for x in range(0, W, 64):
        gd.line((x, 0, x, H), fill=line)
    for y in range(0, H, 64):
        gd.line((0, y, W, y), fill=line)
    return Image.alpha_composite(im, grid)


def logo(d: ImageDraw.ImageDraw, x: int, y: int, s: int = 72):
    d.rounded_rectangle((x, y, x + s, y + s), radius=s // 4, fill=BRAND)
    # lightning bolt
    b = [(0.56, 0.12), (0.26, 0.56), (0.48, 0.56), (0.40, 0.88), (0.74, 0.42), (0.52, 0.42), (0.62, 0.12)]
    d.polygon([(x + px * s, y + py * s) for px, py in b], fill='white')


def wrap(text: str, f: ImageFont.FreeTypeFont, width: int) -> list[str]:
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if f.getlength(t) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    return lines + [cur]


def title_card(s: dict, end: bool = False):
    im = backdrop(dark=True)
    d = ImageDraw.Draw(im)
    logo(d, 160, 300, 92)
    d.text((160, 430), s['title'], font=font('d', 96), fill='white')
    y = 560
    for ln in wrap(s['sub'], font('m', 38), 1400):
        d.text((162, y), ln, font=font('m', 38), fill=(183, 207, 233))
        y += 54
    tag = 'Detect  ·  Forecast  ·  Decide  ·  Dispatch  ·  Verify  ·  Settle' if not end else 'Human-in-the-loop by policy  ·  Dual authorisation  ·  Hash-chained audit'
    d.text((162, y + 40), tag, font=font('s', 26), fill=(150, 175, 205))
    d.line((162, 880, 1760, 880), fill=(70, 95, 130), width=2)
    d.text((162, 900), 'Demand Response Platform', font=font('s', 22), fill=(150, 175, 205))
    d.text((1760 - font('r', 22).getlength('Product overview'), 900), 'Product overview', font=font('r', 22), fill=(150, 175, 205))
    im.convert('RGB').save(f"{OUT}/{s['id']}.png")


def problem_card(s: dict):
    im = backdrop(dark=False)
    d = ImageDraw.Draw(im)
    d.text((160, 170), s['chapter'].upper(), font=font('s', 26), fill=BRAND)
    d.text((160, 215), s['title'], font=font('d', 72), fill=INK)
    icons = [OCHRE, BRAND, CRIMSON, CRIMSON]
    y = 400
    for i, p in enumerate(s['points']):
        card = (160, y, 1760, y + 112)
        shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle((card[0], card[1] + 8, card[2], card[3] + 8), radius=22, fill=(23, 47, 78, 22))
        im = Image.alpha_composite(im, shadow.filter(ImageFilter.GaussianBlur(14)))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle(card, radius=22, fill=(255, 255, 255, 255), outline=(221, 226, 232), width=2)
        d.ellipse((200, y + 32, 248, y + 80), fill=icons[i])
        d.text((216, y + 36), str(i + 1), font=font('b', 30), fill='white')
        d.text((290, y + 34), p, font=font('m', 38), fill=INK)
        y += 140
    d.text((160, 975), 'Flexible demand can fix all four — if it can be called fast, in the right place, and proven.', font=font('m', 30), fill=STEEL)
    im.convert('RGB').save(f"{OUT}/{s['id']}.png")


def caption(s: dict, n: int, total: int):
    """Lower-third glass caption (transparent PNG overlaid on the moving screenshot)."""
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ft, fc = font('b', 40), font('s', 22)
    tw = max(ft.getlength(s['title']), fc.getlength(s['chapter'].upper())) + 120
    x0, y0, x1, y1 = 64, H - 210, 64 + int(tw), H - 64
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x0, y0 + 10, x1, y1 + 10), radius=26, fill=(15, 31, 53, 70))
    im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(18)))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((x0, y0, x1, y1), radius=26, fill=(23, 47, 78, 232))
    d.rounded_rectangle((x0 + 28, y0 + 30, x0 + 36, y1 - 30), radius=4, fill=BRAND_L)
    d.text((x0 + 60, y0 + 28), s['chapter'].upper(), font=fc, fill=(183, 207, 233))
    d.text((x0 + 60, y0 + 64), s['title'], font=ft, fill='white')
    # progress pips, top-right
    for i in range(total):
        cx = W - 64 - (total - 1 - i) * 22
        d.ellipse((cx - 5, 44, cx + 5, 54), fill=(42, 88, 148, 230) if i <= n else (42, 88, 148, 70))
    im.save(f"{OUT}/{s['id']}-cap.png")


scenes = json.load(open('/tmp/media/script.json'))
shots = [s for s in scenes if s['kind'] == 'shot']
for s in scenes:
    if s['kind'] == 'title':
        title_card(s)
    elif s['kind'] == 'end':
        title_card(s, end=True)
    elif s['kind'] == 'problem':
        problem_card(s)
    else:
        caption(s, shots.index(s), len(shots))
print('ok', sorted(os.listdir(OUT)))
