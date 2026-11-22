/* Тот день — the memory page renderer (Canvas 2D, 1080×1920, 9:16).
 * Everything is deterministic: the same day always renders the same way.
 */
(function (TD) {
  'use strict';
  const { rgba, mix, rgb2hsl, hsl2rgb, clamp, lum } = TD.color;
  const W = 1080, H = 1920;
  const WIN = { x: 60, y: 150, w: 960, h: 1290 };
  const MONTHS = ['ЯНВАРЯ', 'ФЕВРАЛЯ', 'МАРТА', 'АПРЕЛЯ', 'МАЯ', 'ИЮНЯ', 'ИЮЛЯ', 'АВГУСТА', 'СЕНТЯБРЯ', 'ОКТЯБРЯ', 'НОЯБРЯ', 'ДЕКАБРЯ'];
  const WEEKDAYS = ['ВОСКРЕСЕНЬЕ', 'ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА'];

  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  const ease = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);

  function fontsReady() {
    if (!document.fonts) return Promise.resolve();
    const faces = ['500 40px Caveat', '700 40px Caveat', '500 20px "IBM Plex Mono"', '400 20px "IBM Plex Mono"', '600 40px Oswald',
      '800 40px Rubik', 'italic 400 40px "Cormorant Garamond"'];
    // Kazakh letters live in a separate font file (cyrillic-ext): load it too.
    return Promise.all(faces.map((f) => document.fonts.load(f, 'АаЯя ӘәҒғҚқҢңӨөҰұҮүҺһІі Aa'))).catch(() => {});
  }

  function coverRect(iw, ih, w, h, zoom = 1, px = 0.5, py = 0.5) {
    const s = Math.max(w / iw, h / ih) * zoom, dw = iw * s, dh = ih * s;
    return { x: (w - dw) * px, y: (h - dh) * py, w: dw, h: dh };
  }

  /* Where to draw an image in a w×h area so its important part stays visible
   * (focus = TD.photo.focusOf). Crop to fill the area only while the whole
   * subject still fits; otherwise zoom out just enough to keep it, and leave
   * the rest for a soft blurred copy of the same photo. A photo with no clear
   * subject (an even landscape) fills the area. anchorY: where the subject's
   * centre should sit vertically (0.42 leaves room for a caption below). */
  function placeIn(iw, ih, w, h, f, zoom = 1, anchorY = 0.5) {
    f = f || { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.8, cx: 0.5, cy: 0.5, diffuse: true };
    const cover = Math.max(w / iw, h / ih), contain = Math.min(w / iw, h / ih);
    let s;
    if (f.diffuse) s = cover * zoom;
    else {
      const bw = Math.max(0.05, f.x1 - f.x0) * iw, bh = Math.max(0.05, f.y1 - f.y0) * ih;
      const fit = Math.min(w / (bw * 1.06), h / (bh * 1.06)); // the subject plus a 3 % margin each side
      s = fit >= cover ? Math.min(cover * zoom, fit) : Math.max(fit, contain);
    }
    const dw = iw * s, dh = ih * s;
    const fx = f.diffuse ? f.cx : (f.x0 + f.x1) / 2, fy = f.diffuse ? f.cy : (f.y0 + f.y1) / 2;
    let x = w / 2 - fx * dw, y = h * anchorY - fy * dh;
    x = dw >= w ? clamp(x, w - dw, 0) : (w - dw) / 2;
    y = dh >= h ? clamp(y, h - dh, 0) : clamp(y, 0, h - dh);
    return { x, y, w: dw, h: dh, covers: dw >= w - 0.5 && dh >= h - 0.5 };
  }

  /** Draw a graded photo into area R of g, keeping its subject visible (see placeIn). */
  function drawFocused(g, src, R, zoom = 1, anchorY = 0.5) {
    const p = placeIn(src.width, src.height, R.w, R.h, src.focus, zoom, anchorY);
    g.save();
    g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
    if (!p.covers) {
      // The space the photo does not reach: the same photo, blurred and a little larger.
      const c = coverRect(src.tiny.width, src.tiny.height, R.w, R.h, 1.12);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(src.tiny, R.x + c.x, R.y + c.y, c.w, c.h);
      g.shadowColor = 'rgba(0,0,0,0.28)'; g.shadowBlur = 22; g.shadowOffsetY = 6;
    }
    g.drawImage(src, R.x + p.x, R.y + p.y, p.w, p.h);
    g.restore();
    // Where the subject ended up (area coordinates), so decorations can stay off it.
    const f = src.focus || {};
    return { x0: R.x + p.x + (f.x0 || 0) * p.w, x1: R.x + p.x + (f.x1 == null ? 1 : f.x1) * p.w,
      y0: R.y + p.y + (f.y0 || 0) * p.h, y1: R.y + p.y + (f.y1 == null ? 1 : f.y1) * p.h };
  }

  /** Grade a whole photo (its own shape, nothing cropped) through a 6-bit LUT.
   *  The result carries .focus and a tiny copy (.tiny) for the blurred backdrop. */
  function graded(img, maxSide, gradeFn, map, focus) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, k = Math.min(1, maxSide / Math.max(iw, ih));
    const c = mk(iw * k, ih * k), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data;
    const lut = new Int32Array(262144).fill(-1);
    for (let i = 0; i < d.length; i += 4) {
      const key = ((d[i] >> 2) << 12) | ((d[i + 1] >> 2) << 6) | (d[i + 2] >> 2);
      let v = lut[key];
      if (v < 0) {
        let o = gradeFn([d[i] & 252 | 2, d[i + 1] & 252 | 2, d[i + 2] & 252 | 2]);
        if (map) o = map(o);
        v = lut[key] = (o[0] << 16) | (o[1] << 8) | o[2];
      }
      d[i] = (v >> 16) & 255; d[i + 1] = (v >> 8) & 255; d[i + 2] = v & 255;
    }
    ctx.putImageData(id, 0, 0);
    c.focus = focus || null;
    const t = mk(Math.max(2, c.width / 24), Math.max(2, c.height / 24));
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    c.tiny = t;
    return c;
  }

  function wrap(ctx, text, maxW) {
    const words = text.split(/\s+/), lines = [];
    let line = '';
    words.forEach((w) => {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  function createPlayer(canvas, opts) {
    const { day, design: D, images } = opts;
    const ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    const P = D.palette, M = D.motion, TX = D.texture;
    const gradeFn = TD.system.makeGrade(D.grade);
    const rand = TD.system.rng(D.seed);
    const n = Math.max(1, images.length);
    const st = { raf: 0, playing: false, clock: 0, t0: 0, audio: null, onTick: null, offset: 0, bo: null };
    let staticLayer, layersBy = {}, grainTile, shapesBy = {}, parts = [], focus = [], subject = null;
    // The cut-out card: the whole photo on paper in the upper part of the window.
    const CARD = { x: WIN.w * 0.07, y: WIN.h * 0.04, w: WIN.w * 0.86, h: WIN.h * 0.66, inset: 18 };

    // Mixed days: every N-th shot replays the previous photo in the second
    // technique (the same moment remembered with the other feeling).
    const B = D.blend || {};
    const SEC = B.secondary && B.every ? B.secondary : null;
    function slot(k) {
      if (!SEC) return { tech: D.technique, img: k % n };
      const E = B.every, block = Math.floor(k / E), pos = k % E, inter = pos === E - 1;
      return { tech: inter ? SEC : D.technique, img: (block * (E - 1) + (inter ? pos - 1 : pos)) % n };
    }
    const bgOf = (tech) => (P.windowBgs && P.windowBgs[tech]) || P.windowBg;
    const fadeOf = (tech) => (M.fadeBy && M.fadeBy[tech] != null ? M.fadeBy[tech] : M.fade);

    // Playback can start mid-song (the song's moment): t is time since that
    // start, so the beat grid is shifted by the same offset.
    const beatOff = () => (st.bo != null ? st.bo : M.beatOffset - st.offset);
    const beatPhase = (t) => ((((t - beatOff()) / M.beat) % 1) + 1) % 1;
    const beatEnv = (t) => Math.exp(-((beatPhase(t) + 1) % 1) * 5);

    // ------------------------------------------------------- prepare ---
    function buildStatic() {
      const c = mk(W, H), g = c.getContext('2d');
      g.fillStyle = rgba(P.paper, 1); g.fillRect(0, 0, W, H);
      // paper fibres (constant seed: every page has the same paper)
      const pr = TD.system.rng(42);
      for (let i = 0; i < 2600; i++) {
        g.strokeStyle = rgba(pr() < 0.5 ? [255, 255, 255] : [120, 100, 80], 0.04 + pr() * 0.05);
        g.lineWidth = 0.6 + pr();
        const x = pr() * W, y = pr() * H, a = pr() * Math.PI, l = 4 + pr() * 14;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
      const ink = P.ink;
      const d = new Date((day.date || '2026-01-01') + 'T12:00:00');
      g.fillStyle = rgba(ink, 0.85);
      g.font = '500 26px "IBM Plex Mono", monospace';
      g.textBaseline = 'alphabetic';
      g.fillText(`${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${WEEKDAYS[d.getDay()]}`, 60, 100);
      g.textAlign = 'right';
      g.fillText('ТОТ ДЕНЬ', W - 60, 100);
      g.textAlign = 'left';
      g.fillStyle = rgba(ink, 0.25); g.fillRect(60, 120, W - 120, 1.5);
      // folder title, handwritten, always in the same place
      // One line whenever it fits: the title shrinks (92 → 66 px) rather than wraps.
      // A very long title takes two smaller lines in the same space, so the
      // song line below always stays in the same place on every page.
      const fontAt = (px) => `700 ${px}px Caveat, cursive`;
      let size = 92;
      g.font = fontAt(size);
      while (g.measureText(day.title).width > W - 120 && size > 66) { size -= 2; g.font = fontAt(size); }
      let lines = [day.title];
      if (g.measureText(day.title).width > W - 120) {
        // Two lines; a one-letter preposition never ends a line ("…шаре / в Каппадокии").
        const wrapTitle = () => {
          const ls = wrap(g, day.title, W - 120);
          for (let i = 0; i < ls.length - 1; i++) {
            const words = ls[i].split(' '), last = words[words.length - 1];
            if (words.length > 1 && /^[а-яёa-z]{1,2}$/i.test(last)) { ls[i] = words.slice(0, -1).join(' '); ls[i + 1] = last + ' ' + ls[i + 1]; }
          }
          return ls;
        };
        size = 66; g.font = fontAt(size);
        lines = wrapTitle();
        while ((lines.length > 2 || lines.some((l) => g.measureText(l).width > W - 120)) && size > 40) { size -= 2; g.font = fontAt(size); lines = wrapTitle(); }
      }
      g.fillStyle = rgba(ink, 0.95);
      const ty = lines.length > 1 ? 1532 : 1545;
      lines.slice(0, 2).forEach((l, i) => g.fillText(l, 60, ty + i * size * 0.95));
      // song + day labels: the same place on every page
      const m = day.music || {};
      const y0 = 1700;
      g.font = '500 25px "IBM Plex Mono", monospace';
      g.fillStyle = rgba(ink, 0.85);
      const song = [day.song && day.song.title, day.song && day.song.artist].filter(Boolean).join(' — ') || 'песня дня';
      g.fillText('♪ ' + song.slice(0, 44), 60, y0);
      g.font = '400 22px "IBM Plex Mono", monospace';
      g.fillStyle = rgba(ink, 0.6);
      const facts = [m.bpm ? Math.round(m.bpm) + ' BPM' : null, m.mode === 'major' ? 'мажор' : m.mode === 'minor' ? 'минор' : null, m.genreLabel, day.song && day.song.year].filter(Boolean);
      g.fillText(facts.join(' · '), 60, y0 + 38);
      const lab = [D.labels.season, D.labels.time, ...(D.labels.weather || [])].filter(Boolean);
      const techStr = (D.techniqueInfo.name + (SEC ? ' + ' + B.secondaryInfo.name : '')).toLowerCase();
      while (lab.length && (lab.join(' · ') + '  /  ' + techStr).length > 58) lab.pop();
      g.fillText(((lab.length ? lab.join(' · ') + '  /  ' : '') + techStr).slice(0, 60), 60, y0 + 74);
      // "печать дня": the same seal on every page, the dot moves with mood
      const cx = W - 140, cy = H - 165, r = 70;
      g.strokeStyle = rgba(ink, 0.8); g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = rgba(ink, 0.25); g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
      g.font = '400 15px "IBM Plex Mono", monospace'; g.fillStyle = rgba(ink, 0.55); g.textAlign = 'center';
      g.fillText('ГРОМКО', cx, cy - r - 10); g.fillText('ТИХО', cx, cy + r + 22);
      g.textAlign = 'right'; g.fillText('−', cx - r - 8, cy + 5); g.textAlign = 'left'; g.fillText('+', cx + r + 8, cy + 5);
      const dx = cx + D.mood.valence * r * 0.78, dy = cy - (D.mood.energy - 0.5) * 2 * r * 0.78;
      g.fillStyle = rgba(P.accent, 1); g.beginPath(); g.arc(dx, dy, 13, 0, Math.PI * 2); g.fill();
      g.strokeStyle = rgba(ink, 0.9); g.lineWidth = 2; g.stroke();
      return c;
    }

    function buildGrain() {
      const c = mk(256, 256), g = c.getContext('2d'), id = g.createImageData(256, 256), r = TD.system.rng(7);
      for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (r() - 0.5) * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
      g.putImageData(id, 0, 0);
      return c;
    }

    function buildBrush(img, idx) {
      const w = WIN.w, h = WIN.h, k = 4;
      // The photo placed with its subject kept (caption room below), then painted over.
      const small = mk(w / k, h / k), sctx = small.getContext('2d', { willReadFrequently: true });
      drawFocused(sctx, graded(img, 520, gradeFn, null, focus[idx]), { x: 0, y: 0, w: small.width, h: small.height }, 1, 0.42);
      const sd = sctx.getImageData(0, 0, small.width, small.height).data;
      const sw = small.width, sh = small.height;
      const px = (x, y) => { x = clamp(x | 0, 0, sw - 1); y = clamp(y | 0, 0, sh - 1); const i = (y * sw + x) * 4; return [sd[i], sd[i + 1], sd[i + 2]]; };
      const base = mk(w, h), bg = base.getContext('2d');
      const tiny = mk(sw / 3, sh / 3); tiny.getContext('2d').drawImage(small, 0, 0, tiny.width, tiny.height);
      bg.imageSmoothingQuality = 'high'; bg.drawImage(tiny, 0, 0, w, h);
      const r = TD.system.rng(D.seed + idx * 101);
      const len = TX.strokeLen, wid = 5 + 5 * (1 - D.mood.energy);
      const baseAngle = -0.35 + r() * 0.2;
      const variants = [];
      for (let v = 0; v < 2; v++) {
        const c = mk(w, h), g = c.getContext('2d');
        g.drawImage(base, 0, 0);
        g.lineCap = 'round';
        const N = Math.round(w * h / (len * wid * 0.5));
        for (let i = 0; i < N; i++) {
          const x = r() * w, y = r() * h, sx = x / k, sy = y / k;
          const c0 = px(sx, sy);
          const gx = lum(px(sx + 1, sy)) - lum(px(sx - 1, sy)), gy = lum(px(sx, sy + 1)) - lum(px(sx, sy - 1));
          const mag = Math.hypot(gx, gy);
          const a = mag > 0.04 ? Math.atan2(gy, gx) + Math.PI / 2 + (r() - 0.5) * 0.4 : baseAngle + (r() - 0.5) * 0.7;
          const hsl = rgb2hsl(c0);
          const col = hsl2rgb([hsl[0] + (r() - 0.5) * 14, clamp(hsl[1] * (0.95 + r() * 0.2), 0, 1), clamp(hsl[2] + (r() - 0.5) * 0.12, 0, 1)]);
          const L = len * (0.6 + r() * 0.8), ca = Math.cos(a) * L / 2, sa = Math.sin(a) * L / 2, bend = (r() - 0.5) * L * 0.3;
          g.strokeStyle = rgba(col, 0.78);
          g.lineWidth = wid * (0.6 + r() * 0.8);
          g.beginPath(); g.moveTo(x - ca, y - sa);
          g.quadraticCurveTo(x - sa * bend / L * 2, y + ca * bend / L * 2, x + ca, y + sa); g.stroke();
        }
        variants.push(c);
      }
      return { variants };
    }

    function buildGeometry(img, idx) {
      const dk = mix(P.dark, [16, 20, 36], 0.55), lt = mix(P.light, [236, 230, 214], 0.35);
      const duo = graded(img, 1000, gradeFn, (o) => {
        let l = lum(o); l = l * l * (3 - 2 * l); l = clamp((l - 0.5) * 1.35 + 0.5, 0, 1);
        return mix(dk, lt, l).map(Math.round);
      }, focus[idx]);
      return { duo };
    }

    function buildCutout(img, idx) { return { photo: graded(img, 1100, gradeFn, null, focus[idx]) }; }
    function buildMa(img, idx) { return { photo: graded(img, 800, gradeFn, null, focus[idx]) }; }

    function buildShapes(tech) {
      const out = [];
      const r = TD.system.rng(D.seed + 7);
      const [ah, as] = rgb2hsl(P.accent);
      const triad = [P.accent, hsl2rgb([ah + 120, clamp(as, 0.55, 0.85), 0.55]), hsl2rgb([ah + 240, clamp(as, 0.55, 0.85), 0.5])];
      if (tech === 'geometry') {
        const cols = [...triad, [236, 230, 214], [12, 12, 16]];
        const count = Math.round(7 + 10 * D.mood.energy);
        const types = ['circle', 'ring', 'line', 'tri', 'semi', 'grid', 'line', 'circle', 'checker'];
        for (let i = 0; i < count; i++) out.push({
          type: types[Math.floor(r() * types.length)], x: Math.round(r() * 12) / 12 * WIN.w, y: Math.round(r() * 16) / 16 * WIN.h,
          s: 30 + r() * 170, col: cols[Math.floor(r() * cols.length)], rot: r() * Math.PI * 2, spin: (r() - 0.5) * 0.4,
          off: r() < 0.5 ? 0 : 0.5, len: 400 + r() * 900,
        });
      } else if (tech === 'cutout') {
        const bgH = rgb2hsl(bgOf('cutout'))[0];
        const cols = [...triad.filter((c) => Math.abs(((rgb2hsl(c)[0] - bgH + 540) % 360) - 180) > 40), [250, 246, 238], [30, 30, 40], ...P.colors.filter((c) => rgb2hsl(c)[1] > 0.4)];
        const count = Math.round(6 + 6 * D.mood.energy);
        for (let i = 0; i < count; i++) {
          // Only in the margins: the sides (peeking in from the edge) and the band below the card.
          const zone = i % 3, side = r() < 0.5;
          const pos = zone < 2
            ? { x: (side ? -0.02 + r() * 0.06 : 0.96 + r() * 0.06) * WIN.w, y: (0.06 + r() * 0.86) * WIN.h, s: 40 + r() * 50 }
            : { x: r() * WIN.w, y: (0.74 + r() * 0.24) * WIN.h, s: 50 + r() * 80 };
          out.push({
            type: r() < 0.6 ? 'leaf' : 'dot', lobes: 3 + Math.floor(r() * 5), ...pos,
            col: cols[Math.floor(r() * cols.length)] || [250, 246, 238], rot: r() * Math.PI * 2,
            ph: r() * Math.PI * 2, depth: 0.2 + r() * 0.35,
          });
        }
      }
      return out;
    }

    function buildParticles() {
      const r = TD.system.rng(D.seed + 99);
      const kind = TX.particles;
      const count = { snow: 110, rain: 140, leaves: 16, fog: 4, confetti: 60 }[kind] || 0;
      const warm = P.colors.filter((c) => rgb2hsl(c)[1] > 0.3);
      for (let i = 0; i < count; i++) parts.push({
        x: r() * WIN.w, y: r() * WIN.h, s: r(), sp: 0.4 + r() * 0.8, ph: r() * Math.PI * 2,
        col: kind === 'confetti' ? [P.accent, ...P.colors][Math.floor(r() * (P.colors.length + 1))] : (warm[Math.floor(r() * warm.length)] || P.accent),
      });
    }

    async function prepare() {
      await fontsReady();
      focus = images.map((img) => (TD.photo.focusOf ? TD.photo.focusOf(img) : null));
      staticLayer = buildStatic();
      grainTile = buildGrain();
      (SEC ? [D.technique, SEC] : [D.technique]).forEach((tech) => {
        layersBy[tech] = images.map((img, i) => (tech === 'brush' ? buildBrush(img, i) : tech === 'geometry' ? buildGeometry(img, i)
          : tech === 'cutout' ? buildCutout(img, i) : buildMa(img, i)));
        if (!layersBy[tech].length) layersBy[tech] = [null];
        shapesBy[tech] = buildShapes(tech);
      });
      buildParticles();
    }

    // ------------------------------------------------------------ shots ---
    function drawShot(g, k, t, sp, alpha, fillBg) {
      const { tech, img: idx } = slot(k);
      const ls = layersBy[tech], L = ls[idx % ls.length], img = images[idx % Math.max(1, images.length)];
      if (!L) return;
      const w = WIN.w, h = WIN.h;
      g.save();
      g.globalAlpha = alpha;
      if (fillBg) { g.fillStyle = rgba(bgOf(tech), 1); g.fillRect(0, 0, w, h); }
      if (tech === 'brush') {
        const z = 1 + M.zoom * sp, A = L.variants[0], B = L.variants[1];
        g.translate(w / 2, h / 2); g.scale(z, z); g.translate(-w / 2, -h / 2);
        g.drawImage(A, 0, 0);
        g.globalAlpha = alpha * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 / (M.beat * 8)));
        g.drawImage(B, 0, 0);
      } else if (tech === 'geometry') {
        const lay = k % 3, src = L.duo;
        const z = 1 + M.zoom * sp;
        g.save();
        g.beginPath();
        if (lay === 0) g.rect(w * 0.06, h * 0.07, w * 0.64, h * 0.6);
        else if (lay === 1) g.arc(w * 0.56, h * 0.42, w * 0.38, 0, Math.PI * 2);
        else { g.moveTo(0, h * 0.22); g.lineTo(w, h * 0.04); g.lineTo(w, h * 0.6); g.lineTo(0, h * 0.8); g.closePath(); }
        g.clip();
        const R = lay === 0 ? { x: w * 0.06, y: h * 0.07, w: w * 0.64, h: h * 0.6 }
          : lay === 1 ? { x: w * 0.18, y: h * 0.42 - w * 0.38, w: w * 0.76, h: w * 0.76 } : { x: 0, y: h * 0.04, w, h: h * 0.76 };
        subject = drawFocused(g, src, R, z);
        g.restore();
      } else if (tech === 'cutout') {
        // The whole photo on a hand-cut paper card (Matisse cut his shapes with
        // scissors). The card takes the photo's own shape, so nothing is cropped
        // unless the photo is taller than the space; the paper shapes stay around it.
        const r = TD.system.rng(D.seed + k * 31), src = L.photo, ar = src.width / src.height;
        const innerW = CARD.w - 2 * CARD.inset, innerH = clamp(innerW / ar, innerW * 0.6, CARD.h - 2 * CARD.inset);
        const cw = CARD.w, ch = innerH + 2 * CARD.inset, cx = CARD.x + cw / 2, cy = CARD.y + CARD.h / 2;
        const pop = 1 - 0.05 * Math.exp(-sp * M.beatsPerShot * 3), tilt = (r() - 0.5) * 0.035;
        const pts = [];
        const side = (x0, y0, x1, y1) => { for (let i = 0; i < 6; i++) { const u = i / 6; pts.push([x0 + (x1 - x0) * u + (r() - 0.5) * 5, y0 + (y1 - y0) * u + (r() - 0.5) * 5]); } };
        const c = 14 + r() * 10; // snipped corners
        side(c, 0, cw - c, 0); side(cw, c, cw, ch - c); side(cw - c, ch, c, ch); side(0, ch - c, 0, c);
        const cut = () => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
        g.save();
        g.translate(cx, cy); g.rotate(tilt); g.scale(pop, pop); g.translate(-cw / 2, -ch / 2);
        g.save(); g.translate(10, 14); cut(); g.fillStyle = 'rgba(0,0,0,0.16)'; g.fill(); g.restore();
        cut(); g.fillStyle = 'rgb(250,246,238)'; g.fill();
        drawFocused(g, src, { x: CARD.inset, y: CARD.inset, w: innerW, h: innerH }, 1 + M.zoom * 0.5 * sp);
        g.restore();
        subject = { x0: CARD.x, x1: CARD.x + cw, y0: cy - ch / 2, y1: cy + ch / 2 };
      } else {
        const src = L.photo, ar = clamp(src.width / src.height, 0.6, 1.5);
        const pw = w * clamp(1 - D.air, 0.32, 0.7), ph = Math.min(pw / ar, h * 0.58);
        const left = k % 2 === 0;
        const x = (left ? w * 0.1 : w * 0.9 - pw) + 10 * Math.sin(t / 9), y = h * 0.14 + 6 * Math.sin(t / 11);
        drawFocused(g, src, { x, y, w: pw, h: ph }, 1 + M.zoom * 0.5 * sp);
      }
      g.restore();
    }

    function drawShapes(g, t, sp, tech, within) {
      const w = WIN.w, h = WIN.h, shapes = shapesBy[tech] || [];
      if (tech === 'geometry') {
        shapes.forEach((s, i) => {
          const pulse = 1 + M.pulse * 2.2 * Math.exp(-((((t - beatOff()) / M.beat + s.off) % 1 + 1) % 1) * 5);
          g.save(); g.translate(s.x, s.y); g.rotate(s.rot + t * s.spin * D.mood.energy); g.scale(pulse, pulse);
          // A filled shape over the photo's subject (faces, people) turns see-through.
          const rad = s.s * 0.6 * pulse;
          const over = subject && s.type !== 'line' && s.type !== 'ring' && s.x + rad > subject.x0 && s.x - rad < subject.x1 && s.y + rad > subject.y0 && s.y - rad < subject.y1;
          const op = over ? 0.22 : 0.92;
          g.fillStyle = rgba(s.col, op); g.strokeStyle = rgba(s.col, over ? 0.5 : 0.95);
          if (s.type === 'circle') { g.beginPath(); g.arc(0, 0, s.s * 0.5, 0, Math.PI * 2); g.fill(); }
          else if (s.type === 'ring') { g.lineWidth = 6 + s.s * 0.05; g.beginPath(); g.arc(0, 0, s.s * 0.55, 0, Math.PI * 2); g.stroke(); }
          else if (s.type === 'line') { g.lineWidth = 4 + s.s * 0.04; const l = s.len * ease(sp * 2.5 + i * 0.05); g.beginPath(); g.moveTo(-l / 2, 0); g.lineTo(l / 2, 0); g.stroke(); }
          else if (s.type === 'tri') { g.beginPath(); g.moveTo(0, -s.s * 0.6); g.lineTo(s.s * 0.55, s.s * 0.4); g.lineTo(-s.s * 0.55, s.s * 0.4); g.closePath(); g.fill(); }
          else if (s.type === 'semi') { g.beginPath(); g.arc(0, 0, s.s * 0.5, 0, Math.PI); g.closePath(); g.fill(); }
          else if (s.type === 'grid') { for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) { g.beginPath(); g.arc(a * 18 - 27, b * 18 - 27, 4, 0, Math.PI * 2); g.fill(); } }
          else { for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if ((a + b) % 2 === 0) g.fillRect(a * 22 - 33, b * 22 - 33, 22, 22); }
          g.restore();
        });
      } else if (tech === 'cutout') {
        shapes.forEach((s) => {
          const bounce = M.pulse * 160 * s.depth * Math.exp(-beatPhase(t) * 4);
          const rot = s.rot + (M.sway * Math.PI / 180) * Math.sin(t * Math.PI * 2 / (M.beat * 2) + s.ph);
          g.save(); g.translate(s.x, s.y - bounce); g.rotate(rot);
          const path = () => {
            g.beginPath();
            if (s.type === 'dot') { g.arc(0, 0, s.s * 0.28, 0, Math.PI * 2); return; }
            for (let i = 0; i <= 80; i++) {
              const a = i / 80 * Math.PI * 2, rr = s.s * 0.5 * (0.62 + 0.38 * Math.sin(a * s.lobes + s.ph)) * (0.85 + 0.15 * Math.cos(a * 2));
              const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 1.25;
              i ? g.lineTo(x, y) : g.moveTo(x, y);
            }
            g.closePath();
          };
          g.save(); g.translate(6, 9); path(); g.fillStyle = 'rgba(0,0,0,0.14)'; g.fill(); g.restore();
          path(); g.fillStyle = rgba(s.col, 1); g.fill();
          g.restore();
        });
      } else if (tech === 'ma') {
        const y = h * 0.78;
        g.strokeStyle = rgba(P.ink, 0.7); g.lineWidth = 2;
        const l = w * 0.84 * ease((tech === D.technique ? t : within) / (M.shotDur * 0.8));
        g.beginPath(); g.moveTo(w * 0.08, y); g.lineTo(w * 0.08 + l, y); g.stroke();
        const red = rgb2hsl(P.accent)[1] > 0.45 && Math.abs(((rgb2hsl(P.accent)[0] + 180) % 360) - 180) < 40 ? P.accent : [190, 58, 42];
        g.fillStyle = rgba(red, 0.9);
        g.fillRect(w * 0.84, y - 70, 44, 44);
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(w * 0.84 + 12, y - 58); g.lineTo(w * 0.84 + 32, y - 38); g.stroke();
      }
    }

    function drawParticles(g, t, tech) {
      const w = WIN.w, h = WIN.h, kind = TX.particles;
      // Weather stays all day; celebration confetti stops during a Ma pause.
      if (!kind || (kind === 'confetti' && tech === 'ma')) return;
      parts.forEach((p) => {
        if (kind === 'snow') {
          const y = (p.y + t * 40 * p.sp) % (h + 20) - 10, x = p.x + Math.sin(t * 0.8 + p.ph) * 14;
          g.fillStyle = `rgba(255,255,255,${0.55 + p.s * 0.4})`; g.beginPath(); g.arc(x, y, 2 + p.s * 4, 0, Math.PI * 2); g.fill();
        } else if (kind === 'rain') {
          const y = (p.y + t * 700 * p.sp) % (h + 80) - 40, x = (p.x + t * 120 * p.sp) % w;
          g.strokeStyle = `rgba(230,236,245,${0.18 + p.s * 0.25})`; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10, y + 30 + p.s * 30); g.stroke();
        } else if (kind === 'leaves') {
          const y = (p.y + t * 45 * p.sp) % (h + 60) - 30, x = p.x + Math.sin(t * 0.9 + p.ph) * 40;
          g.save(); g.translate(x, y); g.rotate(t * p.sp + p.ph); g.fillStyle = rgba(p.col, 0.9);
          g.beginPath(); g.ellipse(0, 0, 9 + p.s * 10, 4 + p.s * 4, 0, 0, Math.PI * 2); g.fill(); g.restore();
        } else if (kind === 'fog') {
          const x = ((p.x + t * 18 * p.sp) % (w * 1.6)) - w * 0.3, y = h * (0.2 + p.s * 0.6);
          const gr = g.createRadialGradient(x, y, 0, x, y, w * 0.6);
          gr.addColorStop(0, 'rgba(255,255,255,0.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr; g.fillRect(0, 0, w, h);
        } else if (kind === 'confetti') {
          const y = (p.y + t * 90 * p.sp) % (h + 40) - 20, x = p.x + Math.sin(t * 2 + p.ph) * 20;
          g.save(); g.translate(x, y - M.pulse * 60 * Math.exp(-beatPhase(t) * 4)); g.rotate(t * 3 * p.sp + p.ph);
          g.fillStyle = rgba(p.col, 0.95); g.fillRect(-6, -3, 12 + p.s * 6, 6); g.restore();
        }
      });
    }

    function drawCaption(g, t, final, tech) {
      const text = (day.caption || '').trim();
      if (!text) return;
      const ty = D.typo, w = WIN.w, h = WIN.h;
      const capStart = Math.min(M.shotDur * 0.5, 2.2);
      g.save();
      // The whole caption fits: the font shrinks (down to 60 %) before anything is cut.
      const str = ty.upper ? text.toUpperCase() : text;
      const maxW = D.technique === 'ma' ? w * 0.8 : w * 0.78, maxLines = D.technique === 'ma' ? 4 : 5;
      let size = ty.size, lines;
      const fontAt = (px) => `${ty.italic ? 'italic ' : ''}${ty.weight} ${px}px "${ty.font}"`;
      for (;;) {
        g.font = fontAt(size);
        lines = wrap(g, str, maxW);
        if (lines.length <= maxLines || size <= ty.size * 0.6) break;
        size -= 2;
      }
      if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s,.;:—-]*\S*$/, '') + '…'; }
      const lh = size * (D.technique === 'brush' ? 1.0 : 1.18);
      const tt = final ? 1e9 : t - capStart;
      if (tt < 0) { g.restore(); return; }
      if (D.technique === 'brush') {
        const bw = Math.max(...lines.map((l) => g.measureText(l).width)) + 56, bh = lines.length * lh + 40;
        const x = 36, y = h - bh - 46;
        g.translate(x, y); g.rotate(-0.02);
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(6, 8, bw, bh);
        g.fillStyle = rgba(P.paper, 0.96); g.fillRect(0, 0, bw, bh);
        let wi = 0;
        lines.forEach((l, i) => {
          let xx = 28;
          l.split(' ').forEach((word) => {
            const a = clamp((tt - wi * M.beat * 0.5) / (M.beat * 1.5), 0, 1); wi++;
            g.fillStyle = rgba(P.ink, a); g.fillText(word, xx, 22 + lh * 0.8 + i * lh);
            xx += g.measureText(word + ' ').width;
          });
        });
      } else if (D.technique === 'geometry') {
        if (g.letterSpacing !== undefined) g.letterSpacing = '2px';
        const y0 = h - lines.length * (lh + 6) - 40;
        lines.forEach((l, i) => {
          if (tt < i * M.beat) return;
          const lw = g.measureText(l).width;
          g.fillStyle = rgba([12, 12, 16], 0.95); g.fillRect(40, y0 + i * (lh + 6), lw + 36, lh);
          g.fillStyle = rgba([240, 234, 220], 1); g.fillText(l, 58, y0 + i * (lh + 6) + size * 0.98);
        });
      } else if (D.technique === 'cutout') {
        const bw = Math.max(...lines.map((l) => g.measureText(l).width)) + 60, bh = lines.length * lh + 44;
        const x = (w - bw) / 2, y = h - bh - 50;
        g.translate(x + bw / 2, y + bh / 2); g.rotate(0.022); g.translate(-bw / 2, -bh / 2);
        g.fillStyle = 'rgba(0,0,0,0.16)'; g.beginPath(); g.roundRect ? g.roundRect(8, 10, bw, bh, 26) : g.rect(8, 10, bw, bh); g.fill();
        g.fillStyle = 'rgba(252,249,242,1)'; g.beginPath(); g.roundRect ? g.roundRect(0, 0, bw, bh, 26) : g.rect(0, 0, bw, bh); g.fill();
        let wi = 0;
        lines.forEach((l, i) => {
          let xx = 30;
          l.split(' ').forEach((word) => {
            const k = clamp((tt - wi * M.beat * 0.5) / (M.beat * 0.6), 0, 1); wi++;
            const s = k <= 0 ? 0 : 1 + 0.25 * Math.sin(k * Math.PI) * (1 - k);
            const ww = g.measureText(word).width;
            if (k > 0) {
              g.save(); g.translate(xx + ww / 2, 22 + i * lh + lh * 0.55); g.scale(s, s);
              g.fillStyle = rgba(P.ink, 1); g.textAlign = 'center'; g.fillText(word, 0, size * 0.35); g.restore();
            }
            xx += g.measureText(word + ' ').width;
          });
        });
      } else {
        const y0 = Math.min(h * 0.78 + 70, h - 40 - (lines.length - 1) * lh);
        // Ma's caption has no plate of its own; on a busy interlude shot it gets
        // a soft paper backing so it stays readable.
        if (tech !== 'ma' && tech !== 'geometry') {
          const bw = Math.max(...lines.map((l) => g.measureText(l).width)) + 48;
          g.fillStyle = rgba(P.paper, 0.82 * clamp(tt / (M.beat * 3), 0, 1));
          g.fillRect(w * 0.08 - 24, y0 - size - 8, bw, lines.length * lh + 30);
        }
        lines.forEach((l, i) => {
          const a = clamp((tt - i * M.beat * 4) / (M.beat * 3), 0, 1);
          g.fillStyle = rgba(tech === 'geometry' ? P.paper : P.ink, 0.88 * a); g.fillText(l, w * 0.08, y0 + i * lh);
        });
      }
      g.restore();
    }

    // ------------------------------------------------------------- frame ---
    function draw(t, o = {}) {
      t = Math.max(0, t);
      ctx.drawImage(staticLayer, 0, 0);
      const w = WIN.w, h = WIN.h;
      ctx.save();
      ctx.translate(WIN.x, WIN.y);
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      ctx.fillStyle = rgba(P.windowBg, 1); ctx.fillRect(0, 0, w, h);
      // One photo: one long shot with a slow zoom over the whole moment, no "changes" to itself.
      const single = images.length <= 1, loopLen = st.duration || M.shotDur * 6;
      const shot = single ? 0 : Math.floor(t / M.shotDur);
      const within = single ? t % loopLen : t - shot * M.shotDur, sp = single ? within / loopLen : within / M.shotDur;
      // Each shot comes in with its own technique's transition.
      const cur = slot(shot).tech, prev = shot > 0 ? slot(shot - 1).tech : cur, fadeIn = fadeOf(cur);
      if (fadeIn > 0 && shot > 0 && within < fadeIn) {
        drawShot(ctx, shot - 1, t, 1, 1, prev !== D.technique);
        drawShot(ctx, shot, t, sp, ease(within / fadeIn), cur !== prev || cur !== D.technique);
      } else drawShot(ctx, shot, t, sp, 1, cur !== D.technique);
      drawShapes(ctx, t, sp, cur, within);
      drawParticles(ctx, t, cur);
      if (TX.leak) {
        const a = TX.leak * (0.8 + 0.2 * Math.sin(t * 0.7));
        const gr = ctx.createRadialGradient(w * 0.95, h * 0.05, 0, w * 0.95, h * 0.05, w * 0.9);
        gr.addColorStop(0, `rgba(255,170,90,${a})`); gr.addColorStop(0.5, `rgba(255,120,80,${a * 0.35})`); gr.addColorStop(1, 'rgba(255,120,80,0)');
        ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
      }
      if (TX.vignette) {
        const gr = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.75);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${TX.vignette})`);
        ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
      }
      if (fadeIn === 0 && shot > 0 && within < 0.09) { ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - within / 0.09)})`; ctx.fillRect(0, 0, w, h); }
      drawCaption(ctx, t, o.final, cur);
      if (TX.grain > 0) {
        const f = Math.floor(t * 12), ox = (f * 73) % 256, oy = (f * 151) % 256;
        ctx.globalAlpha = TX.grain * 0.55; ctx.globalCompositeOperation = 'overlay';
        ctx.translate(-ox, -oy);
        for (let y = 0; y < h + 256; y += 256) for (let x = 0; x < w + 256; x += 256) ctx.drawImage(grainTile, x, y);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
      // photo corners: how every photo is "glued" into the diary
      ctx.fillStyle = rgba(P.paper, 1);
      const c = 54;
      [[WIN.x, WIN.y, 1, 1], [WIN.x + w, WIN.y, -1, 1], [WIN.x, WIN.y + h, 1, -1], [WIN.x + w, WIN.y + h, -1, -1]].forEach(([x, y, sx, sy]) => {
        ctx.beginPath(); ctx.moveTo(x - 6 * sx, y - 6 * sy); ctx.lineTo(x + c * sx, y - 6 * sy); ctx.lineTo(x - 6 * sx, y + c * sy); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rgba(P.ink, 0.18); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + c * sx, y - 6 * sy); ctx.lineTo(x - 6 * sx, y + c * sy); ctx.stroke();
      });
      // progress line under the photo window
      const dur = o.duration || st.duration || M.shotDur * Math.max(n, 3) * 2;
      const prog = o.final ? 1 : (t % dur) / dur;
      ctx.fillStyle = rgba(P.ink, 0.15); ctx.fillRect(WIN.x, WIN.y + h + 20, w, 2);
      ctx.fillStyle = rgba(P.ink, 0.8); ctx.fillRect(WIN.x, WIN.y + h + 19, w * prog, 4);
    }

    function now() {
      if (st.audio && !isNaN(st.audio.currentTime) && st.audio.currentTime > 0) return st.audio.currentTime - st.offset;
      return st.clock + (st.playing ? (performance.now() - st.t0) / 1000 : 0);
    }
    function loop() {
      draw(now());
      if (st.onTick) st.onTick(now());
      st.raf = requestAnimationFrame(loop);
    }

    return {
      prepare, draw,
      /** @param audio  anything with currentTime (an <audio>, or a YouTube clock)
       *  @param opts   {offset: song time of t=0, duration, beatOffset relative to t=0} */
      start(audio, opts = {}) {
        st.audio = audio || null;
        st.offset = opts.offset || 0;
        st.bo = opts.beatOffset != null ? opts.beatOffset : null;
        st.duration = opts.duration || (audio && isFinite(audio.duration) ? audio.duration : null);
        st.t0 = performance.now(); st.playing = true;
        cancelAnimationFrame(st.raf); loop();
      },
      pause() { st.clock = now(); st.playing = false; },
      resume() { st.t0 = performance.now(); st.playing = true; },
      stop() { cancelAnimationFrame(st.raf); st.playing = false; },
      set onTick(fn) { st.onTick = fn; },
      cover(size = 540) {
        draw(Math.min(M.shotDur * 0.7, 3), { final: true });
        const c = mk(size, size * H / W);
        c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.86);
      },
      W, H,
    };
  }

  TD.render = { createPlayer, fontsReady, placeIn, WIN, W, H };
})(globalThis.TD = globalThis.TD || {});
