/* Тот день — music reading.
 * 1) Audio file → signal analysis in the browser: tempo, beat phase,
 *    major/minor (Krumhansl key profiles), loudness, brightness.
 * 2) Link only → the user's short description (genre, year, tempo, mood)
 *    or tapped tempo.
 * analyzeSamples() is pure and runs in Node for tests.
 */
(function (TD) {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------------------------------------------------------------- FFT ---
  const fftCache = {};
  function fftTables(n) {
    if (fftCache[n]) return fftCache[n];
    const rev = new Uint32Array(n), bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / n); sin[i] = Math.sin(-2 * Math.PI * i / n); }
    const hann = new Float64Array(n);
    for (let i = 0; i < n; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    return (fftCache[n] = { rev, cos, sin, hann });
  }
  /** Magnitude spectrum (first n/2 bins) of a Hann-windowed frame. */
  function magSpectrum(x, start, n, out) {
    const { rev, cos, sin, hann } = fftTables(n);
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[rev[i]] = (x[start + i] || 0) * hann[i];
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < half; j++) {
          const k = j * step, a = i + j, b = a + half;
          const tr = re[b] * cos[k] - im[b] * sin[k], ti = re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i]);
    return out;
  }

  // Krumhansl–Kessler key profiles.
  const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function corr(a, b) {
    const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return num / Math.sqrt(da * db || 1);
  }

  /** @param x mono samples  @param sr sample rate */
  function analyzeSamples(x, sr) {
    const duration = x.length / sr;
    // Downsample to ~11 kHz (box filter + decimation).
    const f = Math.max(1, Math.round(sr / 11025));
    const sr2 = sr / f;
    // Long songs: analyse 60 s from 25 % in, where the song is usually "in".
    let s0 = 0, s1 = x.length;
    if (duration > 75) { s0 = Math.floor(x.length * 0.25); s1 = Math.min(x.length, s0 + 60 * sr); }
    const n2 = Math.floor((s1 - s0) / f);
    const y = new Float32Array(n2);
    for (let i = 0; i < n2; i++) {
      let s = 0;
      for (let k = 0; k < f; k++) s += x[s0 + i * f + k] || 0;
      y[i] = s / f;
    }

    // Loudness and dynamics.
    const fr = 2048, rmsDb = [];
    for (let i = 0; i + fr <= n2; i += fr) {
      let s = 0;
      for (let k = 0; k < fr; k++) s += y[i + k] * y[i + k];
      rmsDb.push(10 * Math.log10(s / fr + 1e-10));
    }
    const loudDb = rmsDb.length ? rmsDb.reduce((a, b) => a + b, 0) / rmsDb.length : -60;
    const sdDb = Math.sqrt(rmsDb.reduce((a, b) => a + (b - loudDb) ** 2, 0) / Math.max(1, rmsDb.length));

    // Onset envelope: spectral flux on log magnitudes.
    const N = 1024, hop = 256, bins = N / 2;
    const fps = sr2 / hop;
    let prev = new Float64Array(bins), cur = new Float64Array(bins);
    const env = [];
    for (let i = 0; i + N <= n2; i += hop) {
      magSpectrum(y, i, N, cur);
      let flux = 0;
      for (let b = 1; b < bins; b++) {
        const v = Math.log1p(10 * cur[b]);
        const d = v - prev[b];
        if (d > 0) flux += d;
        prev[b] = v;
      }
      env.push(flux);
    }
    // Remove the slow trend, keep positive peaks.
    const w = Math.round(fps * 0.4), on = new Float64Array(env.length);
    let acc = 0;
    for (let i = 0; i < env.length; i++) {
      acc += env[i] - (i - 2 * w - 1 >= 0 ? env[i - 2 * w - 1] : 0);
      const lo = Math.max(0, i - 2 * w), mean = acc / (i - lo + 1);
      on[Math.max(0, i - w)] = Math.max(0, env[Math.max(0, i - w)] - mean);
    }

    // Tempo: autocorrelation of the onset envelope, gentle prior near 110 BPM.
    const minLag = Math.floor(fps * 60 / 200), maxLag = Math.ceil(fps * 60 / 50);
    const ac = new Float64Array(maxLag + 2);
    for (let L = minLag - 1; L <= maxLag + 1; L++) {
      let s = 0;
      for (let i = 0; i + L < on.length; i++) s += on[i] * on[i + L];
      ac[L] = s / (on.length - L || 1);
    }
    let best = minLag, bestScore = -1;
    for (let L = minLag; L <= maxLag; L++) {
      const bpm = 60 * fps / L;
      const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);
      const sc = ac[L] * prior;
      if (sc > bestScore) { bestScore = sc; best = L; }
    }
    // Parabolic refinement of the peak lag.
    const a0 = ac[best - 1], a1 = ac[best], a2 = ac[best + 1];
    const denom = a0 - 2 * a1 + a2;
    const lag = best + (denom ? 0.5 * (a0 - a2) / denom : 0);
    let bpm = 60 * fps / lag;
    // Half-tempo guard: a slow pick whose double tempo is also strongly
    // periodic (kick on every beat, snare on 2 and 4) is really the fast one.
    if (bpm < 92) {
      const h = Math.round(lag / 2);
      const half = Math.max(ac[h - 1] || 0, ac[h] || 0, ac[h + 1] || 0);
      if (half > 0.55 * ac[best]) bpm *= 2;
    }
    if (!isFinite(bpm) || on.length < 4 * maxLag) bpm = null;

    // Beat phase: the offset whose beat grid collects the most onset energy.
    let beatOffset = 0;
    if (bpm) {
      const P = lag; let bestP = -1;
      for (let ph = 0; ph < P; ph += 1) {
        let s = 0;
        for (let k = ph; k < on.length; k += P) s += on[Math.round(k)] || 0;
        if (s > bestP) { bestP = s; beatOffset = ph / fps; }
      }
      beatOffset = (beatOffset + s0 / sr) % (60 / bpm);
    }

    // Chroma, key, mode, brightness.
    const NC = 4096, chroma = new Float64Array(12), spec = new Float64Array(NC / 2);
    let centroidSum = 0, centroidN = 0;
    const binHz = sr2 / NC;
    for (let i = 0; i + NC <= n2; i += NC / 2) {
      magSpectrum(y, i, NC, spec);
      let num = 0, den = 0;
      for (let b = 1; b < NC / 2; b++) {
        const hz = b * binHz, m = spec[b];
        num += hz * m; den += m;
        if (hz >= 55 && hz <= 2000) {
          const pc = ((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12;
          chroma[pc] += m;
        }
      }
      if (den > 0) { centroidSum += num / den; centroidN += 1; }
    }
    let bestMaj = { r: -2, k: 0 }, bestMin = { r: -2, k: 0 };
    const ch = Array.from(chroma);
    for (let k = 0; k < 12; k++) {
      const rot = ch.slice(k).concat(ch.slice(0, k));
      const rM = corr(rot, MAJ), rm = corr(rot, MIN);
      if (rM > bestMaj.r) bestMaj = { r: rM, k };
      if (rm > bestMin.r) bestMin = { r: rm, k };
    }
    const mode = bestMaj.r >= bestMin.r ? 'major' : 'minor';
    const top = mode === 'major' ? bestMaj : bestMin;
    const modeConfidence = clamp(Math.abs(bestMaj.r - bestMin.r) * 5 + 0.25, 0, 1);
    const centroid = centroidN ? centroidSum / centroidN : 1000;

    const loud = clamp((loudDb + 32) / 24, 0, 1);
    const tempoNorm = bpm ? clamp((bpm - 60) / 100, 0, 1) : 0.4;
    const brightness = clamp(centroid / 2200, 0, 1);
    const percussive = clamp(sdDb / 8, 0, 1);
    const energy = clamp(0.55 * tempoNorm + 0.25 * loud + 0.2 * percussive, 0, 1);
    const valence = clamp((mode === 'major' ? 1 : -1) * 0.5 * modeConfidence + 0.3 * (brightness - 0.4) + 0.2 * (tempoNorm - 0.4), -1, 1);
    return {
      source: 'audio', duration, bpm: bpm && +bpm.toFixed(1), beatOffset: +beatOffset.toFixed(3),
      mode, modeConfidence: +modeConfidence.toFixed(2), key: NOTE[top.k] + (mode === 'minor' ? 'm' : ''),
      loudDb: +loudDb.toFixed(1), loud: +loud.toFixed(2), brightness: +brightness.toFixed(2),
      percussive: +percussive.toFixed(2), energy: +energy.toFixed(2), valence: +valence.toFixed(2),
    };
  }

  // ------------------------------------------------- the song's moment ---
  /* Which 30 seconds of the song belong to this day?
   * Not the intro: the part a person would recognise (it repeats, like a
   * chorus), whose loudness suits the day's energy, starting where a new part
   * of the song begins, exactly on a beat. Every number is kept for the
   * "why" panel. Pure, runs in Node for tests. */
  function findMoment(x, sr, opts = {}) {
    const length = opts.length || 30;
    const duration = x.length / sr;
    const target = 0.3 + 0.6 * clamp(opts.targetEnergy == null ? 0.5 : opts.targetEnergy, 0, 1);
    if (duration <= length + 4) {
      return { start: 0, end: Math.min(duration, length), length: Math.min(duration, length), duration, short: true, target: +target.toFixed(2) };
    }
    // ~11 kHz mono
    const f = Math.max(1, Math.round(sr / 11025)), sr2 = sr / f, n2 = Math.floor(x.length / f);
    const y = new Float32Array(n2);
    for (let i = 0; i < n2; i++) { let a = 0; for (let k = 0; k < f; k++) a += x[i * f + k] || 0; y[i] = a / f; }

    // 1) Half-second blocks: loudness and harmony (chroma).
    const B = 0.5, hop = Math.round(sr2 * B), NC = 4096, nb = Math.floor((n2 - NC) / hop) + 1;
    const spec = new Float64Array(NC / 2), binHz = sr2 / NC;
    const db = new Float64Array(nb), cent = new Float64Array(nb), chroma = [];
    for (let b = 0; b < nb; b++) {
      const i0 = b * hop;
      let e = 0;
      for (let k = 0; k < hop && i0 + k < n2; k++) e += y[i0 + k] * y[i0 + k];
      db[b] = 10 * Math.log10(e / hop + 1e-10);
      magSpectrum(y, i0, NC, spec);
      const c = new Float64Array(12);
      let num = 0, den = 0;
      for (let k = 1; k < NC / 2; k++) {
        const hz = k * binHz;
        num += hz * spec[k]; den += spec[k];
        if (hz < 55 || hz > 2000) continue;
        c[((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12] += spec[k];
      }
      chroma.push(c);
      cent[b] = den ? num / den : 0;
    }
    // Loudness on the song's own scale: its quiet 10 % → 0, loud 95 % → 1.
    const sorted = Array.from(db).sort((p, q) => p - q);
    const lo = sorted[Math.floor(nb * 0.1)], hi = sorted[Math.min(nb - 1, Math.floor(nb * 0.95))];
    const en = Array.from(db, (v) => clamp((v - lo) / Math.max(1e-6, hi - lo), 0, 1));
    // Harmony relative to the song's average, so "same key everywhere" does not look like repetition.
    const mean = new Float64Array(12);
    chroma.forEach((c) => { const t = c.reduce((p, q) => p + q, 0) || 1; for (let k = 0; k < 12; k++) mean[k] += c[k] / t / nb; });
    const unit = chroma.map((c) => {
      const t = c.reduce((p, q) => p + q, 0) || 1, v = new Float64Array(12);
      let nn = 0;
      for (let k = 0; k < 12; k++) { v[k] = c[k] / t - mean[k]; nn += v[k] * v[k]; }
      nn = Math.sqrt(nn) || 1;
      for (let k = 0; k < 12; k++) v[k] /= nn;
      return v;
    });
    // 2) Self-similarity: how much block i sounds like block j.
    const S = Array.from({ length: nb }, () => new Float64Array(nb));
    for (let i = 0; i < nb; i++) for (let j = i; j < nb; j++) {
      let c = 0;
      for (let k = 0; k < 12; k++) c += unit[i][k] * unit[j][k];
      S[i][j] = S[j][i] = 0.75 * (c + 1) / 2 + 0.25 * (1 - Math.abs(en[i] - en[j]));
    }
    // 3) Boundaries between parts of the song: how different the 8 s after a
    //    point sound from the 8 s before it (loudness, brightness, harmony).
    //    8 s spans a whole chord cycle, so chord changes inside a verse average
    //    out and only a new part of the song stands out.
    const cs = Array.from(cent).sort((p, q) => p - q);
    const c0 = cs[Math.floor(nb * 0.1)], c1 = cs[Math.min(nb - 1, Math.floor(nb * 0.95))];
    const feat = unit.map((u, b) => [2 * en[b], clamp((cent[b] - c0) / Math.max(1e-6, c1 - c0), 0, 1), ...Array.from(u, (v) => 0.5 * v)]);
    const K = 16, nov = new Float64Array(nb), D = feat[0].length;
    for (let i = K; i <= nb - K; i++) {
      let d2 = 0;
      for (let k = 0; k < D; k++) {
        let a = 0, b = 0;
        for (let u = 1; u <= K; u++) { a += feat[i - u][k]; b += feat[i + u - 1][k]; }
        d2 += ((b - a) / K) ** 2;
      }
      nov[i] = Math.sqrt(d2);
    }
    const novMax = Math.max(...nov) || 1;
    // Starts are allowed only where a new part begins: clear local peaks of novelty.
    const isPeak = (i) => nov[i] >= 0.25 * novMax && nov.slice(Math.max(0, i - 4), i + 5).every((v) => v <= nov[i]);
    // 4) Repetition of the window's first 16 s (what the viewer hears first):
    //    best + half of second-best match elsewhere in the song.
    const L = Math.round(length / B), Lc = Math.min(L, Math.round(16 / B)), last = nb - L;
    const rep = new Float64Array(last + 1), repLag = [];
    for (let i = 0; i <= last; i++) {
      const scores = [];
      for (let j = 0; j + Lc <= nb; j++) {
        if (Math.abs(j - i) < Lc) continue;
        let a = 0;
        for (let k = 0; k < Lc; k++) a += S[i + k][j + k];
        scores.push([a / Lc, j]);
      }
      scores.sort((p, q) => q[0] - p[0]);
      const best = scores[0] || [0, -1];
      const second = scores.find((sc) => Math.abs(sc[1] - best[1]) >= Lc) || [0, -1];
      rep[i] = best[0] + 0.5 * second[0];
      repLag.push(scores.filter((sc, idx) => sc[0] >= 0.85 * best[0] && scores.slice(0, idx).every((o) => Math.abs(o[1] - sc[1]) >= Lc)).length);
    }
    const rMin = Math.min(...rep), rMax = Math.max(...rep);
    // 5) Score every possible start.
    let bestI = 0, bestScore = -1, parts = null;
    const starts = [];
    for (let i = 0; i <= last; i++) if (isPeak(i)) starts.push(i);
    if (!starts.length) for (let i = 0; i <= last; i++) starts.push(i); // a song with no clear parts
    for (const i of starts) {
      let e = 0, silent = 0;
      for (let k = 0; k < L; k++) { e += en[i + k]; if (en[i + k] < 0.12) silent += 1; }
      e /= L;
      const r = (rep[i] - rMin) / Math.max(1e-6, rMax - rMin);
      const fit = 1 - Math.abs(e - target);
      const bound = nov[i] / novMax;
      const sc = 0.4 * r + 0.3 * fit + 0.2 * bound + 0.1 * (1 - silent / L);
      if (sc > bestScore) { bestScore = sc; bestI = i; parts = { repeat: r, fit, boundary: bound, energy: e, repeats: repLag[i] + 1 }; }
    }
    // 6) Snap the start onto the song's own beat grid around that point.
    let start = bestI * B, onBeat = false;
    const bpm = opts.bpm;
    if (bpm) {
      const N = 1024, h = 256, fps = sr2 / h, beat = 60 / bpm;
      const a0 = Math.max(0, Math.floor((start - 1) * sr2)), a1 = Math.min(n2 - N, Math.floor((start + 8) * sr2));
      const prev = new Float64Array(N / 2), cur = new Float64Array(N / 2);
      const on = [];
      // Flux per bin, low band (kick, bass ≤ 200 Hz) weighted over the rest:
      // beats, not the hi-hats between them.
      const lowBins = Math.max(2, Math.ceil(200 / (sr2 / N)));
      for (let i = a0; i <= a1; i += h) {
        magSpectrum(y, i, N, cur);
        let low = 0, all = 0;
        for (let k = 1; k < N / 2; k++) {
          const v = Math.log1p(10 * cur[k]), d = v > prev[k] ? v - prev[k] : 0;
          if (k <= lowBins) low += d; else all += d;
          prev[k] = v;
        }
        on.push(i === a0 ? 0 : low / lowBins + 0.3 * all / (N / 2 - lowBins));
      }
      const P = beat * fps;
      let bestPh = 0, bestOn = -1;
      for (let ph = 0; ph < P; ph += 1) {
        let a = 0;
        for (let k = ph; k < on.length; k += P) a += on[Math.round(k)] || 0;
        if (a > bestOn) { bestOn = a; bestPh = ph; }
      }
      const t0 = a0 / sr2 + bestPh / fps + N / (2 * sr2); // an onset shows when it reaches the frame's centre
      const kk = Math.round((start - t0) / beat);
      start = Math.max(0, t0 + kk * beat);
      onBeat = true;
    }
    start = Math.min(start, duration - length);
    return {
      start: +start.toFixed(3), end: +(start + length).toFixed(3), length, duration: +duration.toFixed(2), onBeat,
      target: +target.toFixed(2), energy: +parts.energy.toFixed(2), repeat: +parts.repeat.toFixed(2),
      repeats: parts.repeats, boundary: +parts.boundary.toFixed(2), fit: +parts.fit.toFixed(2), score: +bestScore.toFixed(3),
    };
  }

  /** "1:12", "72", "1m12s", "?t=72" → seconds (or null). */
  function parseTime(v) {
    if (v == null || v === '') return null;
    const str = String(v).trim();
    let mm;
    if ((mm = str.match(/^(\d+):(\d{1,2})$/))) return +mm[1] * 60 + +mm[2];
    if ((mm = str.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/)) && (mm[1] || mm[2] || mm[3])) return (+mm[1] || 0) * 3600 + (+mm[2] || 0) * 60 + (+mm[3] || 0);
    return null;
  }

  // ------------------------------------------------------- descriptions ---
  const GENRES = {
    jazz: { label: 'джаз / свинг', e: 0.45, v: 0.35, b: 0.45, bpm: 100 },
    classical: { label: 'классика', e: 0.3, v: 0.1, b: 0.5, bpm: 80 },
    pop: { label: 'поп', e: 0.65, v: 0.45, b: 0.65, bpm: 115 },
    rock: { label: 'рок', e: 0.8, v: 0.1, b: 0.6, bpm: 130 },
    electronic: { label: 'электроника', e: 0.8, v: -0.05, b: 0.6, bpm: 126 },
    hiphop: { label: 'хип-хоп / рэп', e: 0.7, v: 0.0, b: 0.5, bpm: 92 },
    indie: { label: 'инди / фолк', e: 0.4, v: 0.15, b: 0.5, bpm: 100 },
    ambient: { label: 'эмбиент / неоклассика', e: 0.15, v: -0.1, b: 0.35, bpm: 68 },
    lofi: { label: 'лоу-фай', e: 0.25, v: 0.05, b: 0.35, bpm: 82 },
    soundtrack: { label: 'саундтрек', e: 0.45, v: 0.0, b: 0.45, bpm: 95 },
    ethno: { label: 'этно / домбра', e: 0.55, v: 0.2, b: 0.5, bpm: 110 },
    kpop: { label: 'k-pop', e: 0.8, v: 0.5, b: 0.75, bpm: 120 },
    other: { label: 'другое', e: 0.5, v: 0.1, b: 0.5, bpm: 105 },
  };
  const TEMPO_HINT = { slow: 72, medium: 104, fast: 132 };

  function era(year) {
    year = parseInt(year, 10);
    if (!year) return { key: 'unknown', label: 'эпоха не указана', grain: 0.12, fade: 0 };
    if (year < 1970) return { key: 'old', label: `${year}: старая плёнка`, grain: 0.5, fade: 0.35 };
    if (year < 1990) return { key: 'analog', label: `${year}: аналоговая эпоха`, grain: 0.38, fade: 0.22 };
    if (year < 2010) return { key: 'digital', label: `${year}: ранняя цифра`, grain: 0.2, fade: 0.08 };
    return { key: 'now', label: `${year}: современный звук`, grain: 0.08, fade: 0 };
  }

  /** Music features from the user's description (link-only songs). */
  function describeSong(meta) {
    const g = GENRES[meta.genre] || GENRES.other;
    const bpm = meta.tapBpm || TEMPO_HINT[meta.tempoHint] || g.bpm;
    const mode = meta.moodHint === 'major' ? 'major' : meta.moodHint === 'minor' ? 'minor' : (g.v >= 0.1 ? 'major' : 'minor');
    const conf = meta.moodHint === 'major' || meta.moodHint === 'minor' ? 0.8 : 0.4;
    const tempoNorm = clamp((bpm - 60) / 100, 0, 1);
    const energy = clamp(0.5 * tempoNorm + 0.5 * g.e, 0, 1);
    const valence = clamp(0.5 * g.v + (mode === 'major' ? 1 : -1) * 0.4 * conf, -1, 1);
    return {
      source: 'description', bpm, beatOffset: 0, mode, modeConfidence: conf, key: null,
      loud: g.e, brightness: g.b, percussive: g.e, energy: +energy.toFixed(2), valence: +valence.toFixed(2),
    };
  }

  /** Merge audio analysis (if any) with the description; user taps win for tempo. */
  function combineMusic(audio, meta) {
    const d = describeSong(meta);
    const m = audio && audio.bpm ? { ...audio } : { ...d, source: audio ? 'description' : d.source };
    if (meta.tapBpm) { m.bpm = meta.tapBpm; m.bpmFrom = 'tap'; } else m.bpmFrom = m.source;
    m.modeFrom = m.source;
    // The listener knows how the song feels: their "светлая/тёмная" wins over
    // the key detector (which often confuses relative major/minor keys).
    if (audio && audio.bpm && (meta.moodHint === 'major' || meta.moodHint === 'minor')) {
      m.detectedMode = audio.mode;
      m.detectedKey = audio.key;
      if (meta.moodHint !== audio.mode) {
        m.mode = meta.moodHint; m.key = null;
        const tn = clamp((m.bpm - 60) / 100, 0, 1);
        m.valence = +clamp((m.mode === 'major' ? 0.4 : -0.4) + 0.3 * (m.brightness - 0.4) + 0.2 * (tn - 0.4), -1, 1).toFixed(2);
      }
      m.modeConfidence = Math.max(m.modeConfidence, 0.8);
      m.modeFrom = 'user';
    }
    m.genre = meta.genre || null;
    m.genreLabel = (GENRES[meta.genre] || {}).label || null;
    m.era = era(meta.year);
    if (audio && audio.bpm && meta.genre) m.brightness = +(0.7 * audio.brightness + 0.3 * d.brightness).toFixed(2);
    return m;
  }

  // -------------------------------------------------------------- links ---
  function parseLink(url) {
    url = String(url || '').trim();
    if (!url) return null;
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    const h = u.hostname.replace(/^www\.|^m\./, '');
    let m;
    const ytStart = parseTime(u.searchParams.get('t') || u.searchParams.get('start'));
    if (h === 'youtu.be') { const id = u.pathname.slice(1); return { platform: 'YouTube', open: url, embed: `https://www.youtube.com/embed/${id}`, youtube: id, start: ytStart }; }
    if (h.endsWith('youtube.com')) {
      const id = u.searchParams.get('v') || (u.pathname.match(/\/(?:embed|shorts)\/([\w-]+)/) || [])[1];
      return { platform: h.startsWith('music.') ? 'YouTube Music' : 'YouTube', open: url, embed: id ? `https://www.youtube.com/embed/${id}` : null, youtube: id || null, start: ytStart };
    }
    if (h === 'open.spotify.com' && (m = u.pathname.match(/\/(track|album|playlist)\/(\w+)/)))
      return { platform: 'Spotify', open: url, embed: `https://open.spotify.com/embed/${m[1]}/${m[2]}` };
    if (h.startsWith('music.yandex.') && (m = u.pathname.match(/\/album\/(\d+)\/track\/(\d+)/)))
      return { platform: 'Яндекс Музыка', open: url, embed: `https://music.yandex.ru/iframe/album/${m[1]}/track/${m[2]}` };
    if (h === 'music.apple.com') return { platform: 'Apple Music', open: url, embed: url.replace('music.apple.com', 'embed.music.apple.com') };
    if (h === 'soundcloud.com') return { platform: 'SoundCloud', open: url, embed: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}` };
    return { platform: h, open: url, embed: null };
  }

  // ------------------------------------------------------------ browser ---
  async function analyzeFile(blob) {
    const { mono, sr } = await decodeFile(blob);
    return analyzeSamples(mono, sr);
  }
  /** Decode an audio file to mono samples (kept so the moment can be found too). */
  async function decodeFile(blob) {
    const buf = await blob.arrayBuffer();
    const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    const ctx = new Ctx(1, 1, 44100);
    const audio = await new Promise((res, rej) => {
      const p = ctx.decodeAudioData(buf, res, rej);
      if (p && p.then) p.then(res, rej);
    });
    const n = audio.length, ch = audio.numberOfChannels;
    const mono = new Float32Array(n);
    for (let c = 0; c < ch; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[i] / ch;
    }
    return { mono, sr: audio.sampleRate };
  }

  TD.music = { analyzeSamples, analyzeFile, decodeFile, findMoment, parseTime, describeSong, combineMusic, parseLink, era, GENRES, TEMPO_HINT };
})(globalThis.TD = globalThis.TD || {});
