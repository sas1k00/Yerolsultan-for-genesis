/* Тот день — «Выбрать момент песни».
 * A window inside the app: the person listens to the song (their audio file,
 * or the YouTube video itself) and picks the 30 seconds that belong to the day,
 * without leaving for YouTube. For an audio file the timeline also shows the
 * song's loudness and the system's suggestion (see TD.music.findMoment).
 */
(function (TD) {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fmt = (t) => { t = Math.max(0, Math.round(t || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------ YouTube ---
  let ytApi = null;
  function loadYouTube() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (ytApi) return ytApi;
    ytApi = new Promise((res, rej) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(window.YT); };
      const sc = document.createElement('script');
      sc.src = 'https://www.youtube.com/iframe_api';
      sc.onerror = () => { ytApi = null; rej(new Error('нет связи с YouTube')); };
      document.head.appendChild(sc);
      setTimeout(() => { ytApi = null; rej(new Error('YouTube не ответил')); }, 12000);
    });
    return ytApi;
  }

  /** Put a time onto the song's beat grid, so the page's cuts stay on the beat. */
  function snapToBeat(t, bpm, beatOffset) {
    if (!bpm) return t;
    const beat = 60 / bpm, off = beatOffset || 0;
    return Math.max(0, off + Math.round((t - off) / beat) * beat);
  }

  /** Loudness every half second, 0..1 on the song's own scale (for the strip). */
  function loudness(mono, sr, step = 0.5) {
    const hop = Math.round(sr * step), n = Math.floor(mono.length / hop), out = new Float32Array(n);
    for (let b = 0; b < n; b++) {
      let e = 0;
      for (let i = b * hop, end = i + hop; i < end; i += 4) e += mono[i] * mono[i];
      out[b] = Math.sqrt(e / (hop / 4));
    }
    const sorted = Array.from(out).sort((a, c) => a - c), top = sorted[Math.floor(n * 0.97)] || 1;
    return out.map((v) => Math.min(1, v / top));
  }

  /**
   * Open the window.
   * @param o.link    TD.music.parseLink(...) result (YouTube is supported)
   * @param o.file    an audio Blob/File
   * @param o.start   current start (s), or null
   * @param o.length  moment length (s), 30 by default
   * @param o.energy  the day's energy (0..1) for the suggestion, if known
   * @param o.snap    {bpm, beatOffset} to put the choice on the beat (audio files)
   * @returns Promise<{start, snapped} | null>  null when cancelled
   */
  function pick(o) {
    return new Promise((resolve) => {
      const len = o.length || 30;
      let start = o.start || 0, dur = null, done = false, previewing = false, timer = 0, ytError = null;
      let audio = null, url = null, yt = null, suggestion = null, snap = o.snap || null;
      const dlg = document.createElement('dialog');
      dlg.className = 'picker';
      dlg.setAttribute('aria-label', 'Выбор момента песни');
      dlg.innerHTML = `
        <h2>Момент песни</h2>
        <p class="hint">Двигайте отрезок на линии: песня сразу играет с этого места, а выбранные ${len} секунд звучат по кругу, как в Инстаграме. Или слушайте песню в плеере и нажмите «Это мой момент», когда начнётся любимое место.</p>
        <div class="pk-player"><p class="lbl-sm">Загружаю песню…</p></div>
        <div class="pk-track" tabindex="0" role="slider" aria-label="Начало момента песни" aria-valuemin="0" aria-valuenow="0">
          <canvas class="pk-wave" width="800" height="64" aria-hidden="true"></canvas>
          <div class="pk-sug" hidden title="Предложение системы"></div><div class="pk-win"></div><div class="pk-head" hidden></div>
        </div>
        <div class="pk-times"><span class="pk-now lbl-sm">0:00</span><b class="pk-range">…</b><span class="pk-dur lbl-sm"></span></div>
        <p class="pk-note lbl-sm"></p>
        <div class="pk-row">
          <button type="button" class="btn" data-a="back" aria-label="На 5 секунд раньше">−5 с</button>
          <button type="button" class="btn" data-a="listen">▶ Послушать момент</button>
          <button type="button" class="btn" data-a="fwd" aria-label="На 5 секунд позже">+5 с</button>
          <button type="button" class="btn btn-ink" data-a="mark">● Это мой момент</button>
        </div>
        <div class="pk-row pk-end">
          <label class="lbl-sm">или время <input class="pk-input" size="5" inputmode="text" autocomplete="off" aria-label="Начало момента, мм:сс"></label>
          <span class="pk-grow"></span>
          <button type="button" class="btn btn-ghost" data-a="cancel">Отмена</button>
          <button type="button" class="btn btn-ink" data-a="done">Готово</button>
        </div>`;
      document.body.appendChild(dlg);
      const $ = (s) => dlg.querySelector(s);
      const track = $('.pk-track'), win = $('.pk-win'), head = $('.pk-head'), note = $('.pk-note'), input = $('.pk-input');

      // -- the song: what is playing and where -------------------------------
      const now = () => (audio ? audio.currentTime : yt && yt.getCurrentTime ? yt.getCurrentTime() : 0);
      let lastSeek = 0;
      const seek = (t) => { lastSeek = Date.now(); if (audio) audio.currentTime = t; else if (yt && yt.seekTo) yt.seekTo(t, true); };
      const isPlaying = () => (audio ? !audio.paused : !!(yt && yt.getPlayerState && yt.getPlayerState() === 1));
      const playSong = () => { if (audio) audio.play().catch(() => {}); else if (yt) yt.playVideo(); };
      const pauseSong = () => { if (audio) audio.pause(); else if (yt && yt.pauseVideo) yt.pauseVideo(); };

      const maxStart = () => (dur ? Math.max(0, dur - Math.min(len, dur)) : Infinity);
      function setStart(t) {
        start = clamp(t, 0, maxStart());
        draw();
      }
      function draw() {
        $('.pk-range').textContent = `${fmt(start)} – ${fmt(start + (dur ? Math.min(len, dur) : len))}`;
        if (document.activeElement !== input) input.value = fmt(start);
        track.setAttribute('aria-valuenow', String(Math.round(start)));
        track.setAttribute('aria-valuetext', `начало ${fmt(start)}`);
        if (!dur) return;
        win.style.left = (start / dur * 100) + '%';
        win.style.width = (Math.min(len, dur) / dur * 100) + '%';
        track.setAttribute('aria-valuemax', String(Math.round(maxStart())));
        $('.pk-dur').textContent = fmt(dur);
        if (suggestion != null) { const s = $('.pk-sug'); s.hidden = false; s.style.left = (suggestion / dur * 100) + '%'; s.style.width = (len / dur * 100) + '%'; }
      }
      /* Like Instagram's music picker: moving the window plays the song from its
       * new start, and the chosen piece loops. While dragging, seeks are
       * throttled so YouTube is not flooded; letting go jumps exactly. */
      let seekTimer = 0, lastDragSeek = 0;
      function preview(final) {
        previewing = true;
        const go = () => { clearTimeout(seekTimer); seekTimer = 0; lastDragSeek = Date.now(); seek(start); playSong(); };
        if (final || Date.now() - lastDragSeek > 300) go();
        // at most one jump every 0.3 s while dragging, always to the window's latest place
        else if (!seekTimer) seekTimer = setTimeout(go, 300 - (Date.now() - lastDragSeek));
      }
      function tick() {
        const t = now();
        $('.pk-now').textContent = fmt(t);
        if (dur) { head.hidden = false; head.style.left = clamp(t / dur * 100, 0, 100) + '%'; }
        if (previewing && Date.now() - lastSeek > 1200) {
          if (t >= start + len && t < start + len + 2) seek(start); // the piece loops
          else if (t < start - 2 || t > start + len + 2) previewing = false; // they moved in the YouTube player: listen freely
        }
        const lb = $('[data-a=listen]');
        if (lb) lb.textContent = isPlaying() ? '❚❚ Пауза' : '▶ Послушать момент';
      }
      function drawWave(levels) {
        const c = $('.pk-wave'), g = c.getContext('2d');
        c.width = Math.max(200, levels.length); c.height = 64;
        g.clearRect(0, 0, c.width, c.height);
        g.fillStyle = getComputedStyle(dlg).color;
        g.globalAlpha = 0.45;
        levels.forEach((v, i) => { const h = Math.max(1, v * 60); g.fillRect(i * c.width / levels.length, (64 - h) / 2, Math.max(1, c.width / levels.length - 0.5), h); });
      }

      // -- an audio file: player, loudness strip, the system's suggestion -----
      if (o.file) {
        url = URL.createObjectURL(o.file);
        $('.pk-player').innerHTML = '<audio controls preload="auto"></audio>';
        audio = $('.pk-player audio'); audio.src = url;
        audio.addEventListener('loadedmetadata', () => { dur = audio.duration; setStart(start); });
        note.textContent = 'Слушаю песню, чтобы показать её громкость и предложить момент…';
        TD.music.decodeFile(o.file).then(({ mono, sr }) => {
          if (done) return;
          drawWave(loudness(mono, sr));
          const an = TD.music.analyzeSamples(mono, sr);
          if (!snap && an.bpm) snap = { bpm: an.bpm, beatOffset: an.beatOffset };
          const m = TD.music.findMoment(mono, sr, { length: len, targetEnergy: o.energy == null ? 0.5 : o.energy, bpm: an.bpm });
          if (!m.short) {
            suggestion = m.start;
            note.innerHTML = `Пунктир — предложение системы: <b>${fmt(m.start)}</b>${m.repeats >= 2 ? `, часть, которая звучит в песне ${m.repeats} ${m.repeats < 5 ? 'раза' : 'раз'} (как припев)` : ''}. <button type="button" class="linkish" data-a="suggest">Взять его</button>`;
            if (o.start == null) setStart(m.start);
          } else note.textContent = 'Песня короче воспоминания: она прозвучит целиком.';
          draw();
        }).catch(() => { note.textContent = 'Громкость показать не получилось, но выбрать момент можно.'; });
      } else if (o.link && o.link.youtube) {
        // -- YouTube: the real video, right here --------------------------------
        $('.pk-player').innerHTML = '<div class="pk-yt"><div></div></div>';
        $('.pk-wave').getContext('2d').clearRect(0, 0, 800, 64);
        note.textContent = 'Можно мотать прямо в плеере YouTube и нажать «Это мой момент» в нужном месте.';
        loadYouTube().then((YT) => {
          if (done) return;
          yt = new YT.Player($('.pk-yt div'), {
            videoId: o.link.youtube, width: '100%', height: '100%', playerVars: { start: Math.floor(start), playsinline: 1, rel: 0 },
            events: {
              onError: (e) => { ytError = e.data; },
              onReady: () => {
                const wait = () => { if (done) return; const d = yt.getDuration(); if (d > 0) { dur = d; setStart(start); } else setTimeout(wait, 300); };
                wait();
              },
            },
          });
        }).catch((err) => {
          $('.pk-player').innerHTML = `<p class="form-error">YouTube не загрузился (${esc(err.message)}). Впишите время вручную ниже или откройте песню на YouTube в другой вкладке.</p>`;
          track.hidden = true; $('[data-a=listen]').disabled = true; $('[data-a=mark]').disabled = true;
          $('[data-a=back]').disabled = true; $('[data-a=fwd]').disabled = true;
        });
      }
      timer = setInterval(tick, 100);
      draw();

      // -- choosing on the timeline: click, drag, keys -------------------------
      let grab = null;
      const timeAt = (e) => { const r = track.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * (dur || 0); };
      track.addEventListener('pointerdown', (e) => {
        if (!dur) return;
        const t = timeAt(e);
        grab = t >= start && t <= start + len ? t - start : 0; // inside the window: drag it; outside: start there
        setStart(t - grab);
        preview(false);
        track.setPointerCapture(e.pointerId);
      });
      track.addEventListener('pointermove', (e) => { if (grab != null) { setStart(timeAt(e) - grab); preview(false); } });
      const release = () => { if (grab != null) preview(true); grab = null; };
      track.addEventListener('pointerup', release); track.addEventListener('pointercancel', release);
      track.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 5 : 1;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { setStart(start - step); preview(false); e.preventDefault(); }
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { setStart(start + step); preview(false); e.preventDefault(); }
        if (e.key === 'Home') { setStart(0); preview(true); e.preventDefault(); }
      });
      input.addEventListener('change', () => { const t = TD.music.parseTime(input.value); if (t != null) { setStart(t); preview(true); } else input.value = fmt(start); });

      // -- buttons ----------------------------------------------------------------
      function finish(result) {
        if (done) return;
        done = true;
        clearInterval(timer);
        pauseSong();
        if (yt && yt.destroy) yt.destroy();
        if (url) URL.revokeObjectURL(url);
        if (dlg.open) dlg.close();
        dlg.remove();
        resolve(result);
      }
      dlg.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]');
        if (!a) return;
        const act = a.dataset.a;
        if (act === 'back') { setStart(start - 5); preview(true); }
        if (act === 'fwd') { setStart(start + 5); preview(true); }
        if (act === 'suggest' && suggestion != null) { setStart(suggestion); preview(true); }
        if (act === 'mark') { setStart(now() - 0.3); previewing = true; } // a person taps a moment a little late; keep playing, now looping
        if (act === 'listen') {
          if (isPlaying()) { pauseSong(); previewing = false; }
          else preview(true);
        }
        if (act === 'cancel') finish(null);
        if (act === 'done') {
          const t = TD.music.parseTime(input.value);
          if (t != null && Math.abs(t - start) >= 1) setStart(t);
          const snapped = snap ? Math.min(snapToBeat(start, snap.bpm, snap.beatOffset), maxStart()) : start;
          finish({ start: +snapped.toFixed(3), snapped: !!snap });
        }
      });
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); }); // Esc
      dlg.state = () => ({ start, now: now(), previewing, playing: isPlaying(), dur, ytState: yt && yt.getPlayerState ? yt.getPlayerState() : null, ytError });
      dlg.showModal();
      track.focus();
    });
  }

  /** Which songs the window can open: an audio file, or a YouTube link. */
  const canPick = (link, file) => !!(file || (link && link.youtube));

  TD.moment = { pick, canPick, loadYouTube, snapToBeat, loudness, fmt };
})(globalThis.TD = globalThis.TD || {});
