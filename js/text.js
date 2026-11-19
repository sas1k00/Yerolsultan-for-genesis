/* Тот день — rule-based reading of the diary entry (no AI).
 * analyzeText(text, isoDate) → mood, entities and a caption line.
 */
(function (TD) {
  'use strict';
  const L = TD.LEX;

  const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function matches(token, pattern) {
    const p = norm(pattern);
    return p[0] === '=' ? token === p.slice(1) : token.startsWith(p);
  }
  function findIn(token, patterns) {
    for (const p of patterns) if (matches(token, p)) return p;
    return null;
  }

  // Longest matching stem wins ("закричал" before "кричал").
  const MOOD = L.MOOD.map(([s, v, a]) => ({ s: norm(s), v, a, len: s.replace('=', '').length }))
    .sort((x, y) => y.len - x.len);

  function tokenize(text) {
    let t = norm(text);
    // Phrases rewritten into marker tokens before splitting.
    t = t.replace(/до\s+(\S+\s+)?утра/g, ' __night ')
      .replace(/перв\S*\s+снег/g, ' __first_snow первый снег ')
      .replace(/(день|дня|дне|днем)\s+рождени\S*|днюх\S*|birthday/g, ' __birthday ');
    return t.split(/[^a-zа-я0-9_'’]+/i).filter(Boolean);
  }

  function hourBucket(h) {
    if (h < 5 || h >= 23) return 'night';
    if (h < 11) return 'morning';
    if (h < 17) return 'day';
    return 'evening';
  }

  function seasonOfMonth(m) {
    return [ 'winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter' ][m];
  }

  function splitSentences(text) {
    return text.replace(/\s+/g, ' ').split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
  }

  function analyzeText(text, isoDate) {
    text = String(text || '');
    const tokens = tokenize(text);
    const res = {
      words: tokens.length, valence: 0, arousal: 0.35, warmth: 0, sensory: 0,
      hits: [], time: null, timeScores: {}, season: null, seasonFrom: 'date', weather: [],
      places: [], people: [], alone: false, company: false, details: [], events: [], caption: '',
    };

    // ---- mood -----------------------------------------------------------
    let sv = 0, sa = 0, n = 0;
    tokens.forEach((tok, i) => {
      const e = MOOD.find((m) => matches(tok, m.s));
      if (!e) return;
      const prev = tokens.slice(Math.max(0, i - 2), i);
      let mod = 1, note = '';
      if (prev.some((p) => L.NEGATORS.includes(p))) { mod = -0.6; note = 'отрицание'; }
      if (prev.some((p) => L.INTENSIFIERS.includes(p))) { mod *= 1.4; note = note || 'усиление'; }
      if (prev.some((p) => L.SOFTENERS.includes(p))) { mod *= 0.6; note = note || 'смягчение'; }
      sv += e.v * mod;
      sa += e.a * (mod < 0 ? 0.8 : Math.min(Math.abs(mod), 1.3));
      n += 1;
      res.hits.push({ word: tok, v: +(e.v * mod).toFixed(2), a: e.a, note });
    });
    res.valence = clamp(sv / (n + 1.5), -1, 1);
    let arousal = (sa + 0.35 * 1.5) / (n + 1.5);
    const excl = (text.match(/!/g) || []).length;
    arousal += Math.min(0.2, excl * 0.06);
    const sentences = splitSentences(text);
    const avgLen = tokens.length / Math.max(1, sentences.length);
    if (avgLen < 8 && sentences.length > 2) arousal += 0.05;
    if (/\.\.\.|…/.test(text)) arousal -= 0.05;
    res.arousal = clamp(arousal, 0, 1);
    res.exclamations = excl;

    // ---- warmth & senses -----------------------------------------------
    let sw = 0, nw = 0, ns = 0;
    tokens.forEach((tok) => {
      const w = L.WARMTH.find(([s]) => matches(tok, s));
      if (w) { sw += w[1]; nw += 1; }
      if (findIn(tok, L.SENSES)) ns += 1;
    });
    res.warmth = clamp(sw / (nw + 1), -1, 1);
    res.sensory = clamp(ns / 6, 0, 1);
    res.sensoryCount = ns;

    // ---- time of day ----------------------------------------------------
    const ts = { morning: 0, day: 0, evening: 0, night: 0 };
    tokens.forEach((tok) => {
      if (tok === '__night') { ts.night += 2; return; }
      for (const k in L.TIME) if (findIn(tok, L.TIME[k].m)) { ts[k] += 1; break; }
    });
    (text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g) || []).forEach((hm) => {
      ts[hourBucket(parseInt(hm, 10))] += 1.5;
    });
    res.timeScores = ts;
    const ranked = Object.entries(ts).sort((a, b) => b[1] - a[1]);
    if (ranked[0][1] > 0) {
      // Several parts of the day with similar weight → "the whole day".
      res.time = ranked[1][1] > 0 && ranked[0][1] < 2 * ranked[1][1] ? 'day' : ranked[0][0];
      res.timeWholeDay = res.time === 'day' && ranked[0][0] !== 'day';
    }

    // ---- season -------------------------------------------------------
    const ss = { autumn: 0, winter: 0, spring: 0, summer: 0 };
    tokens.forEach((tok) => { for (const k in L.SEASON) if (findIn(tok, L.SEASON[k].m)) ss[k] += 1; });
    const d = isoDate ? new Date(isoDate + 'T12:00:00') : null;
    const dateSeason = d && !isNaN(d) ? seasonOfMonth(d.getMonth()) : null;
    if (dateSeason) ss[dateSeason] += 0.9;
    const topSeason = Object.entries(ss).sort((a, b) => b[1] - a[1])[0];
    if (topSeason[1] > 0) {
      res.season = topSeason[0];
      res.seasonFrom = topSeason[1] >= 1 && (topSeason[0] !== dateSeason || topSeason[1] > 1.5) ? 'text' : 'date';
    }

    // ---- weather ------------------------------------------------------
    for (const k in L.WEATHER) if (tokens.some((tok) => findIn(tok, L.WEATHER[k].m))) res.weather.push(k);

    // ---- entities in order of first mention ---------------------------
    const firstIndex = (patterns) => tokens.findIndex((tok) => findIn(tok, patterns));
    const collect = (list) => list.map((e) => ({ e, i: firstIndex(e.m) })).filter((x) => x.i >= 0)
      .sort((a, b) => a.i - b.i).map((x) => x.e);
    res.places = collect(L.PLACES);
    res.details = collect(L.DETAILS);
    res.events = collect(L.EVENTS);
    res.people = collect(L.PEOPLE).map((p) => {
      const tok = tokens.find((t) => findIn(t, p.m));
      const altKey = p.alt && Object.keys(p.alt).find((k) => matches(tok, k));
      return { with: altKey ? p.alt[altKey] : p.with };
    });
    // "с Айгерим": a capitalised name after "с/со" is kept verbatim.
    const named = text.match(/(?:^|[\s,])(с|со)\s+([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)?)/);
    if (named) res.people.unshift({ with: named[1] + ' ' + named[2], name: true });
    res.alone = tokens.some((tok) => findIn(tok, L.ALONE));
    res.company = res.people.length > 0 || tokens.includes('мы') || tokens.includes('вместе') || tokens.includes('we');

    // ---- caption: the most vivid sentence -----------------------------
    let best = '', bestScore = -1;
    sentences.forEach((s, idx) => {
      const tk = tokenize(s);
      let score = 0;
      tk.forEach((tok) => {
        const e = MOOD.find((m) => matches(tok, m.s));
        if (e) score += Math.abs(e.v) * 0.6 + 0.2;
        if (findIn(tok, L.SENSES)) score += 0.7;
        if (L.DETAILS.some((dd) => findIn(tok, dd.m))) score += 0.5;
      });
      if (s.length > 25 && s.length < 140) score += 0.6;
      score -= idx * 0.05;
      if (score > bestScore) { bestScore = score; best = s; }
    });
    res.caption = trimCaption(best || text);
    return res;
  }

  function trimCaption(s, max = 110) {
    s = s.trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const at = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(' — '));
    return (at > 50 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(' '))).replace(/[,\s—-]+$/, '') + '…';
  }

  TD.analyzeText = analyzeText;
  TD.textUtil = { tokenize, splitSentences, norm };
})(globalThis.TD = globalThis.TD || {});
