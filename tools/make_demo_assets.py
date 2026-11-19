"""Generate the demo assets for the diary: short songs and procedural "photos".

Everything here is made by code, so the demo carries no third-party copyright.
Each song has a known tempo and key, which the tests use to check the
in-browser music analyser (tests/run.js).

    python3 diary/tools/make_demo_assets.py
"""
import json, math, pathlib, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent / "demo"
SR = 22050
rng = np.random.default_rng(7)

# ----------------------------------------------------------------- music ---
MAJOR = [0, 2, 4, 5, 7, 9, 11]
MINOR = [0, 2, 3, 5, 7, 8, 10]


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def env(n, a=0.01, d=0.3, s=0.0, sr=SR):
    t = np.arange(n) / sr
    e = np.minimum(1, t / max(a, 1e-4)) * (s + (1 - s) * np.exp(-t / d))
    return e


def tone(f, n, kind="piano", d=0.6):
    t = np.arange(n) / SR
    if kind == "piano":
        w = np.sin(2 * np.pi * f * t) + 0.45 * np.sin(4 * np.pi * f * t) + 0.18 * np.sin(6 * np.pi * f * t)
        return w * env(n, 0.004, d)
    if kind == "pad":
        w = sum(np.sin(2 * np.pi * f * (1 + dt) * t) for dt in (-0.004, 0, 0.005)) / 3
        return w * env(n, 0.35, 10, 1.0)
    if kind == "saw":
        ph = (f * t) % 1.0
        return (2 * ph - 1) * env(n, 0.003, d)
    if kind == "bell":
        w = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2.76 * t)
        return w * env(n, 0.002, d)
    if kind == "pluck":
        w = np.sign(np.sin(2 * np.pi * f * t)) * 0.4 + np.sin(2 * np.pi * f * t)
        return w * env(n, 0.002, d)
    raise ValueError(kind)


def kick(n):
    t = np.arange(n) / SR
    f = 50 + 90 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def noise_hit(n, decay=25, hp=True):
    x = rng.standard_normal(n)
    if hp:
        x = np.diff(np.concatenate([[0], x]))
    return x * np.exp(-np.arange(n) / SR * decay)


def add(buf, sig, start):
    s = int(start)
    if s >= len(buf):
        return
    e = min(len(buf), s + len(sig))
    buf[s:e] += sig[: e - s]


def song(path, bpm, root, mode, style, dur=22.0):
    n = int(dur * SR)
    out = np.zeros(n)
    beat = 60.0 / bpm
    bar = 4 * beat
    scale = MAJOR if mode == "major" else MINOR
    prog = [0, 5, 3, 4] if mode == "major" else [0, 5, 2, 6]  # I-vi-IV-V / i-VI-III-VII
    nbars = int(dur / bar) + 1
    for b in range(nbars):
        deg = prog[b % 4]
        chord = [root + 12 + scale[(deg + k) % 7] + 12 * ((deg + k) // 7) for k in (0, 2, 4)]
        t0 = b * bar * SR
        bass = root - 12 + scale[deg]
        if style in ("waltz", "lofi", "pop", "party"):
            for k in range(4):  # accented chord on every beat
                amp = 0.32 if k == 0 else 0.22
                for m in chord:
                    add(out, amp * tone(hz(m), int(beat * SR * 0.95), "piano", 0.35), t0 + k * beat * SR)
                add(out, (0.5 if k in (0, 2) else 0.3) * tone(hz(bass), int(beat * SR), "piano", 0.25), t0 + k * beat * SR)
        if style in ("ambient", "electro"):
            for m in chord:
                add(out, 0.12 * tone(hz(m), int(bar * SR), "pad"), t0)
        if style == "ambient":
            for k in range(4):
                add(out, 0.35 * tone(hz(bass), int(beat * SR), "piano", 0.5), t0 + k * beat * SR)
                if k % 2 == 0:
                    m = root + 24 + scale[(deg + [0, 2, 4, 2][k]) % 7]
                    add(out, 0.18 * tone(hz(m), int(beat * 2 * SR), "bell", 0.9), t0 + k * beat * SR)
        if style == "electro":
            for k in range(8):
                add(out, 0.30 * tone(hz(bass + (12 if k % 2 else 0)), int(beat / 2 * SR), "saw", 0.08), t0 + k * beat / 2 * SR)
        if style in ("pop", "party", "electro"):
            arp = [chord[0], chord[1], chord[2], chord[1] + 12 - 12]
            for k in range(8):
                m = arp[k % 4] + 12
                add(out, 0.10 * tone(hz(m), int(beat / 2 * SR), "pluck", 0.12), t0 + k * beat / 2 * SR)
        for k in range(4):  # drums
            tb = t0 + k * beat * SR
            if style in ("pop", "party", "electro"):
                add(out, 0.9 * kick(int(0.35 * SR)), tb)
                if k in (1, 3):
                    add(out, 0.35 * noise_hit(int(0.2 * SR), 18), tb)
                for h in range(2):
                    add(out, 0.08 * noise_hit(int(0.05 * SR), 80), tb + h * beat / 2 * SR)
            elif style == "waltz":
                add(out, 0.10 * noise_hit(int(0.12 * SR), 30), tb)  # brushes
            elif style == "lofi":
                add(out, 0.5 * kick(int(0.3 * SR)) if k in (0, 2) else 0.25 * noise_hit(int(0.15 * SR), 22), tb)
    if style == "lofi":  # rain bed
        out += 0.025 * np.convolve(rng.standard_normal(n), np.ones(6) / 6, mode="same")
    fade = int(1.2 * SR)
    out[:fade] *= np.linspace(0, 1, fade)
    out[-fade:] *= np.linspace(1, 0, fade)
    out = out / np.max(np.abs(out)) * 0.85
    pcm = (out * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# ---------------------------------------------------------------- photos ---
W, H = 900, 1200


def grad(c1, c2, h=H, w=W):
    t = np.linspace(0, 1, h)[:, None, None]
    return (np.array(c1) * (1 - t) + np.array(c2) * t) * np.ones((1, w, 1))


def to_img(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype("uint8"))


def finish(img, blur=1.2, grain=7):
    img = img.filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(img).astype(float)
    a += rng.normal(0, grain, a.shape)
    return to_img(a)


def blobs(draw, n, box, colors, rmin, rmax):
    x0, y0, x1, y1 = box
    for _ in range(n):
        x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
        r = rng.uniform(rmin, rmax)
        c = colors[rng.integers(len(colors))]
        draw.ellipse([x - r, y - r * 0.8, x + r, y + r * 0.8], fill=tuple(int(v) for v in c))


def autumn_path():
    img = to_img(grad((222, 214, 196), (196, 170, 120)))
    d = ImageDraw.Draw(img)
    d.polygon([(W * .42, H * .55), (W * .58, H * .55), (W * .95, H), (W * .05, H)], fill=(150, 120, 90))
    for x in (90, 250, 650, 820):
        d.rectangle([x - 12, H * .35, x + 12, H * .8], fill=(60, 45, 35))
    blobs(d, 260, (0, H * .05, W, H * .5), [(214, 140, 40), (232, 176, 60), (190, 95, 35), (240, 200, 90)], 25, 70)
    blobs(d, 300, (0, H * .75, W, H), [(220, 150, 50), (200, 110, 40), (240, 190, 80)], 6, 16)
    return finish(img, 2.0)


def cocoa_cups():
    img = to_img(grad((120, 82, 55), (80, 52, 34)))
    d = ImageDraw.Draw(img)
    for i in range(14):
        d.line([(0, 60 + i * 85), (W, 40 + i * 85)], fill=(96, 64, 42), width=3)
    for cx, cy, col in ((330, 640, (236, 228, 214)), (590, 700, (196, 72, 52))):
        d.ellipse([cx - 150, cy - 40, cx + 150, cy + 220], fill=tuple(int(c * .8) for c in col))
        d.rectangle([cx - 150, cy, cx + 150, cy + 170], fill=col)
        d.ellipse([cx - 150, cy - 55, cx + 150, cy + 55], fill=col)
        d.ellipse([cx - 130, cy - 40, cx + 130, cy + 40], fill=(110, 66, 40))
        d.ellipse([cx + 130, cy + 30, cx + 220, cy + 130], outline=col, width=22)
    for k in range(5):
        x = 300 + k * 60
        d.line([(x, 560), (x + 20, 420), (x - 10, 300)], fill=(240, 235, 225), width=8)
    return finish(img, 3.0)


def leaves_ground():
    img = to_img(grad((170, 120, 60), (120, 80, 40)))
    d = ImageDraw.Draw(img)
    blobs(d, 900, (0, 0, W, H), [(232, 180, 50), (214, 130, 30), (180, 70, 30), (245, 210, 90), (150, 110, 50)], 12, 34)
    return finish(img, 1.4)


def night_city():
    img = to_img(grad((12, 18, 38), (28, 40, 70)))
    d = ImageDraw.Draw(img)
    x = 0
    while x < W:
        bw = rng.integers(80, 170)
        bh = rng.integers(300, 900)
        d.rectangle([x, H - bh, x + bw, H], fill=(18, 24, 40))
        for wy in range(H - bh + 20, H - 20, 34):
            for wx in range(x + 12, x + bw - 16, 26):
                if rng.random() < 0.35:
                    d.rectangle([wx, wy, wx + 12, wy + 18], fill=(230, 210, 140) if rng.random() < .7 else (150, 200, 255))
        x += bw + rng.integers(4, 20)
    d.rectangle([0, 0, 24, H], fill=(40, 44, 52))
    d.rectangle([W // 2 - 10, 0, W // 2 + 10, H], fill=(40, 44, 52))
    return finish(img, 1.0)


def desk_monitor():
    img = to_img(grad((20, 22, 30), (34, 36, 44)))
    d = ImageDraw.Draw(img)
    d.rectangle([120, 260, 780, 700], fill=(60, 120, 210))
    for i in range(14):
        d.rectangle([160, 300 + i * 26, 160 + rng.integers(120, 560), 312 + i * 26], fill=(200, 230, 255))
    d.rectangle([420, 700, 480, 800], fill=(50, 52, 60))
    d.rectangle([0, 800, W, H], fill=(44, 40, 38))
    d.ellipse([620, 860, 760, 960], fill=(235, 235, 235))
    d.ellipse([640, 875, 740, 945], fill=(70, 45, 30))
    img = img.filter(ImageFilter.GaussianBlur(2))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse([0, 120, W, 900], fill=(40, 70, 120))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(120)), 0.35)
    return finish(img, 0.8)


def beach_day():
    img = to_img(grad((120, 200, 240), (200, 235, 250)))
    d = ImageDraw.Draw(img)
    d.rectangle([0, H * .45, W, H * .68], fill=(40, 185, 190))
    for i in range(30):
        y = H * .46 + i * 9
        d.line([(0, y), (W, y + rng.integers(-4, 4))], fill=(90, 210, 210), width=2)
    d.rectangle([0, H * .68, W, H], fill=(240, 214, 160))
    d.ellipse([640, 90, 780, 230], fill=(255, 248, 210))
    d.polygon([(380, 860), (560, 860), (470, 640)], fill=(235, 70, 80))
    d.ellipse([140, 900, 300, 1000], fill=(60, 160, 90))
    d.ellipse([170, 920, 270, 980], fill=(230, 60, 70))
    return finish(img, 1.6)


def sunset_sea():
    img = to_img(grad((255, 140, 150), (250, 200, 140), h=int(H * .55)))
    sea = to_img(grad((120, 90, 150), (40, 50, 110), h=H - int(H * .55)))
    full = Image.new("RGB", (W, H))
    full.paste(img, (0, 0))
    full.paste(sea, (0, int(H * .55)))
    d = ImageDraw.Draw(full)
    d.ellipse([350, 520, 550, 720], fill=(255, 220, 160))
    d.rectangle([0, int(H * .55), W, H], fill=None)
    for i in range(40):
        y = H * .56 + i * 12
        w = 180 - i * 3
        d.line([(450 - w, y), (450 + w, y)], fill=(255, 190, 150), width=3)
    return finish(full, 2.0)


def snow_street():
    img = to_img(grad((70, 78, 96), (210, 214, 222)))
    d = ImageDraw.Draw(img)
    d.rectangle([0, H * .72, W, H], fill=(232, 234, 240))
    for x in (200, 700):
        d.rectangle([x - 6, H * .3, x + 6, H * .78], fill=(40, 40, 46))
        d.ellipse([x - 40, H * .27, x + 40, H * .33], fill=(255, 214, 120))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for x in (200, 700):
        gd.ellipse([x - 200, H * .1, x + 200, H * .55], fill=(150, 110, 40))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(90)), 0.25)
    d = ImageDraw.Draw(img)
    for _ in range(500):
        x, y, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(1.5, 5)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(245, 245, 250))
    return finish(img, 1.0)


def bare_trees():
    img = to_img(grad((200, 204, 212), (236, 238, 242)))
    d = ImageDraw.Draw(img)

    def branch(x, y, ang, ln, wd, depth):
        if depth == 0 or ln < 8:
            return
        x2, y2 = x + ln * math.cos(ang), y - ln * math.sin(ang)
        d.line([(x, y), (x2, y2)], fill=(50, 50, 58), width=max(1, int(wd)))
        for da in (-0.45, 0.35):
            branch(x2, y2, ang + da + rng.uniform(-.2, .2), ln * .72, wd * .68, depth - 1)

    for x in (260, 620):
        branch(x, H * .95, math.pi / 2, 260, 22, 8)
    return finish(img, 0.9)


def rain_window():
    img = to_img(grad((88, 100, 118), (130, 140, 150)))
    d = ImageDraw.Draw(img)
    blobs(d, 40, (0, H * .3, W, H * .8), [(220, 180, 110), (150, 160, 190), (200, 120, 100), (240, 220, 170)], 20, 60)
    img = img.filter(ImageFilter.GaussianBlur(28))
    d = ImageDraw.Draw(img)
    for _ in range(260):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        r = rng.uniform(3, 9)
        d.ellipse([x - r, y - r * 1.3, x + r, y + r * 1.3], fill=(170, 180, 194))
        if rng.random() < .3:
            d.line([(x, y), (x + rng.uniform(-3, 3), y + rng.uniform(30, 120))], fill=(160, 170, 186), width=2)
    d.rectangle([0, H - 140, W, H], fill=(196, 188, 176))
    return finish(img, 1.1)


def tea_sill():
    img = to_img(grad((150, 160, 170), (190, 190, 186)))
    d = ImageDraw.Draw(img)
    d.rectangle([0, H * .62, W, H], fill=(214, 208, 196))
    d.rectangle([140, H * .52, 520, H * .64], fill=(120, 60, 60))
    d.rectangle([160, H * .49, 500, H * .53], fill=(90, 110, 120))
    cx, cy = 650, 760
    d.rectangle([cx - 90, cy, cx + 90, cy + 160], fill=(238, 236, 230))
    d.ellipse([cx - 90, cy - 30, cx + 90, cy + 30], fill=(238, 236, 230))
    d.ellipse([cx - 76, cy - 22, cx + 76, cy + 22], fill=(150, 100, 50))
    d.ellipse([cx + 70, cy + 30, cx + 140, cy + 110], outline=(238, 236, 230), width=16)
    for k in range(3):
        d.line([(cx - 30 + k * 30, cy - 40), (cx - 10 + k * 30, cy - 160)], fill=(230, 232, 236), width=6)
    return finish(img, 2.2)


def party_lights():
    img = to_img(grad((30, 18, 40), (14, 10, 20)))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cols = [(255, 90, 120), (255, 200, 60), (80, 200, 255), (160, 255, 120), (255, 120, 255)]
    for _ in range(70):
        x, y, r = rng.uniform(0, W), rng.uniform(0, H * .75), rng.uniform(20, 70)
        c = cols[rng.integers(len(cols))]
        gd.ellipse([x - r, y - r, x + r, y + r], fill=c)
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(14)), 0.75)
    d = ImageDraw.Draw(img)
    for i in range(9):
        d.ellipse([60 + i * 95, 160 + 40 * math.sin(i), 80 + i * 95, 180 + 40 * math.sin(i)], fill=(255, 240, 180))
    return finish(img, 1.0)


def cake_candles():
    img = to_img(grad((60, 30, 30), (30, 16, 18)))
    d = ImageDraw.Draw(img)
    d.ellipse([170, 640, 730, 820], fill=(250, 220, 230))
    d.rectangle([170, 730, 730, 950], fill=(250, 220, 230))
    d.ellipse([170, 860, 730, 1040], fill=(230, 190, 205))
    for i, c in enumerate([(255, 80, 120), (90, 190, 255), (255, 210, 70), (140, 230, 120), (200, 120, 255)]):
        x = 250 + i * 100
        d.rectangle([x, 560, x + 18, 720], fill=c)
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i in range(5):
        x = 259 + i * 100
        gd.ellipse([x - 70, 440, x + 70, 620], fill=(255, 170, 60))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(40)), 0.55)
    d = ImageDraw.Draw(img)
    for i in range(5):
        x = 259 + i * 100
        d.ellipse([x - 10, 510, x + 10, 556], fill=(255, 236, 170))
    return finish(img, 1.2)


# ----------------------------------------------------------------- days ---
DAYS = [
    {
        "id": "demo-autumn", "date": "2026-10-12",
        "text": "Гуляли с Айгерим по парку, всё было в жёлтых листьях. Было холодно, пальцы мёрзли, но мы купили какао в маленьком киоске и долго сидели на скамейке у пруда. Пахло мокрыми листьями и корицей. Говорили обо всём на свете и много смеялись. Под вечер солнце стало совсем медовым, и мы никуда не спешили.",
        "photos": [("autumn-1.jpg", autumn_path), ("autumn-2.jpg", cocoa_cups), ("autumn-3.jpg", leaves_ground)],
        "song": {"file": "warm-waltz.wav", "artist": "Демо-трек", "title": "Тёплый вальс", "genre": "jazz", "year": 1962,
                 "gen": dict(bpm=76, root=65, mode="major", style="waltz")},
    },
    {
        "id": "demo-office", "date": "2026-03-05",
        "text": "Срочная сдача проекта. Всю ночь сидели в офисе с командой до четырёх утра, город за окном давно спал. Кофе уже не помогал, глаза болели от экрана, все нервничали и почти не разговаривали. В наушниках долбила электроника, чтобы не уснуть. В 3:40 нажали «отправить» — и наступила тишина.",
        "photos": [("office-1.jpg", night_city), ("office-2.jpg", desk_monitor)],
        "song": {"file": "night-code.wav", "artist": "Демо-трек", "title": "Ночной код", "genre": "electronic", "year": 2024,
                 "gen": dict(bpm=128, root=57, mode="minor", style="electro")},
    },
    {
        "id": "demo-sea", "date": "2026-07-18",
        "text": "Первый день на море в Актау! Проснулись рано и сразу побежали к воде. Солнце жарило, песок обжигал ноги, вода была бирюзовая и прозрачная. Брат прыгал с пирса, мы орали от восторга и ели арбуз прямо на пляже. Вечером закат был розовый, как жвачка.",
        "photos": [("sea-1.jpg", beach_day), ("sea-2.jpg", sunset_sea)],
        "song": {"file": "sea-noon.wav", "artist": "Демо-трек", "title": "Морской полдень", "genre": "pop", "year": 2019,
                 "gen": dict(bpm=116, root=62, mode="major", style="pop")},
    },
    {
        "id": "demo-snow", "date": "2026-12-02",
        "text": "Выпал первый снег. Шла домой одна по пустой улице, фонари светили жёлтым, снег скрипел под ногами. Было тихо и немного грустно — подумала о бабушке, она любила такую погоду. Долго стояла у подъезда и смотрела, как снежинки падают в свет фонаря.",
        "photos": [("snow-1.jpg", snow_street), ("snow-2.jpg", bare_trees)],
        "song": {"file": "first-snow.wav", "artist": "Демо-трек", "title": "Первый снег", "genre": "ambient", "year": 2021,
                 "gen": dict(bpm=64, root=64, mode="minor", style="ambient")},
    },
    {
        "id": "demo-rain", "date": "2026-04-14",
        "text": "Весь день шёл дождь. Никуда не пошла, сидела дома на подоконнике с чаем и пледом, читала старую книгу. Капли стучали по стеклу, по радио тихо играл джаз. Было спокойно и немного сонно, никто не звонил. Мне было хорошо одной.",
        "photos": [("rain-1.jpg", rain_window), ("rain-2.jpg", tea_sill)],
        "song": {"file": "rain-window.wav", "artist": "Демо-трек", "title": "Дождь на окне", "genre": "lofi", "year": 2020,
                 "gen": dict(bpm=84, root=60, mode="minor", style="lofi")},
    },
    {
        "id": "demo-birthday", "date": "2026-09-26",
        "text": "Мой день рождения! Друзья устроили сюрприз: выключили свет, а потом все закричали и включили гирлянды. Торт со свечами, громкая музыка, танцевали до упаду и смеялись так, что болели щёки. Подарили гитару — я чуть не расплакалась от счастья.",
        "photos": [("party-1.jpg", party_lights), ("party-2.jpg", cake_candles)],
        "song": {"file": "party.wav", "artist": "Демо-трек", "title": "Праздник", "genre": "pop", "year": 2025,
                 "gen": dict(bpm=140, root=67, mode="major", style="party")},
    },
]


def main():
    manifest = []
    for day in DAYS:
        for name, fn in day["photos"]:
            fn().save(ROOT / "photos" / name, quality=84)
        s = day["song"]
        song(ROOT / "songs" / s["file"], **s["gen"])
        manifest.append({
            "id": day["id"], "date": day["date"], "text": day["text"],
            "photos": ["photos/" + n for n, _ in day["photos"]],
            "song": {"file": "songs/" + s["file"], "artist": s["artist"], "title": s["title"],
                     "genre": s["genre"], "year": s["year"], "moodHint": s["gen"]["mode"]},
            "truth": {"bpm": s["gen"]["bpm"], "mode": s["gen"]["mode"]},
        })
    (ROOT / "days.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print("ok", len(manifest), "days")


if __name__ == "__main__":
    main()
