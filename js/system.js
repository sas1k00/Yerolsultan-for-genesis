/* Тот день — the visual system.
 * Turns text + photos + music into design decisions, and records WHY
 * each decision was made (shown on the page as "Почему день выглядит так").
 *
 * Constant across all days (makes the feed one diary):
 *   9:16 page, paper, header with date, photo window position, handwritten
 *   folder title, song line, "печать дня" seal, fonts of these elements.
 * Variable per day (makes each day its own):
 *   art technique, palette grading, window background, rhythm of shots,
 *   transitions, empty space, texture (grain, light leak, weather),
 *   caption typography, voice.
 */
(function (TD) {
  'use strict';
  const { rgb2hsl, hsl2rgb, hueToward, clamp, lum } = TD.color;
  const f2 = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);
  const pct = (x) => Math.round(x * 100) + '%';

  const TECHNIQUES = {
    brush: {
      name: 'Мазки света', ref: 'Клод Моне, импрессионизм',
      when: 'спокойный и светлый день',
      why: 'Короткие мазки растворяют контуры: день вспоминается как свет, тепло и воздух, а не как детали.',
      interlude: 'вспышка тёплого света: кадр переписан мазками, как хорошее воспоминание',
    },
    geometry: {
      name: 'Напряжённая геометрия', ref: 'Василий Кандинский, «Композиция VIII»',
      when: 'насыщенный и напряжённый день',
      why: 'Острые углы, жёсткие линии, контраст и резкий монтаж по долям передают давление, скорость и собранность.',
      interlude: 'укол напряжения: жёсткая геометрия и склейка точно в долю',
    },
    cutout: {
      name: 'Вырезки', ref: 'Анри Матисс, гуаши-вырезки',
      when: 'яркий и радостный день',
      why: 'Плоские чистые цвета и пляшущие органические формы передают радость, движение и лёгкость.',
      interlude: 'всплеск радости: вырезки подпрыгивают в долю, как внезапный смех',
    },
    ma: {
      name: 'Ма — пустота', ref: 'японская минималистичная графика, ваби-саби',
      when: 'тихий и грустный день',
      why: 'Много пустого места, приглушённый цвет и медленные растворения дают дню паузу: грусть без драмы.',
      interlude: 'пауза: пустой лист, маленький приглушённый кадр и печать, как тихая грусть',
    },
  };
  const ORDER = ['brush', 'geometry', 'cutout', 'ma'];
  const FADE = { brush: 0.45, ma: 0.55, cutout: 0.08, geometry: 0 };
  const quadrant = (v, e) => (e >= 0.5 ? (v >= 0 ? 'cutout' : 'geometry') : (v >= 0 ? 'brush' : 'ma'));
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  // How soft the borders are: a day 0.08 of energy (or 0.12 of mood) past the
  // middle is ~73 % one technique. Far from the middle the day stays pure.
  const SOFT_E = 0.08, SOFT_V = 0.12;
  // A second technique is shown when it has at least this share of the first.
  const SECOND_MIN = 0.4;

  const PAPER = [242, 236, 225];
  const INK = [42, 36, 32];
  const TIME_RU = { morning: 'утро', day: 'день', evening: 'вечер', night: 'ночь' };
  const SEASON_RU = { autumn: 'осень', winter: 'зима', spring: 'весна', summer: 'лето' };
  const WEATHER_RU = { rain: 'дождь', snow: 'снег', sun: 'солнце', fog: 'туман', wind: 'ветер', cold: 'холод', hot: 'жара' };

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** The grading rule shared by palette and photo pixels. */
  function makeGrade(g) {
    return function (rgb, strength = 1) {
      let [h, s, l] = rgb2hsl(rgb);
      h = hueToward(h, g.hueTarget, g.hueAmount * strength);
      s = clamp(s * (1 + (g.satMul - 1) * strength), 0, 0.95);
      l = l + (g.lightTarget - l) * g.lightPull * strength;
      if (g.fade) { l = l * (1 - g.fade * 0.25) + g.fade * 0.18; s *= 1 - g.fade * 0.45; }
      l *= 1 - g.darken * strength;
      return hsl2rgb([h, s, clamp(l, 0, 1)]);
    };
  }

  /**
   * @param a {text, photos, music, date, id}
   *   text   = TD.analyzeText(...)
   *   photos = TD.photo.analyzePhotos(...)
   *   music  = TD.music.combineMusic(...)
   */
  function design(a) {
    const t = a.text, p = a.photos, m = a.music;
    const why = [];
    const seed = hashStr((a.id || '') + '|' + (a.date || '') + '|' + (a.rawText || ''));

    // ---- 1. mood: three sources, weighted ------------------------------
    const valence = clamp(0.55 * t.valence + 0.30 * m.valence + 0.15 * p.valence, -1, 1);
    const energy = clamp(0.35 * t.arousal + 0.45 * m.energy + 0.20 * p.energy, 0, 1);
    const warmth = clamp(0.5 * t.warmth + 0.5 * p.warmth, -1, 1);
    const topWords = t.hits.slice().sort((x, y) => Math.abs(y.v) + y.a - Math.abs(x.v) - x.a).slice(0, 4)
      .map((h) => `«${h.word}»${h.note ? ' (' + h.note + ')' : ''}`);
    why.push({
      group: 'Настроение', input: 'Текст',
      rule: topWords.length ? `Слова ${topWords.join(', ')}` : 'Эмоциональных слов почти нет',
      result: `настроение ${f2(t.valence)}, энергия ${t.arousal.toFixed(2)}`,
    });
    // How the day unfolded: peak–end rule.
    const arc = t.arc || { kind: 'even' };
    if (t.peak || arc.kind !== 'even') {
      const arcRu = { rise: 'день стал светлее к концу', fall: 'день потемнел к концу', even: 'день ровный' }[arc.kind];
      why.push({
        group: 'Настроение', input: 'Ход дня',
        rule: [arc.kind !== 'even' ? `начало ${f2(arc.start)} → конец ${f2(arc.end)}: ${arcRu}` : null,
          arc.turn ? 'поворот на «но / а потом»' : null, t.peak ? `пик — «${t.peak.word}»` : null].filter(Boolean).join('; '),
        result: 'правило «пик и финал» (Канеман): день помнится по самому сильному моменту и по тому, чем закончился, поэтому они весят больше',
      });
    }
    if (t.firsts && t.firsts.length) why.push({
      group: 'Настроение', input: 'Впервые',
      rule: `«${t.firsts[0].slice(0, 60)}${t.firsts[0].length > 60 ? '…' : ''}»`,
      result: 'первый раз запоминается сильнее: энергия выше, эта фраза в приоритете для подписи',
    });
    const modeRu = m.mode === 'major' ? 'мажор' : 'минор';
    const modeSrc = m.modeFrom === 'user'
      ? (m.detectedMode && m.detectedMode !== m.mode ? ` (анализ услышал ${m.detectedMode === 'major' ? 'мажор' : 'минор'}, вы поправили)` : ' (совпало с вашей оценкой)')
      : m.source === 'description' ? ' (по описанию)' : ` (${m.key || ''}, уверенность ${pct(m.modeConfidence)})`;
    why.push({
      group: 'Настроение', input: 'Песня',
      rule: `${m.bpm ? Math.round(m.bpm) + ' BPM' : 'темп не найден'}${m.bpmFrom === 'tap' ? ' (отстучали)' : ''}, ${modeRu}${modeSrc}${m.genreLabel ? ', ' + m.genreLabel : ''}${m.energyHint ? `, на слух: ${m.energyHint === 'calm' ? 'спокойная' : 'энергичная'}${m.detectedEnergy != null ? ` (анализ: ${m.detectedEnergy.toFixed(2)})` : ''}` : ''}`,
      result: `настроение ${f2(m.valence)}, энергия ${m.energy.toFixed(2)}`,
    });
    why.push({
      group: 'Настроение', input: 'Фото',
      rule: `${p.count} ${p.count === 1 ? 'кадр' : p.count < 5 ? 'кадра' : 'кадров'}: яркость ${pct(p.brightness)}, насыщенность ${pct(p.saturation)}, ${p.warmth > 0.08 ? 'тёплые' : p.warmth < -0.08 ? 'холодные' : 'нейтральные'} тона`,
      result: `настроение ${f2(p.valence)}, энергия ${p.energy.toFixed(2)}`,
    });
    why.push({
      group: 'Настроение', input: 'Итог',
      rule: 'Текст задаёт смысл (55 % настроения), музыка задаёт пульс (45 % энергии), фото уточняют',
      result: `настроение ${f2(valence)}, энергия ${energy.toFixed(2)}`,
    });

    // ---- 2. technique: soft borders + mixed feelings ---------------------
    // a) Soft borders. Each technique gets a share instead of a hard 2×2 box,
    //    so energy 0.49 and 0.51 are no longer two different worlds.
    const hiE = sigmoid((energy - 0.5) / SOFT_E), bright = sigmoid(valence / SOFT_V);
    const soft = { cutout: hiE * bright, geometry: hiE * (1 - bright), brush: (1 - hiE) * bright, ma: (1 - hiE) * (1 - bright) };
    // b) Mixed feelings. Either the text holds light and dark at once, or the
    //    song pulls the opposite way from the text. The "other" feeling gets a
    //    technique of its own, chosen by how loud that feeling is.
    const textMix = t.mixed || 0;
    const cross = t.valence * m.valence < 0 ? clamp(Math.min(Math.abs(t.valence), Math.abs(m.valence)) / 0.35, 0, 1) : 0;
    const mixed = Math.max(textMix, cross);
    let candidate = null, mixFrom = null;
    if (mixed >= 0.25) {
      if (textMix >= cross) {
        mixFrom = 'text';
        candidate = valence >= 0 ? (t.negArousal >= 0.5 ? 'geometry' : 'ma') : (t.posArousal >= 0.5 ? 'cutout' : 'brush');
      } else {
        mixFrom = 'music';
        const songAgrees = (valence >= 0) === (m.valence >= 0);
        candidate = songAgrees ? quadrant(t.valence, t.arousal) : quadrant(m.valence, m.energy);
      }
    }
    const pull = candidate ? 0.5 * mixed : 0;
    const W = {};
    ORDER.forEach((k) => { W[k] = (1 - pull) * soft[k] + (k === candidate ? pull : 0); });
    // The day's overall mood picks the main technique; the second feeling only
    // adds interludes and never takes over (otherwise one sad word could turn
    // a warm day into Ma).
    const technique = ORDER.slice().sort((x, y) => soft[y] - soft[x])[0];
    const ranked = [technique, ...ORDER.filter((k) => k !== technique).sort((x, y) => W[y] - W[x])];
    const strength = Math.min(1, W[ranked[1]] / W[technique]);
    const secondary = strength >= SECOND_MIN ? ranked[1] : null;
    // The stronger the second feeling, the more often its shots appear.
    // With a single photo there are no shot changes, so no interludes either.
    const every = !secondary || (p.count || 0) <= 1 ? 0 : strength >= 0.75 ? 3 : strength >= 0.55 ? 4 : 5;
    const blendFrom = !secondary ? null : candidate && (secondary === candidate || technique === candidate) ? mixFrom : 'border';

    const T = TECHNIQUES[technique];
    const intensity = clamp(Math.hypot(valence, (energy - 0.5) * 2) / 1.2, 0.25, 1);
    const share = (k) => Math.round(soft[k] * 100) + ' %';
    why.push({
      group: 'Приём', input: `${energy >= 0.5 ? 'Высокая' : 'Низкая'} энергия, ${valence >= 0 ? 'светлое' : 'тёмное'} настроение`,
      rule: `${T.when} → «${T.name}» (${T.ref})`, result: T.why,
    });
    if (mixed >= 0.25) {
      const words = (sign) => t.hits.filter((h) => h.v * sign > 0).sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
        .slice(0, 2).map((h) => `«${h.word}»`).join(', ');
      why.push({
        group: 'Приём', input: 'Смешанные чувства',
        rule: mixFrom === 'text'
          ? `В тексте рядом светлое (${words(1)}) и тёмное (${words(-1)})`
          : `Песня ${m.valence < 0 ? 'темнее' : 'светлее'} текста: песня ${f2(m.valence)}, текст ${f2(t.valence)}`,
        result: `смешанность ${pct(mixed)}: день не сводится к одному чувству`,
      });
    }
    why.push({
      group: 'Приём', input: blendFrom === 'border' ? 'День у границы двух приёмов' : secondary ? 'Второе чувство дня' : 'Доли приёмов',
      rule: secondary
        ? `Главный приём по общему настроению — «${T.name}»; второе — «${TECHNIQUES[secondary].name}», сила ${pct(strength)}`
        : ORDER.slice().sort((x, y) => soft[y] - soft[x]).slice(0, 3).map((k) => `${TECHNIQUES[k].name} ${share(k)}`).join(', '),
      result: secondary && !every
        ? `одно фото, поэтому без смены кадров: второе чувство («${TECHNIQUES[secondary].name}») остаётся в цвете и паузах голоса`
        : secondary
        ? `каждая ${every}-я смена кадра повторяет предыдущее фото в приёме «${TECHNIQUES[secondary].name}» (${TECHNIQUES[secondary].ref}), тот же момент другим чувством: ${TECHNIQUES[secondary].interlude}`
        : 'день далеко от границ: один чистый приём',
    });

    // ---- 3. palette: the photos' own colours, graded by mood -------------
    const night = t.time === 'night';
    const era = m.era || { grain: 0.12, fade: 0, label: '' };
    const grade = {
      satMul: clamp(0.6 + 0.55 * energy + 0.3 * Math.max(valence, 0) - 0.3 * Math.max(-valence, 0) - 0.25 * W.ma, 0.25, 1.6),
      hueTarget: warmth >= 0 ? 32 : 212,
      hueAmount: clamp(0.35 * Math.abs(warmth), 0, 0.35),
      lightTarget: 0.5 + 0.18 * valence, lightPull: 0.15,
      fade: era.fade || 0, darken: night ? 0.18 : 0,
    };
    const gradeFn = makeGrade(grade);
    const base = (p.palette || []).map((c) => c.rgb);
    if (!base.length) base.push([150, 140, 130]);
    const colors = base.map((c) => gradeFn(c));
    const bySat = colors.slice().sort((x, y) => rgb2hsl(y)[1] * (1 - Math.abs(rgb2hsl(y)[2] - 0.5)) - rgb2hsl(x)[1] * (1 - Math.abs(rgb2hsl(x)[2] - 0.5)));
    let accent = bySat[0];
    const ah = rgb2hsl(accent);
    if (ah[1] < 0.35) accent = hsl2rgb([ah[0], 0.6, clamp(ah[2], 0.4, 0.6)]);
    const byLum = colors.slice().sort((x, y) => lum(x) - lum(y));
    const dark = byLum[0], light = byLum[byLum.length - 1];
    why.push({
      group: 'Цвет', input: 'Цвета фото',
      rule: `Палитра берётся из самих фото, затем насыщенность ×${grade.satMul.toFixed(2)} (энергия ${energy >= 0.5 ? 'высокая' : 'низкая'}, настроение ${valence >= 0 ? 'светлое' : 'тёмное'})`,
      result: 'цвет дня остаётся «своим», но окрашен настроением',
    });
    if (grade.hueAmount > 0.04) why.push({
      group: 'Цвет', input: warmth > 0 ? 'Тёплые слова и тёплый свет' : 'Холодные слова и холодный свет',
      rule: `Оттенки сдвинуты к ${warmth > 0 ? 'охре' : 'синему'} на ${pct(grade.hueAmount)}`, result: warmth > 0 ? 'тепло видно в цвете' : 'холод видно в цвете',
    });
    if (night) why.push({ group: 'Цвет', input: 'Время суток: ночь', rule: 'Все цвета темнее на 18 %', result: 'ночь остаётся ночью' });

    const windowBgFor = (k) => {
      if (k === 'brush') return TD.color.mix(light, PAPER, 0.3);
      if (k === 'geometry') return TD.color.mix(dark, [20, 26, 43], 0.6);
      if (k === 'cutout') {
        // Paper in the day's own colour: the most present colourful tone of the photos, made pale.
        const own = (p.palette || []).slice().sort((x, y) => y.share * (0.3 + rgb2hsl(y.rgb)[1]) - x.share * (0.3 + rgb2hsl(x.rgb)[1]))[0];
        const [h, s] = rgb2hsl(own ? gradeFn(own.rgb) : accent);
        return hsl2rgb([h, clamp(s, 0.25, 0.55), 0.8]);
      }
      return TD.color.mix(PAPER, rgb2hsl(light)[1] > 0.1 ? hsl2rgb([rgb2hsl(light)[0], 0.12, 0.88]) : light, 0.25);
    };
    const windowBg = windowBgFor(technique);
    const windowBgs = { [technique]: windowBg };
    if (secondary) windowBgs[secondary] = windowBgFor(secondary);

    // ---- 4. rhythm: the song's tempo drives the montage --------------------
    const bpm = m.bpm || 96;
    const beat = 60 / bpm;
    let beatsPerShot = { brush: 8, ma: 8, cutout: 4, geometry: 2 }[technique];
    // At least 3 s per photo, so a photo can be seen; still a whole number of beats.
    while (beatsPerShot * beat < 3) beatsPerShot *= 2;
    while (beatsPerShot * beat > 7.5 && beatsPerShot > 2) beatsPerShot /= 2;
    const shotDur = beatsPerShot * beat;
    const fade = FADE[technique] * shotDur;
    // Each technique keeps its own transition: a Ma pause fades in slowly even
    // inside a hard-cut Kandinsky day, and the day snaps back with a cut.
    const fadeBy = { [technique]: fade };
    if (secondary) fadeBy[secondary] = FADE[secondary] * shotDur;
    const motion = {
      bpm, beat, beatOffset: m.beatOffset || 0, beatsPerShot, shotDur, fade, fadeBy,
      zoom: 0.03 + 0.07 * energy,
      pulse: clamp(0.02 + 0.09 * m.energy * (0.5 + (m.percussive || 0.5)), 0.02, 0.12),
      sway: 2 + 7 * energy,
    };
    why.push({
      group: 'Ритм', input: `Темп ${Math.round(bpm)} BPM`,
      rule: `Кадр сменяется каждые ${beatsPerShot} ${beatsPerShot < 5 ? 'доли' : 'долей'} = ${shotDur.toFixed(1)} с, ${fade > 0.3 ? 'растворение ' + fade.toFixed(1) + ' с' : fade > 0 ? 'быстрая вспышка' : 'жёсткая склейка точно в долю'}`,
      result: technique === 'geometry' ? 'резкий монтаж как пульс' : fade > 0.3 ? 'кадры плывут, как воспоминание' : 'кадры подпрыгивают в такт',
    });
    why.push({
      group: 'Ритм', input: `Энергия песни ${m.energy.toFixed(2)}`,
      rule: `Формы пульсируют на каждой доле с силой ${pct(motion.pulse)}, наезд камеры ${pct(motion.zoom)}`,
      result: 'музыку видно, даже без звука',
    });

    // ---- 5. composition: slow / minor songs give more air ------------------
    const air = clamp(0.12 + 0.5 * (1 - energy) + (m.mode === 'minor' ? 0.1 : 0) - 0.1 * valence, 0.05, 0.72);
    why.push({
      group: 'Композиция', input: `${energy < 0.5 ? 'Медленный' : 'Быстрый'} ${m.mode === 'minor' ? 'минорный' : 'мажорный'} день`,
      rule: `Пустое пространство в кадре: ${pct(air)}`,
      result: air > 0.4 ? 'больше воздуха и тишины' : 'кадр плотный и наполненный',
    });

    why.push({
      group: 'Композиция', input: 'Главное на фото',
      rule: 'Люди, лица и детали всегда целиком в кадре: обрезка только там, где нет ничего важного; иначе фото уменьшается, а свободное место заполняет его же размытая копия',
      result: 'день узнаётся по своим людям и местам',
    });

    // ---- 6. texture ---------------------------------------------------------
    const grain = clamp((era.grain || 0.1) + (night ? 0.12 : 0) + 0.08 * t.sensory + 0.04 * W.brush, 0.04, 0.6);
    why.push({
      group: 'Фактура', input: era.label ? `Год песни: ${era.label}` : 'Год песни не указан',
      rule: `Плёночное зерно ${pct(grain)}${night ? ' (+ночь)' : ''}${t.sensoryCount ? `, чувственных слов: ${t.sensoryCount}` : ''}`,
      result: grain > 0.3 ? 'кадр похож на старую плёнку' : 'кадр почти чистый',
    });
    const sunset = t.details.some((d) => d.nom === 'закат') || t.weather.includes('sun') || t.time === 'evening';
    const leak = warmth > 0.1 && sunset ? clamp(0.18 + 0.4 * warmth, 0, 0.5) : 0;
    if (leak) why.push({ group: 'Фактура', input: 'Тёплый свет: вечер, солнце или закат', rule: `Засветка плёнки ${pct(leak)}`, result: 'мягкий тёплый блик в углу' });
    let particles = null;
    if (t.weather.includes('snow')) particles = 'snow';
    else if (t.weather.includes('rain')) particles = 'rain';
    else if (t.season === 'autumn' && t.details.some((d) => d.nom === 'листья')) particles = 'leaves';
    else if (t.weather.includes('fog')) particles = 'fog';
    else if (technique === 'cutout' && energy > 0.6) particles = 'confetti';
    if (particles) why.push({
      group: 'Фактура', input: particles === 'confetti' ? 'Очень высокая энергия' : 'Погода из текста: ' + (WEATHER_RU[particles] || 'листопад'),
      rule: { snow: 'Снег поверх кадра', rain: 'Капли и косые штрихи дождя', leaves: 'Падающие листья в цветах палитры', fog: 'Медленный туман', confetti: 'Конфетти из цветов палитры' }[particles],
      result: 'погоду дня видно',
    });
    const vignette = night || valence < -0.3 ? 0.35 : 0.12;

    // ---- 7. typography of the caption --------------------------------------
    const TYPO = {
      brush: { font: 'Caveat', weight: 500, size: 60, upper: false, reveal: 'words', label: 'рукописный Caveat, слова проявляются медленно' },
      geometry: { font: 'Oswald', weight: 600, size: 50, upper: true, reveal: 'beats', label: 'узкий Oswald капслоком, строки появляются в долю' },
      cutout: { font: 'Rubik', weight: 800, size: 52, upper: false, reveal: 'bounce', label: 'жирный округлый Rubik, слова подпрыгивают' },
      ma: { font: 'Cormorant Garamond', weight: 400, size: 48, upper: false, italic: true, reveal: 'lines', label: 'тонкий курсив Cormorant, по строке, с паузами' },
    };
    const typo = TYPO[technique];
    why.push({ group: 'Типографика', input: `Приём «${T.name}»`, rule: `Подпись: ${typo.label}`, result: 'шрифт звучит в тон дню; дата и название всегда одинаковы' });

    // ---- 8. voice -------------------------------------------------------------
    const voice = {
      rate: +clamp(0.82 + 0.42 * energy, 0.8, 1.25).toFixed(2),
      pitch: +clamp(0.95 + 0.22 * valence + 0.1 * (energy - 0.5), 0.75, 1.25).toFixed(2),
      // A mixed day is read with longer pauses: the narrator "chooses words".
      pause: Math.round(700 - 500 * energy + 300 * mixed),
      duck: 0.22,
      label: energy < 0.5 ? (valence >= 0 ? 'тихий и тёплый' : 'тихий и ровный') : (valence >= 0 ? 'живой и быстрый' : 'собранный и чёткий'),
    };
    why.push({
      group: 'Голос', input: `Энергия ${energy.toFixed(2)}, настроение ${f2(valence)}`,
      rule: `Голос ${voice.label}: скорость ×${voice.rate}, высота ×${voice.pitch}, паузы ${(voice.pause / 1000).toFixed(1)} с`,
      result: 'один голос рассказчика на весь дневник, меняется только подача; музыка приглушается',
    });

    const weights = {};
    ORDER.forEach((k) => { weights[k] = +W[k].toFixed(3); });
    return {
      version: 2, seed, technique, techniqueInfo: T, intensity,
      blend: {
        weights, secondary, secondaryInfo: secondary ? TECHNIQUES[secondary] : null,
        strength: +strength.toFixed(3), every, from: blendFrom,
        mixed: +mixed.toFixed(3), textMix: +textMix.toFixed(3), cross: +cross.toFixed(3),
      },
      mood: { valence: +valence.toFixed(3), energy: +energy.toFixed(3), warmth: +warmth.toFixed(3) },
      grade, palette: { colors, accent, dark, light, windowBg, windowBgs, paper: PAPER, ink: INK },
      motion, air, texture: { grain, leak, particles, vignette, strokeLen: 12 + 30 * (1 - energy) },
      typo, voice, why,
      labels: { time: TIME_RU[t.time] || null, season: SEASON_RU[t.season] || null, weather: t.weather.map((w) => WEATHER_RU[w]) },
    };
  }

  TD.system = { design, makeGrade, TECHNIQUES, hashStr, rng, PAPER, INK, SOFT: { SOFT_E, SOFT_V, SECOND_MIN } };
})(globalThis.TD = globalThis.TD || {});
