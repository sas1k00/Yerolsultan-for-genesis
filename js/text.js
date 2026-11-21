/* Тот день — rule-based reading of the diary entry (no AI).
 * analyzeText(text, isoDate) → mood, entities and a caption line.
 */
(function (TD) {
  'use strict';
  const L = TD.LEX;

  const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // Longer look-alike words ("поездка" for "поезд") never match a shorter stem.
  const NOT = (L.NOT || []).map(norm);
  function matches(token, pattern) {
    const p = norm(pattern);
    if (p[0] === '=') return token === p.slice(1);
    if (!token.startsWith(p)) return false;
    return !NOT.some((x) => x.length > p.length && x.startsWith(p) && token.startsWith(x));
  }
  function findIn(token, patterns) {
    for (const p of patterns) if (matches(token, p)) return p;
    return null;
  }

  // Kazakh letters, so "қуаныш" stays one word and capitalised Kazakh names are found.
  const KK = 'әғқңөұүһі', UP = 'А-ЯЁӘҒҚҢӨҰҮҺІ', LOW = 'а-яёәғқңөұүһі';
  // Longest matching stem wins ("закричал" before "кричал").
  const MOOD = [...L.MOOD.map((e) => [...e, false]), ...(L.MOOD_KK || []).map((e) => [...e, true])]
    .map(([s, v, a, kk]) => ({ s: norm(s), v, a, kk, len: s.replace('=', '').length }))
    .sort((x, y) => y.len - x.len);

  function tokenize(text) {
    let t = norm(text);
    // Phrases rewritten into marker tokens before splitting.
    t = t.replace(/до\s+(\S+\s+)?утра/g, ' __night ')
      .replace(/перв\S*\s+снег/g, ' __first_snow первый снег ')
      .replace(/(день|дня|дне|днем)\s+рождени\S*|днюх\S*|birthday|туған\s+күн\S*/g, ' __birthday ')
      .replace(/ата-ана\S*/g, ' __parents ')
      .replace(/наурыз\s*(мейрам|көже|коже|той)\S*|наурызды\s+тойла\S*|(праздн\S*|на)\s+наурыз\S*/g, ' __nauryz ')
      .replace(/күн\s+бат\S*/g, ' закат ')
      // "кричали от восторга" is joy, not a quarrel; "никуда не спешили" is calm, not "not hurried"
      .replace(/(крич|ор|визж|вопи)\S*\s+от\s+(восторг|радост|счасть|удовольств)\S*/g, ' __joyshout ')
      .replace(/(никуда\s+)?не\s+(спеш|тороп)\S*|без\s+спешки/g, ' неспешно ')
      // "давно так не отдыхали", "никогда так не смеялись" = "never this good": an intensifier, not a negation
      .replace(/(давно|никогда)\s+(ещ[её]\s+|уже\s+)?так\s+не\s+/g, ' очень ')
      // multi-word places and activities
      .replace(/воздушн\S*\s+шар\S*/g, ' __balloon ')
      .replace(/(прыж\S*|прыгн\S*|прыгал\S*)\s+с\s+парашют\S*/g, ' __skydive ')
      .replace(/велик\S*\s+(китайск\S*\s+)?стен\S*/g, ' __greatwall ')
      .replace(/рисов\S*\s+террас\S*/g, ' __riceterraces ')
      .replace(/больш\S*\s+алматинск\S*\s+озер\S*/g, ' бао ')
      .replace(/том[\s-]+ям\S*/g, ' __tomyam ')
      // "көңілім жоқ" = not in the mood; "көңілім көтерілді" = my mood lifted
      .replace(/көңіл\S*\s+жоқ/g, ' көңілсіз ').replace(/көңіл\S*\s+көтеріл\S*/g, ' көңілді ');
    return t.split(new RegExp(`[^a-z${LOW}0-9_'’]+`, 'i')).filter(Boolean);
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

    // ---- mood: words, weighted by where they stand in the day -------------
    // Peak–end rule (Kahneman): an experience is remembered by its strongest
    // moment and by how it ended. So later sentences weigh more, the clause
    // after "но / а потом / в итоге" weighs more than the one before it, and
    // the single strongest word weighs extra.
    const sentences = splitSentences(text);
    const nS = Math.max(1, sentences.length);
    const SKIP = new Set([...L.INTENSIFIERS, ...L.SOFTENERS].map(norm));
    let contrasts = 0, turnAt = -1;
    const raw = [];
    sentences.forEach((sent, si) => {
      const tk = tokenize(sent);
      // Where does the turn happen in this sentence (token index), if anywhere?
      let cut = tk.findIndex((tok) => L.CONTRAST.includes(tok));
      for (const re of L.CONTRAST_PHRASES || []) {
        const mm = norm(sent).match(re);
        if (mm) { const at = tokenize(norm(sent).slice(0, mm.index + mm[1].length)).length; cut = cut < 0 ? at : Math.min(cut, at); }
      }
      if (cut >= 0) { contrasts += 1; if (turnAt < 0) turnAt = si; }
      const pos = 0.8 + 0.4 * (si / Math.max(1, nS - 1));
      tk.forEach((tok, i) => {
        if (SKIP.has(tok)) return; // "ужасно красиво" is not a sad word
        const e = MOOD.find((m) => matches(tok, m.s));
        if (!e) return;
        const prev = tk.slice(Math.max(0, i - 2), i);
        let mod = 1, note = '';
        const next = tk.slice(i + 1, i + 3);
        const kkNeg = e.kk && e.s[0] !== '=' && L.KK_NEG_SUFFIX && L.KK_NEG_SUFFIX.test(tok.slice(e.s.length));
        if (prev.some((p) => L.NEGATORS.includes(p)) || kkNeg || next.some((p) => (L.NEGATORS_AFTER || []).includes(p))) {
          // Negating a mild word makes it neutral ("почти не разговаривали" at a lake is peace, not sadness);
          // only a strong word turns over ("не весело", "не грустно").
          if (Math.abs(e.v) < 0.4) return;
          mod = -0.6; note = 'отрицание';
        }
        if (prev.some((p) => L.INTENSIFIERS.includes(p))) { mod *= 1.4; note = note || 'усиление'; }
        if (prev.some((p) => L.SOFTENERS.includes(p))) { mod *= 0.6; note = note || 'смягчение'; }
        const turn = cut < 0 ? 1 : i >= cut ? 1.4 : 0.7;
        raw.push({ word: tok, v: +(e.v * mod).toFixed(2), a: e.a, mod, note, si, w: pos * turn });
      });
    });
    // A sentence that opens with the turn ("Но вечером…") also quiets everything before it.
    if (turnAt > 0) raw.forEach((h) => { if (h.si < turnAt) h.w *= 0.8; });
    let peak = null;
    raw.forEach((h) => { if (!peak || Math.abs(h.v) * h.w > Math.abs(peak.v) * peak.w) peak = h; });
    if (peak && Math.abs(peak.v) >= 0.5) peak.w *= 1.5; else peak = null;
    let sv = 0, swt = 0, sa = 0;
    raw.forEach((h) => {
      sv += h.v * h.w; swt += h.w;
      sa += h.a * (h.mod < 0 ? 0.8 : Math.min(Math.abs(h.mod), 1.3));
      res.hits.push({ word: h.word, v: h.v, a: h.a, note: h.note });
    });
    const n = raw.length;
    res.valence = clamp(sv / (swt + 1.5), -1, 1);
    let arousal = (sa + 0.35 * 1.5) / (n + 1.5);
    const excl = (text.match(/!/g) || []).length;
    arousal += Math.min(0.2, excl * 0.06);
    const avgLen = tokens.length / nS;
    if (avgLen < 8 && sentences.length > 2) arousal += 0.05;
    if (/\.\.\.|…/.test(text)) arousal -= 0.05;
    // First-time experiences: the moments a memory keeps.
    res.firsts = sentences.filter((st) => (L.FIRSTS || []).some((re) => re.test(st)));
    if (res.firsts.length) arousal += 0.05;
    res.arousal = clamp(arousal, 0, 1);
    res.exclamations = excl;
    res.contrasts = contrasts;
    res.peak = peak ? { word: peak.word, v: peak.v, sentence: sentences[peak.si] } : null;
    // The arc of the day: how the first half felt against the second half.
    const half = (lo, hi) => { const hs = raw.filter((h) => h.si >= lo && h.si < hi); return hs.length ? hs.reduce((a, h) => a + h.v, 0) / hs.length : null; };
    const mid = nS > 1 ? Math.ceil(nS / 2) : 1;
    const a0 = nS > 1 ? half(0, mid) : null, a1 = nS > 1 ? half(mid, nS) : null;
    const arcD = a0 !== null && a1 !== null ? a1 - a0 : 0;
    res.arc = { kind: a0 === null || a1 === null ? 'even' : arcD >= 0.45 ? 'rise' : arcD <= -0.45 ? 'fall' : 'even',
      start: a0 === null ? null : +a0.toFixed(2), end: a1 === null ? null : +a1.toFixed(2), turn: turnAt >= 0 ? sentences[turnAt] : null };

    // ---- mixed feelings ---------------------------------------------------
    // Light and dark words are kept apart instead of cancelling out: a farewell
    // party ("смеялись" + "прощались") is not a neutral day, it is both at once.
    let P = 0, N = 0, pa = 0, na = 0;
    res.hits.forEach((h) => {
      if (h.v > 0) { P += h.v; pa += h.v * h.a; } else if (h.v < 0) { N -= h.v; na -= h.v * h.a; }
    });
    res.pos = +P.toFixed(2);
    res.neg = +N.toFixed(2);
    res.posArousal = P ? +(pa / P).toFixed(2) : 0.35;
    res.negArousal = N ? +(na / N).toFixed(2) : 0.35;
    // 0 = one feeling, 1 = two equally strong feelings. Needs about one clearly
    // emotional word on each side, so a stray "холодно" or "тишина" is not "mixed".
    res.mixed = Math.min(P, N) >= 0.5 ? +(2 * Math.min(P, N) / (P + N) * clamp((P + N) / 1.6, 0, 1)).toFixed(3) : 0;

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
    // After a turn ("но вечером…"), time words count double: the day is
    // remembered as the part it ended in.
    sentences.forEach((sent, si) => {
      const wt = turnAt >= 0 && si >= turnAt ? 2 : 1;
      tokenize(sent).forEach((tok) => {
        if (tok === '__night') { ts.night += 2 * wt; return; }
        for (const k in L.TIME) if (findIn(tok, L.TIME[k].m)) { ts[k] += wt; break; }
      });
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
    res.places = collect([...(L.GAZETTEER || []), ...L.PLACES]).map((p) => ({ ...p })); // copies: never write into the lexicon
    // Named places the gazetteer does not know: a capitalised word after
    // в/на/до/из ("в Памуккале", "на Чарын"). Folder names use the phrase as
    // written, so no declension is needed.
    const SKIP_CAP = /^(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|понедельник|вторник|сред|четверг|пятниц|суббот|воскресен|нов|рождеств|instagram|telegram|youtube)/;
    const capRe = new RegExp(`(?:^|[\\s,(«"—])(в|во|на|до|из)\\s+([${UP}][${LOW}]+(?:-[${UP}][${LOW}]+)?)`, 'gi');
    let cm;
    while ((cm = capRe.exec(text))) {
      const prep = cm[1].toLowerCase(), word = cm[2], w = norm(word);
      if (!new RegExp(`^[${UP}]`).test(word) || SKIP_CAP.test(w)) continue;
      const known = res.places.find((p) => p.proper && p.m.some((x) => w.split('-').some((part) => matches(part, x))));
      if (known) { if (prep === 'до' || prep === 'из') known.until = known.until || `${prep} ${word}`; continue; }
      let pl = res.places.find((p) => p.guessed && norm(p.nom) === w);
      if (!pl) { pl = { m: ['=' + w], nom: word, g: 'm', proper: true, guessed: true }; res.places.push(pl); }
      if (prep === 'до' || prep === 'из') pl.until = pl.until || `${prep} ${word}`;
      else if (/[еи]$/.test(w)) pl.loc = pl.loc || `${prep} ${word}`; // в Стамбуле / в Памуккале
      else pl.to = pl.to || `${prep} ${word}`; // в Стамбул / на Чарын
    }
    res.details = collect(L.DETAILS);
    res.events = collect(L.EVENTS);
    res.people = collect(L.PEOPLE).map((p) => {
      const tok = tokens.find((t) => findIn(t, p.m));
      const altKey = p.alt && Object.keys(p.alt).find((k) => matches(tok, k));
      return { with: altKey ? p.alt[altKey] : p.with };
    });
    // "с Айгерим": a capitalised name after "с/со" is kept verbatim.
    const named = text.match(new RegExp(`(?:^|[\\s,])(с|со)\\s+([${UP}A-Z][${LOW}a-z]+(?:\\s+[${UP}A-Z][${LOW}a-z]+)?)`));
    if (named) res.people.unshift({ with: named[1] + ' ' + named[2], name: true });
    // Kazakh: "Айгеріммен" = "with Aigerim". A capitalised word + -мен/-бен/-пен that is not a known word.
    else {
      const kkRe = new RegExp(`(?:^|[\\s,(«"])([${UP}][${LOW}]{2,}?)(мен|бен|пен)(?![${LOW}])`, 'g');
      let km;
      while ((km = kkRe.exec(text))) {
        const nm = km[1], low = norm(nm), whole = norm(nm + km[2]);
        const known = L.PEOPLE.some((p) => p.m.some((x) => matches(whole, x) || matches(low, x))) || (L.KK_NOT_NAMES || []).includes(low)
          || (L.GAZETTEER || []).some((g) => g.m.some((x) => matches(low, x)));
        if (!known) { res.people.unshift({ with: 'с ' + nm, name: true }); break; }
      }
    }
    res.alone = tokens.some((tok) => findIn(tok, L.ALONE));
    // Which language the entry is in: Kazakh letters or Kazakh words.
    const isKk = (tok) => new RegExp(`[${KK}]`).test(tok) || MOOD.some((m) => m.kk && matches(tok, m.s));
    const RU_FUNC = ['и', 'в', 'во', 'на', 'с', 'со', 'не', 'мы', 'я', 'он', 'она', 'они', 'это', 'было', 'был', 'была', 'были', 'очень',
      'что', 'как', 'по', 'до', 'за', 'но', 'а', 'у', 'к', 'из', 'от', 'так', 'уже', 'всё', 'все', 'весь', 'мне', 'меня', 'нас', 'потом'];
    const isRu = (tok) => !isKk(tok) && (RU_FUNC.includes(tok) || /(ый|ий|ая|яя|ое|ее|ые|ие|ого|ему|ться|лись)$/.test(tok)
      || MOOD.some((m) => !m.kk && matches(tok, m.s)));
    const kkShare = tokens.length ? tokens.filter(isKk).length / tokens.length : 0;
    const ruShare = tokens.length ? tokens.filter(isRu).length / tokens.length : 0;
    res.lang = kkShare >= 0.1 && ruShare >= 0.1 ? 'mixed' : kkShare >= 0.3 ? 'kk' : kkShare >= 0.08 ? 'mixed' : 'ru';

    // ---- travel: a trip, its destination and how they got there -----------
    const trip = (L.TRIP || []).find((tr) => tokens.some((tok) => findIn(tok, tr.m))) || null;
    const destination = res.places.find((p) => p.proper && (p.loc || p.to || p.until)) || null;
    const transport = res.places.find((p) => p.transport) || null;
    res.travel = trip || (destination && transport) ? { trip, destination, transport } : null;
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
      if (res.peak && s === res.peak.sentence) score += 0.8; // the strongest moment
      if (res.arc.kind !== 'even' && idx === sentences.length - 1) score += 0.6; // how the day ended
      if (res.firsts.includes(s)) score += 0.7; // a first time
      if (destination && tk.some((tok) => destination.m.some((x) => matches(tok, x)))) score += 0.4;
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
