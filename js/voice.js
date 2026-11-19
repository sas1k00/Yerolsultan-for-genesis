/* Тот день — voice-over with the browser's built-in speech synthesis.
 * Rule: the diary has ONE narrator voice (like its author). What changes with
 * the day is the delivery: speed, pitch and the pauses between sentences.
 */
(function (TD) {
  'use strict';
  const synth = globalThis.speechSynthesis;
  let cancelled = false;

  function voices() {
    if (!synth) return Promise.resolve([]);
    const v = synth.getVoices();
    if (v.length) return Promise.resolve(v);
    return new Promise((res) => {
      const done = () => res(synth.getVoices());
      synth.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1200);
    });
  }

  async function pickVoice() {
    const list = (await voices()).filter((v) => /^ru/i.test(v.lang));
    // One stable narrator: prefer an on-device voice, then the first Russian one.
    return list.find((v) => v.localService) || list[0] || null;
  }

  async function speak(text, rules, hooks = {}) {
    if (!synth) throw new Error('Браузер не поддерживает синтез речи');
    stop();
    cancelled = false;
    const voice = await pickVoice();
    const sentences = TD.textUtil.splitSentences(text);
    hooks.onstart && hooks.onstart(voice);
    for (const s of sentences) {
      if (cancelled) break;
      await new Promise((res) => {
        const u = new SpeechSynthesisUtterance(s);
        u.lang = 'ru-RU';
        if (voice) u.voice = voice;
        u.rate = rules.rate; u.pitch = rules.pitch;
        u.onend = u.onerror = res;
        synth.speak(u);
      });
      if (!cancelled) await new Promise((r) => setTimeout(r, rules.pause));
    }
    hooks.onend && hooks.onend();
  }

  function stop() { cancelled = true; if (synth) synth.cancel(); }

  TD.voice = { speak, stop, pickVoice, supported: !!synth };
})(globalThis.TD = globalThis.TD || {});
