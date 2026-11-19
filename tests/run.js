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

console.log('Storage helpers');
test('zip CRC-32 of "123456789" is CBF43926', () => eq(TD.store.crc32(new TextEncoder().encode('123456789')).toString(16).toUpperCase(), 'CBF43926'));
test('ASCII file name for downloads', () => eq(TD.store.translit('Ночь в офисе перед сдачей'), 'noch-v-ofise-pered-sdachey'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
