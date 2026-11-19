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
    return Promise.all(faces.map((f) => document.fonts.load(f, 'АаЯя Aa'))).catch(() => {});
  }

  function coverRect(iw, ih, w, h, zoom = 1, px = 0.5, py = 0.5) {
    const s = Math.max(w / iw, h / ih) * zoom, dw = iw * s, dh = ih * s;
    return { x: (w - dw) * px, y: (h - dh) * py, w: dw, h: dh };
  }

  /** Cover-crop an image into w×h and grade every pixel through a 6-bit LUT. */
  function graded(img, w, h, gradeFn, map) {
    const c = mk(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
    const r = coverRect(img.naturalWidth || img.width, img.naturalHeight || img.height, c.width, c.height);
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
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

  function smoothBlob(ctx, pts) {
    const n = pts.length;
    ctx.beginPath();
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let m0 = mid(pts[n - 1], pts[0]);
    ctx.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const m = mid(pts[i], pts[(i + 1) % n]);
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    ctx.closePath();
  }

  function createPlayer(canvas, opts) {
    const { day, design: D, images } = opts;
    const ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    const P = D.palette, M = D.motion, TX = D.texture;
    const gradeFn = TD.system.makeGrade(D.grade);
    const rand = TD.system.rng(D.seed);
    const n = Math.max(1, images.length);
    const st = { raf: 0, playing: false, clock: 0, t0: 0, audio: null, onTick: null };
    let staticLayer, layers = [], grainTile, shapes = [], parts = [];

    const beatPhase = (t) => ((t - M.beatOffset) / M.beat) % 1;
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
      let size = 92;
      g.font = `700 ${size}px Caveat, cursive`;
      let lines = wrap(g, day.title, W - 120);
      while (lines.length > 2 && size > 60) { size -= 6; g.font = `700 ${size}px Caveat, cursive`; lines = wrap(g, day.title, W - 120); }
      g.fillStyle = rgba(ink, 0.95);
      lines.slice(0, 2).forEach((l, i) => g.fillText(l, 60, 1545 + i * size * 0.95));
      // song + day labels
      const m = day.music || {};
      const y0 = lines.length > 1 ? 1755 : 1700;
      g.font = '500 25px "IBM Plex Mono", monospace';
      g.fillStyle = rgba(ink, 0.85);
      const song = [day.song && day.song.title, day.song && day.song.artist].filter(Boolean).join(' — ') || 'песня дня';
      g.fillText('♪ ' + song.slice(0, 44), 60, y0);
      g.font = '400 22px "IBM Plex Mono", monospace';
      g.fillStyle = rgba(ink, 0.6);
      const facts = [m.bpm ? Math.round(m.bpm) + ' BPM' : null, m.mode === 'major' ? 'мажор' : m.mode === 'minor' ? 'минор' : null, m.genreLabel, day.song && day.song.year].filter(Boolean);
      g.fillText(facts.join(' · '), 60, y0 + 38);
      const lab = [D.labels.season, D.labels.time, ...(D.labels.weather || [])].filter(Boolean);
      g.fillText((lab.join(' · ') + '  /  ' + D.techniqueInfo.name.toLowerCase()).slice(0, 60), 60, y0 + 74);
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
      const small = graded(img, w / k, h / k, gradeFn);
      const sd = small.getContext('2d').getImageData(0, 0, small.width, small.height).data;
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

    function buildGeometry(img) {
      const dk = mix(P.dark, [16, 20, 36], 0.55), lt = mix(P.light, [236, 230, 214], 0.35);
      const duo = graded(img, WIN.w * 0.6, WIN.h * 0.6, gradeFn, (o) => {
        let l = lum(o); l = l * l * (3 - 2 * l); l = clamp((l - 0.5) * 1.35 + 0.5, 0, 1);
        return mix(dk, lt, l).map(Math.round);
      });
      return { duo };
    }

    function buildCutout(img) { return { photo: graded(img, WIN.w * 0.75, WIN.h * 0.75, gradeFn) }; }
    function buildMa(img) { return { photo: graded(img, WIN.w * 0.7, WIN.h * 0.7, gradeFn) }; }

    function buildShapes() {
      const r = TD.system.rng(D.seed + 7);
      const [ah, as] = rgb2hsl(P.accent);
      const triad = [P.accent, hsl2rgb([ah + 120, clamp(as, 0.55, 0.85), 0.55]), hsl2rgb([ah + 240, clamp(as, 0.55, 0.85), 0.5])];
      if (D.technique === 'geometry') {
        const cols = [...triad, [236, 230, 214], [12, 12, 16]];
        const count = Math.round(7 + 10 * D.mood.energy);
        const types = ['circle', 'ring', 'line', 'tri', 'semi', 'grid', 'line', 'circle', 'checker'];
        for (let i = 0; i < count; i++) shapes.push({
          type: types[Math.floor(r() * types.length)], x: Math.round(r() * 12) / 12 * WIN.w, y: Math.round(r() * 16) / 16 * WIN.h,
          s: 30 + r() * 170, col: cols[Math.floor(r() * cols.length)], rot: r() * Math.PI * 2, spin: (r() - 0.5) * 0.4,
          off: r() < 0.5 ? 0 : 0.5, len: 400 + r() * 900,
        });
      } else if (D.technique === 'cutout') {
        const bgH = rgb2hsl(P.windowBg)[0];
        const cols = [...triad.filter((c) => Math.abs(((rgb2hsl(c)[0] - bgH + 540) % 360) - 180) > 40), [250, 246, 238], [30, 30, 40], ...P.colors.filter((c) => rgb2hsl(c)[1] > 0.4)];
        const count = Math.round(5 + 6 * D.mood.energy);
        for (let i = 0; i < count; i++) {
          const edge = r() < 0.75;
          shapes.push({
            type: r() < 0.6 ? 'leaf' : 'dot', lobes: 3 + Math.floor(r() * 5),
            x: edge ? (r() < 0.5 ? r() * 0.25 : 0.75 + r() * 0.25) * WIN.w : r() * WIN.w, y: r() * WIN.h,
            s: 50 + r() * 130, col: cols[Math.floor(r() * cols.length)] || [250, 246, 238], rot: r() * Math.PI * 2,
            ph: r() * Math.PI * 2, depth: 0.2 + r() * 0.35,
          });
        }
      }
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
      staticLayer = buildStatic();
      grainTile = buildGrain();
      layers = images.map((img, i) => (D.technique === 'brush' ? buildBrush(img, i) : D.technique === 'geometry' ? buildGeometry(img)
        : D.technique === 'cutout' ? buildCutout(img) : buildMa(img)));
      if (!layers.length) layers = [null];
      buildShapes();
      buildParticles();
    }

    // ------------------------------------------------------------ shots ---
    function drawShot(g, k, t, sp, alpha) {
      const L = layers[k % layers.length], img = images[k % images.length];
      if (!L) return;
      const w = WIN.w, h = WIN.h;
      g.save();
      g.globalAlpha = alpha;
      if (D.technique === 'brush') {
        const z = 1 + M.zoom * sp, A = L.variants[0], B = L.variants[1];
        g.translate(w / 2, h / 2); g.scale(z, z); g.translate(-w / 2, -h / 2);
        g.drawImage(A, 0, 0);
        g.globalAlpha = alpha * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 / (M.beat * 8)));
        g.drawImage(B, 0, 0);
      } else if (D.technique === 'geometry') {
        const lay = k % 3, src = L.duo;
        const z = 1 + M.zoom * sp;
        g.save();
        g.beginPath();
        if (lay === 0) g.rect(w * 0.06, h * 0.07, w * 0.64, h * 0.6);
        else if (lay === 1) g.arc(w * 0.56, h * 0.42, w * 0.38, 0, Math.PI * 2);
        else { g.moveTo(0, h * 0.22); g.lineTo(w, h * 0.04); g.lineTo(w, h * 0.6); g.lineTo(0, h * 0.8); g.closePath(); }
        g.clip();
        const rr = coverRect(src.width, src.height, w, h, z);
        g.drawImage(src, rr.x, rr.y, rr.w, rr.h);
        g.restore();
      } else if (D.technique === 'cutout') {
        const r = TD.system.rng(D.seed + k * 31);
        const cx = w * (0.42 + r() * 0.16), cy = h * (0.38 + r() * 0.08);
        const R = w * (0.42 - 0.12 * D.air);
        const pop = 1 - 0.18 * Math.exp(-sp * M.beatsPerShot * 3);
        const pts = Array.from({ length: 11 }, (_, i) => {
          const a = i / 11 * Math.PI * 2, rad = R * (1 + (r() - 0.5) * 0.32 + 0.03 * Math.sin(t * 2 + i)) * pop;
          return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * 1.15];
        });
        g.save(); g.translate(10, 14); smoothBlob(g, pts); g.fillStyle = 'rgba(0,0,0,0.16)'; g.fill(); g.restore();
        g.save(); smoothBlob(g, pts); g.clip();
        const src = L.photo, rr = coverRect(src.width, src.height, w, h, 1 + M.zoom * sp);
        g.drawImage(src, rr.x + (cx - w / 2) * 0.3, rr.y, rr.w, rr.h);
        g.restore();
      } else {
        const src = L.photo, ar = clamp((img.naturalWidth || 4) / (img.naturalHeight || 5), 0.6, 1.5);
        const pw = w * clamp(1 - D.air, 0.32, 0.7), ph = Math.min(pw / ar, h * 0.58);
        const left = k % 2 === 0;
        const x = (left ? w * 0.1 : w * 0.9 - pw) + 10 * Math.sin(t / 9), y = h * 0.14 + 6 * Math.sin(t / 11);
        g.save(); g.beginPath(); g.rect(x, y, pw, ph); g.clip();
        const rr = coverRect(src.width, src.height, pw, ph, 1 + M.zoom * 0.5 * sp);
        g.drawImage(src, x + rr.x, y + rr.y, rr.w, rr.h);
        g.restore();
      }
      g.restore();
    }

    function drawShapes(g, t, sp) {
      const w = WIN.w, h = WIN.h;
      if (D.technique === 'geometry') {
        shapes.forEach((s, i) => {
          const pulse = 1 + M.pulse * 2.2 * Math.exp(-(((t - M.beatOffset) / M.beat + s.off) % 1) * 5);
          g.save(); g.translate(s.x, s.y); g.rotate(s.rot + t * s.spin * D.mood.energy); g.scale(pulse, pulse);
          g.fillStyle = rgba(s.col, 0.92); g.strokeStyle = rgba(s.col, 0.95);
          if (s.type === 'circle') { g.beginPath(); g.arc(0, 0, s.s * 0.5, 0, Math.PI * 2); g.fill(); }
          else if (s.type === 'ring') { g.lineWidth = 6 + s.s * 0.05; g.beginPath(); g.arc(0, 0, s.s * 0.55, 0, Math.PI * 2); g.stroke(); }
          else if (s.type === 'line') { g.lineWidth = 4 + s.s * 0.04; const l = s.len * ease(sp * 2.5 + i * 0.05); g.beginPath(); g.moveTo(-l / 2, 0); g.lineTo(l / 2, 0); g.stroke(); }
          else if (s.type === 'tri') { g.beginPath(); g.moveTo(0, -s.s * 0.6); g.lineTo(s.s * 0.55, s.s * 0.4); g.lineTo(-s.s * 0.55, s.s * 0.4); g.closePath(); g.fill(); }
          else if (s.type === 'semi') { g.beginPath(); g.arc(0, 0, s.s * 0.5, 0, Math.PI); g.closePath(); g.fill(); }
          else if (s.type === 'grid') { for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) { g.beginPath(); g.arc(a * 18 - 27, b * 18 - 27, 4, 0, Math.PI * 2); g.fill(); } }
          else { for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if ((a + b) % 2 === 0) g.fillRect(a * 22 - 33, b * 22 - 33, 22, 22); }
          g.restore();
        });
      } else if (D.technique === 'cutout') {
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
      } else if (D.technique === 'ma') {
        const y = h * 0.78;
        g.strokeStyle = rgba(P.ink, 0.7); g.lineWidth = 2;
        const l = w * 0.84 * ease(t / (M.shotDur * 0.8));
        g.beginPath(); g.moveTo(w * 0.08, y); g.lineTo(w * 0.08 + l, y); g.stroke();
        const red = rgb2hsl(P.accent)[1] > 0.45 && Math.abs(((rgb2hsl(P.accent)[0] + 180) % 360) - 180) < 40 ? P.accent : [190, 58, 42];
        g.fillStyle = rgba(red, 0.9);
        g.fillRect(w * 0.84, y - 70, 44, 44);
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(w * 0.84 + 12, y - 58); g.lineTo(w * 0.84 + 32, y - 38); g.stroke();
      }
    }

    function drawParticles(g, t) {
      const w = WIN.w, h = WIN.h, kind = TX.particles;
      if (!kind) return;
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

    function drawCaption(g, t, final) {
      const text = (day.caption || '').trim();
      if (!text) return;
      const ty = D.typo, w = WIN.w, h = WIN.h;
      const capStart = Math.min(M.shotDur * 0.5, 2.2);
      g.save();
      g.font = `${ty.italic ? 'italic ' : ''}${ty.weight} ${ty.size}px "${ty.font}"`;
      const str = ty.upper ? text.toUpperCase() : text;
      const maxW = D.technique === 'ma' ? w * 0.8 : w * 0.78;
      const lines = wrap(g, str, maxW).slice(0, D.technique === 'ma' ? 3 : 4);
      const lh = ty.size * (D.technique === 'brush' ? 1.0 : 1.18);
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
          g.fillStyle = rgba([240, 234, 220], 1); g.fillText(l, 58, y0 + i * (lh + 6) + ty.size * 0.98);
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
              g.fillStyle = rgba(P.ink, 1); g.textAlign = 'center'; g.fillText(word, 0, ty.size * 0.35); g.restore();
            }
            xx += g.measureText(word + ' ').width;
          });
        });
      } else {
        const y0 = h * 0.78 + 70;
        lines.forEach((l, i) => {
          const a = clamp((tt - i * M.beat * 4) / (M.beat * 3), 0, 1);
          g.fillStyle = rgba(P.ink, 0.88 * a); g.fillText(l, w * 0.08, y0 + i * lh);
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
      const shot = Math.floor(t / M.shotDur), within = t - shot * M.shotDur, sp = within / M.shotDur;
      if (M.fade > 0 && shot > 0 && within < M.fade) {
        drawShot(ctx, shot - 1, t, 1, 1);
        drawShot(ctx, shot, t, sp, ease(within / M.fade));
      } else drawShot(ctx, shot, t, sp, 1);
      drawShapes(ctx, t, sp);
      drawParticles(ctx, t);
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
      if (M.fade === 0 && shot > 0 && within < 0.09) { ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - within / 0.09)})`; ctx.fillRect(0, 0, w, h); }
      drawCaption(ctx, t, o.final);
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
      if (st.audio && !isNaN(st.audio.currentTime) && st.audio.currentTime > 0) return st.audio.currentTime;
      return st.clock + (st.playing ? (performance.now() - st.t0) / 1000 : 0);
    }
    function loop() {
      draw(now());
      if (st.onTick) st.onTick(now());
      st.raf = requestAnimationFrame(loop);
    }

    return {
      prepare, draw,
      start(audio) {
        st.audio = audio || null;
        st.duration = audio && isFinite(audio.duration) ? audio.duration : null;
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

  TD.render = { createPlayer, fontsReady, WIN, W, H };
})(globalThis.TD = globalThis.TD || {});
