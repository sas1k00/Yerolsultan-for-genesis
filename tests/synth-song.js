/* A full-length test song with a known structure, made in code (no copyright).
 * 120 BPM, 2-second bars:
 *   intro 0–12 · verse 12–32 · CHORUS 32–48 · verse 48–68 · CHORUS 68–84 ·
 *   bridge 84–96 · CHORUS 96–112 · outro 112–122
 * Used by tests/run.js to check that the "moment of the song" lands on a chorus. */
function synthSong(sr = 16000) {
  const plan = [['intro', 6], ['verse', 10], ['chorus', 8], ['verse', 10], ['chorus', 8], ['bridge', 6], ['chorus', 8], ['outro', 5]];
  const chords = { Am: [57, 60, 64], F: [53, 57, 60], C: [48, 52, 55], G: [55, 59, 62], Dm: [50, 53, 57], Em: [52, 55, 59] };
  const prog = { intro: ['Am'], verse: ['Am', 'F', 'C', 'G'], chorus: ['F', 'G', 'Em', 'Am'], bridge: ['Dm', 'Em'], outro: ['Am'] };
  const amp = { intro: 0.04, verse: 0.12, chorus: 0.26, bridge: 0.06, outro: 0.04 };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const bars = plan.reduce((a, p) => a + p[1], 0), bar = 2, beat = 0.5;
  const x = new Float32Array(Math.round(bars * bar * sr));
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  let b0 = 0;
  const sections = [];
  for (const [name, n] of plan) {
    sections.push({ name, start: b0 * bar, end: (b0 + n) * bar });
    for (let b = 0; b < n; b++) {
      const t0 = (b0 + b) * bar, ch = chords[prog[name][b % prog[name].length]];
      const pluck = name === 'verse' || name === 'chorus';
      const melody = name === 'chorus' ? [72, 74, 76, 79] : null;
      for (let i = 0; i < bar * sr; i++) {
        const t = t0 + i / sr, tb = (i / sr) % beat, idx = Math.round(t * sr);
        if (idx >= x.length) break;
        const env = pluck ? Math.exp(-tb * 4) : 0.8;
        let v = 0;
        for (const m of ch) v += Math.sin(2 * Math.PI * hz(m) * t) + 0.3 * Math.sin(4 * Math.PI * hz(m) * t);
        v *= amp[name] * env / 3;
        if (melody) v += 0.12 * Math.exp(-tb * 3) * Math.sin(2 * Math.PI * hz(melody[Math.floor(i / sr / beat) % 4]) * t);
        if (pluck) v += (name === 'chorus' ? 0.5 : 0.25) * Math.exp(-tb * 25) * Math.sin(2 * Math.PI * 55 * tb); // kick on every beat
        if (name === 'chorus' && Math.abs(tb - beat / 2) < 0.03) v += 0.08 * noise(); // off-beat hi-hat
        x[idx] = v;
      }
    }
    b0 += n;
  }
  return { x, sr, bpm: 120, sections, choruses: sections.filter((s) => s.name === 'chorus').map((s) => s.start) };
}
module.exports = { synthSong };
