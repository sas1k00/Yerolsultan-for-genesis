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

  TD.photo = { analyzePhotos, photoStats, palette, samplePixels };
})(globalThis.TD = globalThis.TD || {});
