/* Unit tests for the rule system. No dependencies:  node tests/run.js */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['lexicon', 'text', 'naming', 'photo', 'music', 'system', 'store']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), { filename: f + '.js' });
}
const TD = globalThis.TD;
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

const title = (text, date, mood = { valence: 0.2, energy: 0.4 }) => TD.makeTitle(TD.analyzeText(text, date), mood).title;
const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo/days.json'), 'utf8'));

console.log('Text and folder names');
test('case example 1 → «Осенний парк и какао»', () =>
  eq(title('Гуляли по парку, всё в жёлтых листьях, было холодно, но мы пили какао и долго разговаривали', '2026-10-10'), 'Осенний парк и какао'));
test('case example 2 → «Ночь в офисе перед сдачей»', () =>
  eq(title('Срочная сдача проекта, ночь в офисе, в наушниках электронная музыка', '2026-03-01'), 'Ночь в офисе перед сдачей'));
test('negation flips mood: «не грустно» is not sad', () => {
  ok(TD.analyzeText('Было грустно.').valence < 0, 'sad should be negative');
  ok(TD.analyzeText('Было совсем не грустно, а весело!').valence > 0, 'negated sad should be positive');
});
test('people: «с бабушкой» counts, «о бабушке» does not', () => {
  eq(TD.analyzeText('Пили чай с бабушкой').people.length, 1);
  eq(TD.analyzeText('Подумала о бабушке').people.length, 0);
});
test('a name after «с» is kept verbatim', () => eq(TD.analyzeText('Гуляли с Айгерим в парке').people[0].with, 'с Айгерим'));
test('«до четырёх утра» means night, not morning', () => eq(TD.analyzeText('Работали до четырёх утра').time, 'night'));
test('season falls back to the date', () => eq(TD.analyzeText('Обычный день', '2026-07-01').season, 'summer'));
test('all demo names: 3–7 words, capital letter, no final punctuation, unique', () => {
  const seen = new Set();
  demo.forEach((d) => {
    const t = title(d.text, d.date);
    const n = t.split(/\s+/).length;
    ok(n >= 3 && n <= 7, `${t}: ${n} words`);
    ok(t[0] === t[0].toUpperCase() && !/[.!?,]$/.test(t), t);
    ok(!seen.has(t), 'duplicate ' + t); seen.add(t);
  });
});

console.log('Travel and false friends');
test('«поездка» is a trip, not a train → «Поездка в Памуккале с братом»', () => {
  const txt = 'Поездка с братом в Памуккале. Белые травертины, бирюзовая вода, было жарко, мы ходили босиком и смеялись.';
  const t = TD.analyzeText(txt, '2026-05-14');
  ok(!t.places.some((p) => p.nom === 'поезд'), 'no train');
  eq(title(txt, '2026-05-14'), 'Поездка в Памуккале с братом');
});
test('known tourist places get the right grammar: «Поездка на Чарын с семьёй»', () =>
  eq(title('Ездили с семьёй на Чарын. Каньон огромный, красные скалы.', '2026-07-20'), 'Поездка на Чарын с семьёй'));
test('an unknown capitalised place after «в» is still a place', () =>
  ok(TD.analyzeText('Весь день гуляли в Гёреме, пили чай.').places.some((p) => p.nom === 'Гёреме' && p.loc === 'в Гёреме')));
test('transport + destination → «Ночь в поезде до Алматы»', () =>
  eq(title('Ехали в поезде до Алматы всю ночь, стук колёс, чай в подстаканниках.', '2026-03-10'), 'Ночь в поезде до Алматы'));
test('false friends: холодильник ≠ cold, защитный крем ≠ defence, крышка ≠ roof', () => {
  eq(TD.analyzeText('Достала из холодильника жареную картошку.').weather.length, 0);
  eq(TD.analyzeText('На пляже мазались защитным кремом.').events.length, 0);
  eq(TD.analyzeText('Уронила крышку от кастрюли.').places.length, 0);
});
test('the lexicon is never modified by an analysis', () => {
  TD.analyzeText('Ехали в поезде до Алматы.');
  ok(!TD.LEX.GAZETTEER.some((g) => g.until), 'gazetteer entry was written to');
});

console.log('Reading the day: peak–end');
const turnDay = 'Утром всё было серо и тревожно, проспала, опоздала на пары. Но вечером мы с Аружан пили кофе на крыше и смеялись до слёз, и день стал хорошим.';
test('a bad morning that ends well reads as a good day (the end weighs more)', () => {
  const t = TD.analyzeText(turnDay, '2026-10-01');
  eq(t.arc.kind, 'rise'); ok(t.valence > 0, 'valence ' + t.valence);
});
test('after a turn, the day is remembered as its ending: «Вечер на крыше с Аружан»', () => eq(title(turnDay, '2026-10-01'), 'Вечер на крыше с Аружан'));
test('the caption is the turning point, not the bad start', () => ok(TD.analyzeText(turnDay).caption.startsWith('Но вечером'), TD.analyzeText(turnDay).caption));
test('intensifiers are not feelings: «ужасно красиво» is positive', () => ok(TD.analyzeText('Было ужасно красиво.').valence > 0.2));
test('a first time becomes the caption', () =>
  eq(TD.analyzeText('Ездили с семьёй на Чарын. Каньон огромный, красные скалы, жара. Впервые ночевали в палатке.').caption, 'Впервые ночевали в палатке.'));
test('peak and arc are explained on the page', () => {
  const ph = { count: 1, brightness: 0.5, contrast: 0.2, saturation: 0.3, warmth: 0, valence: 0, energy: 0.4, palette: [{ rgb: [180, 150, 120], share: 1 }] };
  const d = TD.system.design({ text: TD.analyzeText(turnDay, '2026-10-01'), photos: ph, music: TD.music.combineMusic(null, { genre: 'indie' }), date: '2026-10-01', id: 'p', rawText: turnDay });
  ok(d.why.some((w) => w.input === 'Ход дня' && /пик и финал/.test(w.result)));
});

console.log('Music analysis (generated songs with known tempo and key)');
function readWav(p) {
  const b = fs.readFileSync(p); let o = 12, sr, data;
  while (o < b.length) { const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4); if (id === 'fmt ') sr = b.readUInt32LE(o + 12); if (id === 'data') data = b.subarray(o + 8, o + 8 + sz); o += 8 + sz; }
  const x = new Float32Array(data.length / 2); for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(i * 2) / 32768;
  return { x, sr };
}
let modeHits = 0;
demo.forEach((d) => {
  const { x, sr } = readWav(path.join(ROOT, 'demo', d.song.file));
  const r = TD.music.analyzeSamples(x, sr);
  if (r.mode === d.truth.mode) modeHits++;
  test(`${d.song.title}: tempo ${d.truth.bpm} BPM (found ${r.bpm})`, () => ok(Math.abs(r.bpm - d.truth.bpm) / d.truth.bpm < 0.03, 'tempo off'));
});
console.log(`  info major/minor correct on ${modeHits}/${demo.length} songs (relative keys are the known weak spot; the user's «светлая/тёмная» overrides)`);
test('user mood hint overrides the detected mode', () => {
  const m = TD.music.combineMusic({ bpm: 100, mode: 'minor', modeConfidence: 0.6, key: 'Am', energy: 0.5, valence: -0.3, brightness: 0.5 }, { moodHint: 'major' });
  eq(m.mode, 'major'); eq(m.detectedMode, 'minor'); ok(m.valence > 0);
});
test('link-only song uses description and tapped tempo', () => {
  const m = TD.music.combineMusic(null, { genre: 'jazz', year: 1964, tapBpm: 88 });
  eq(m.bpm, 88); eq(m.bpmFrom, 'tap'); eq(m.era.key, 'old');
});
test('links: YouTube, youtu.be, Spotify, Яндекс Музыка', () => {
  eq(TD.music.parseLink('https://www.youtube.com/watch?v=abc123').embed, 'https://www.youtube.com/embed/abc123');
  eq(TD.music.parseLink('https://youtu.be/abc123').embed, 'https://www.youtube.com/embed/abc123');
  eq(TD.music.parseLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC').embed, 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC');
  eq(TD.music.parseLink('https://music.yandex.ru/album/123/track/456').embed, 'https://music.yandex.ru/iframe/album/123/track/456');
  eq(TD.music.parseLink('not a link'), null);
});

console.log('Visual system');
const photo = { count: 2, brightness: 0.5, contrast: 0.2, saturation: 0.3, warmth: 0.1, valence: 0.0, energy: 0.45, palette: [{ rgb: [200, 140, 60], share: 0.5 }, { rgb: [60, 70, 90], share: 0.5 }] };
const text = TD.analyzeText('Обычный день, гуляли и разговаривали.', '2026-05-10');
const slowMinor = TD.music.combineMusic(null, { genre: 'ambient', tempoHint: 'slow', moodHint: 'minor' });
const fastMajor = TD.music.combineMusic(null, { genre: 'pop', tempoHint: 'fast', moodHint: 'major' });
const dSlow = TD.system.design({ text, photos: photo, music: slowMinor, date: '2026-05-10', id: 'x', rawText: 'a' });
const dFast = TD.system.design({ text, photos: photo, music: fastMajor, date: '2026-05-10', id: 'x', rawText: 'a' });
test('same text and photos, different song → different technique', () => ok(dSlow.technique !== dFast.technique, `${dSlow.technique} vs ${dFast.technique}`));
test('slow minor song → longer shots, softer transitions, more air', () => {
  ok(dSlow.motion.shotDur > dFast.motion.shotDur, 'shot length');
  ok(dSlow.air > dFast.air, 'air');
});
test('shots change exactly on beats (shot = whole number of beats)', () => {
  [dSlow, dFast].forEach((d) => ok(Math.abs(d.motion.shotDur / d.motion.beat - Math.round(d.motion.shotDur / d.motion.beat)) < 1e-9));
});
test('old song → more film grain than a new one', () => {
  const old = TD.system.design({ text, photos: photo, music: TD.music.combineMusic(null, { genre: 'jazz', year: 1958 }), date: '2026-05-10', id: 'x', rawText: 'a' });
  const now = TD.system.design({ text, photos: photo, music: TD.music.combineMusic(null, { genre: 'jazz', year: 2024 }), date: '2026-05-10', id: 'x', rawText: 'a' });
  ok(old.texture.grain > now.texture.grain);
});
test('palette comes from the photos (graded, not replaced)', () => {
  const [h0] = TD.color.rgb2hsl([200, 140, 60]), [h1] = TD.color.rgb2hsl(dSlow.palette.colors[0]);
  ok(Math.abs(h0 - h1) < 40, `hue moved too far: ${h0} → ${h1}`);
});
test('the same day always gets the same design', () => {
  const again = TD.system.design({ text, photos: photo, music: slowMinor, date: '2026-05-10', id: 'x', rawText: 'a' });
  eq(JSON.stringify(again), JSON.stringify(dSlow));
});
test('every decision has an explanation', () => ['Настроение', 'Приём', 'Цвет', 'Ритм', 'Композиция', 'Фактура', 'Типографика', 'Голос']
  .forEach((g) => ok(dSlow.why.some((w) => w.group === g), 'missing ' + g)));
test('all four techniques are reachable', () => {
  const seen = new Set();
  for (const v of [-0.8, 0.8]) for (const e of [0.1, 0.9]) {
    const t2 = { ...text, valence: v, arousal: e };
    const m2 = { ...slowMinor, valence: v, energy: e };
    seen.add(TD.system.design({ text: t2, photos: { ...photo, valence: v, energy: e }, music: m2, date: '2026-05-10', id: 'y', rawText: 'b' }).technique);
  }
  eq(seen.size, 4);
});

console.log('Mixed feelings and soft borders');
const designFor = (txt, song, id = 'm') => TD.system.design({ text: TD.analyzeText(txt, '2026-06-01'), photos: photo,
  music: TD.music.combineMusic(null, song), date: '2026-06-01', id, rawText: txt });
const happySong = { genre: 'pop', tempoHint: 'fast', moodHint: 'major' };
test('farewell party: joy and sadness in the text → Matisse with Ma pauses', () => {
  const t = TD.analyzeText('Провожали Дану в Сеул. Танцевали, смеялись до слёз, было весело. А потом обнимались у такси, и стало очень грустно.');
  ok(t.mixed > 0.5, 'mixed ' + t.mixed);
  const d = designFor('Провожали Дану в Сеул. Танцевали, смеялись до слёз, было весело. А потом обнимались у такси, и стало очень грустно.', happySong);
  eq(d.technique, 'cutout'); eq(d.blend.secondary, 'ma'); eq(d.blend.from, 'text');
  ok(d.why.some((w) => w.input === 'Смешанные чувства'), 'mixed feelings explained');
});
test('pure joy stays one clean technique', () => {
  const d = designFor('Сдала экзамен! Весь день смеялись с друзьями, танцевали, было весело и счастливо.', happySong);
  eq(d.blend.secondary, null); eq(d.blend.every, 0);
});
test('one stray word does not make a day mixed («было холодно» in a happy day)', () =>
  eq(TD.analyzeText('Было холодно, но мы смеялись весь вечер и было очень весело и тепло.').mixed, 0));
test('happy text with a sad song → the song brings the second feeling', () => {
  const d = designFor('Гуляли с друзьями, смеялись, ели мороженое, было весело.', { genre: 'ambient', tempoHint: 'slow', moodHint: 'minor' });
  eq(d.blend.from, 'music'); ok(d.blend.secondary === 'ma' || d.blend.secondary === 'geometry', d.blend.secondary);
});
test('the second feeling never takes over the main technique', () => {
  for (const v of [-0.6, -0.1, 0.1, 0.6]) for (const e of [0.2, 0.8]) {
    const t2 = { ...text, valence: v, arousal: e, mixed: 1, posArousal: 0.2, negArousal: 0.2,
      hits: [{ word: 'весело', v: 0.8, a: 0.2 }, { word: 'грустно', v: -0.8, a: 0.2 }] };
    const d = TD.system.design({ text: t2, photos: { ...photo, valence: v, energy: e }, music: { ...slowMinor, valence: v, energy: e }, date: '2026-05-10', id: 'z', rawText: 'c' });
    const quad = d.mood.energy >= 0.5 ? (d.mood.valence >= 0 ? 'cutout' : 'geometry') : (d.mood.valence >= 0 ? 'brush' : 'ma');
    eq(d.technique, quad, `v=${v} e=${e}`);
  }
});
test('no cliff at the border: energy 0.49 and 0.51 both show both techniques', () => {
  const at = (e) => {
    const t2 = { ...text, valence: 0.5, arousal: e, mixed: 0 };
    return TD.system.design({ text: t2, photos: { ...photo, valence: 0.5, energy: e }, music: { ...fastMajor, valence: 0.5, energy: e }, date: '2026-05-10', id: 'b', rawText: 'd' });
  };
  const lo = at(0.49), hi = at(0.51);
  const set = (d) => [d.technique, d.blend.secondary].sort().join('+');
  eq(set(lo), set(hi)); eq(set(lo), 'brush+cutout');
  ok(Math.abs(lo.grade.satMul - hi.grade.satMul) < 0.05, 'saturation must not jump');
});
test('mixed days: interlude shots and transitions exist for both techniques', () => {
  const d = designFor('Провожали Дану в Сеул. Танцевали, смеялись до слёз, было весело. А потом обнимались у такси, и стало очень грустно.', happySong);
  ok(d.blend.every >= 3 && d.blend.every <= 5, 'every ' + d.blend.every);
  ok(d.palette.windowBgs.cutout && d.palette.windowBgs.ma, 'window backgrounds');
  ok(d.motion.fadeBy.ma > d.motion.fadeBy.cutout, 'Ma fades in slower than cut-outs');
});

console.log('Storage helpers');
test('zip CRC-32 of "123456789" is CBF43926', () => eq(TD.store.crc32(new TextEncoder().encode('123456789')).toString(16).toUpperCase(), 'CBF43926'));
test('ASCII file name for downloads', () => eq(TD.store.translit('Ночь в офисе перед сдачей'), 'noch-v-ofise-pered-sdachey'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
