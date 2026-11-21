/* Тот день — colour helpers and photo reading (palette, light, warmth). */
(function (TD) {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ------------------------------------------------------------ colour ---
  function rgb2hsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hsl2rgb([h, s, l]) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  const hex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  /** Move hue toward target by amount t (shortest way round the wheel). */
  function hueToward(h, target, t) {
    let d = ((target - h + 540) % 360) - 180;
    return h + d * t;
  }
  TD.color = { rgb2hsl, hsl2rgb, hex, rgba, mix, lum, hueToward, clamp };

  // ------------------------------------------------------------ photos ---
  /** Draw an image small and read its pixels. */
  function samplePixels(img, max = 96) {
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    const k = max / Math.max(w0, h0);
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h).data, w, h, aspect: w0 / h0 };
  }

  /** Statistics of one photo from RGBA pixel data. */
  function photoStats(data) {
    let n = 0, sl = 0, sl2 = 0, ss = 0, sw = 0;
    for (let i = 0; i < data.length; i += 4) {
      const c = [data[i], data[i + 1], data[i + 2]];
      const l = lum(c), s = rgb2hsl(c)[1];
      sl += l; sl2 += l * l; ss += s * (1 - Math.abs(2 * l - 1)); sw += (c[0] - c[2]) / 255; n++;
    }
    const brightness = sl / n;
    return {
      brightness: +brightness.toFixed(3),
      contrast: +Math.sqrt(Math.max(0, sl2 / n - brightness * brightness)).toFixed(3),
      saturation: +(ss / n).toFixed(3),
      warmth: +clamp((sw / n) * 2.5, -1, 1).toFixed(3),
    };
  }

  /** Deterministic k-means palette over RGBA pixels of all photos. */
  function palette(pixelArrays, k = 6) {
    const pts = [];
    pixelArrays.forEach((data) => {
      for (let i = 0; i < data.length; i += 8) pts.push([data[i], data[i + 1], data[i + 2]]);
    });
    if (!pts.length) return [];
    const sorted = pts.slice().sort((a, b) => lum(a) - lum(b));
    let cents = Array.from({ length: k }, (_, j) => sorted[Math.floor((j + 0.5) / k * sorted.length)].slice());
    const assign = new Int32Array(pts.length);
    for (let it = 0; it < 10; it++) {
      const sum = cents.map(() => [0, 0, 0, 0]);
      pts.forEach((p, i) => {
        let bi = 0, bd = Infinity;
        cents.forEach((c, j) => {
          const d = (p[0] - c[0]) ** 2 * 0.3 + (p[1] - c[1]) ** 2 * 0.59 + (p[2] - c[2]) ** 2 * 0.11;
          if (d < bd) { bd = d; bi = j; }
        });
        assign[i] = bi;
        const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
      });
      cents = cents.map((c, j) => (sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : c));
    }
    const counts = new Array(k).fill(0);
    assign.forEach((j) => counts[j]++);
    return cents.map((c, j) => ({ rgb: c.map(Math.round), share: counts[j] / pts.length }))
      .filter((c) => c.share > 0.01).sort((a, b) => b.share - a.share);
  }

  /** Analyse a list of loaded <img> elements. */
  function analyzePhotos(imgs) {
    const samples = imgs.map((im) => samplePixels(im));
    const stats = samples.map((s) => photoStats(s.data));
    const avg = (key) => stats.reduce((a, s) => a + s[key], 0) / stats.length;
    const pal = palette(samples.map((s) => s.data));
    const res = {
      count: imgs.length,
      brightness: +avg('brightness').toFixed(3), contrast: +avg('contrast').toFixed(3),
      saturation: +avg('saturation').toFixed(3), warmth: +avg('warmth').toFixed(3),
      palette: pal, aspects: samples.map((s) => +s.aspect.toFixed(3)), perPhoto: stats,
    };
    res.valence = +clamp(0.9 * (res.brightness - 0.45) + 0.8 * (res.saturation - 0.25), -1, 1).toFixed(3);
    res.energy = +clamp(0.15 + 1.1 * res.saturation + 1.2 * res.contrast, 0, 1).toFixed(3);
    return res;
  }

  // ------------------------------------------------------ what matters ---
  /* Where the important part of a photo is, so no technique crops it away.
   * Each pixel gets a weight: skin tones (people, faces) count most, then
   * detail (edges) and colours that stand out from the photo's average, with a
   * gentle pull to the centre. The "subject" box holds most of that weight:
   * 90 % when there are people (nobody gets cut off), 80 % otherwise (a plain
   * landscape may still be cropped a little to fill the page).
   * Pure: works on RGBA pixel data, runs in Node for tests. */
  function focusFromPixels(data, w, h) {
    const lumA = new Float32Array(w * h);
    let mr = 0, mg = 0, mb = 0;
    for (let i = 0, p = 0; p < w * h; i += 4, p++) {
      lumA[p] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      mr += data[i]; mg += data[i + 1]; mb += data[i + 2];
    }
    mr /= w * h; mg /= w * h; mb /= w * h;
    const wt = new Float32Array(w * h), skinMask = new Uint8Array(w * h);
    let skinN = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      const L = (xx, yy) => lumA[clamp(yy, 0, h - 1) * w + clamp(xx, 0, w - 1)];
      const edge = Math.min(1, (Math.abs(L(x + 1, y) - L(x - 1, y)) + Math.abs(L(x, y + 1) - L(x, y - 1))) * 2.5);
      const stand = Math.min(1, Math.hypot(r - mr, g - mg, b - mb) / 160);
      // Skin in YCbCr: a classic, lighting-tolerant range.
      const Y = 0.299 * r + 0.587 * g + 0.114 * b, cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      const skin = Y > 50 && cb >= 77 && cb <= 127 && cr >= 137 && cr <= 173 ? 1 : 0;
      skinN += skin; skinMask[p] = skin;
      const dx = (x + 0.5) / w - 0.5, dy = (y + 0.5) / h - 0.5;
      const centre = 0.65 + 0.35 * Math.exp(-(dx * dx + dy * dy) / (2 * 0.3 * 0.3));
      wt[p] = (0.45 * edge + 0.35 * stand + 1.2 * skin + 0.02) * centre;
    }
    // Skin-coloured areas, one by one. Sand or a beige wall is one large solid
    // area across the photo; people are separate or uneven shapes (gaps between
    // bodies, heads narrower than shoulders). Large solid areas are not people.
    const sx = [], sy = [], seen = new Uint8Array(w * h);
    for (let p0 = 0; p0 < w * h; p0++) {
      if (!skinMask[p0] || seen[p0]) continue;
      const stack = [p0], pts = [];
      seen[p0] = 1;
      let bx0 = w, bx1 = 0, by0 = h, by1 = 0;
      while (stack.length) {
        const p = stack.pop(), x = p % w, y = (p - x) / w;
        pts.push(p); bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (q >= 0 && skinMask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
      const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, fill = pts.length / (bw * bh);
      const edge = bx0 === 0 || by0 === 0 || bx1 === w - 1 || by1 === h - 1;
      // Sand, a wall, a table: solid, big, and wide or running into the photo's edge.
      const surface = fill > 0.85 && pts.length > 0.02 * w * h && (bw > 0.5 * w || edge);
      if (surface || pts.length < 2) { pts.forEach((p) => { wt[p] *= 0.25; }); continue; }
      pts.forEach((p) => { const x = p % w; sx.push((x + 0.5) / w); sy.push(((p - x) / w + 0.5) / h); });
    }
    const people = sx.length / (w * h) > 0.004;
    const skinAnywhere = skinN / (w * h) > 0.02;
    const keep = people || skinAnywhere ? 0.9 : 0.8;
    const colSum = new Float64Array(w), rowSum = new Float64Array(h);
    let total = 0, cx = 0, cy = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = wt[y * w + x]; colSum[x] += v; rowSum[y] += v; total += v; cx += v * (x + 0.5); cy += v * (y + 0.5);
    }
    const span = (sums, n) => {
      const lo = (1 - keep) / 2 * total, hi = (1 + keep) / 2 * total;
      let acc = 0, a = 0, b = n;
      for (let i = 0; i < n; i++) { acc += sums[i]; if (acc < lo) a = i + 1; if (acc <= hi) b = i + 1; }
      return [a / n, Math.min(1, Math.max(b, a + 1) / n)];
    };
    let [x0, x1] = span(colSum, w), [y0, y1] = span(rowSum, h);
    let fx = cx / total / w, fy = cy / total / h;
    if (people) {
      // The people define what must stay: where the skin is (faces, arms), a little
      // wider, and further down for the bodies.
      const q = (arr, t) => { const a = arr.slice().sort((m, n) => m - n); return a[Math.min(a.length - 1, Math.floor(t * a.length))]; };
      const ax0 = q(sx, 0.01), ax1 = q(sx, 0.99), ay0 = q(sy, 0.01), ay1 = q(sy, 0.99);
      x0 = clamp(ax0 - 0.06, 0, 1); x1 = clamp(ax1 + 0.06, 0, 1);
      y0 = clamp(ay0 - 0.08, 0, 1); y1 = clamp(ay1 + 0.6 * (ay1 - ay0) + 0.15, 0, 1);
      fx = (x0 + x1) / 2; fy = (y0 + y1) / 2;
    }
    // No clear subject (an even landscape): the page may crop it to fill. Never
    // when there is skin colour in the photo: unsure is safer zoomed out than cut.
    const diffuse = !people && !skinAnywhere && (x1 - x0) * (y1 - y0) > 0.55;
    return { x0: +x0.toFixed(3), x1: +x1.toFixed(3), y0: +y0.toFixed(3), y1: +y1.toFixed(3),
      cx: +fx.toFixed(3), cy: +fy.toFixed(3), people, diffuse };
  }
  /** The subject box of an image (browser). */
  function focusOf(img) {
    const s = samplePixels(img, 64);
    return focusFromPixels(s.data, s.w, s.h);
  }

  TD.photo = { analyzePhotos, photoStats, palette, samplePixels, focusFromPixels, focusOf };
})(globalThis.TD = globalThis.TD || {});
