/* Тот день — application: archive, feed, new day, day view, rules page. */
(function (TD) {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_N = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const fmtDate = (iso) => { const d = new Date(iso + 'T12:00:00'); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  let cleanup = null;

  function toast(msg, ms = 3200) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function loadImg(blob) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('Не удалось открыть фото'));
      im.src = URL.createObjectURL(blob);
    });
  }
  async function shrink(file, max = 1600) {
    const im = await loadImg(file);
    const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    if (k === 1 && /jpe?g/.test(file.type)) { URL.revokeObjectURL(im.src); return file; }
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    URL.revokeObjectURL(im.src);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ------------------------------------------------------------ pipeline ---
  async function buildDay(input, log) {
    log('Читаю запись: настроение, место, люди, время суток');
    const text = TD.analyzeText(input.text, input.date);
    if (input.weather && !text.weather.includes(input.weather)) { text.weather.push(input.weather); text.weatherFromUser = input.weather; }
    log('Смотрю на фото: цвета, свет, контраст');
    const photos = [];
    for (const p of input.photos) photos.push(await shrink(p));
    const imgs = await Promise.all(photos.map(loadImg));
    const pa = TD.photo.analyzePhotos(imgs);
    log(input.song.file ? 'Слушаю песню: темп, лад, громкость' : 'Читаю описание песни');
    let audio = null;
    if (input.song.file) {
      try { audio = await TD.music.analyzeFile(input.song.file); } catch (e) { log('Файл не разобрать, беру описание песни'); }
    }
    const music = TD.music.combineMusic(audio, input.song);
    log('Применяю правила визуальной системы');
    const id = input.id || 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const design = TD.system.design({ text, photos: pa, music, date: input.date, id, rawText: input.text });
    const { title, rule } = TD.makeTitle(text, design.mood);
    design.why.push({ group: 'Название', input: 'Место, люди, событие, сезон из текста', rule: `Шаблон «${rule}», 3–7 слов, без глаголов`, result: `«${title}»` });
    const song = { ...input.song };
    const day = { id, createdAt: Date.now(), date: input.date, rawText: input.text, title, titleRule: rule, caption: text.caption, photos, song, music, analysis: { text, photos: pa, music }, design };
    log('Рисую страницу дня');
    const player = TD.render.createPlayer(document.createElement('canvas'), { day, design, images: imgs });
    await player.prepare();
    day.cover = player.cover();
    imgs.forEach((im) => URL.revokeObjectURL(im.src));
    await TD.store.put(day);
    log(`Сохранено в папку «${title}»`);
    return day;
  }

  async function loadDemo(btn) {
    let list;
    try { list = await (await fetch('demo/days.json')).json(); } catch (e) {
      toast('Примеры загружаются только через сервер: python3 -m http.server (см. README)', 6000); return;
    }
    btn.disabled = true;
    const have = new Set((await TD.store.all()).map((d) => d.id));
    let i = 0;
    for (const d of list) {
      i++;
      if (have.has(d.id)) continue;
      btn.textContent = `Собираю ${i} из ${list.length}…`;
      const photos = await Promise.all(d.photos.map((p) => fetch('demo/' + p).then((r) => r.blob())));
      const sb = await fetch('demo/' + d.song.file).then((r) => r.blob());
      const file = new File([sb], d.song.file.split('/').pop(), { type: 'audio/wav' });
      await buildDay({ id: d.id, date: d.date, text: d.text, photos, weather: '',
        song: { file, fileName: file.name, artist: d.song.artist, title: d.song.title, genre: d.song.genre, year: d.song.year, moodHint: d.song.moodHint || '' } }, () => {});
    }
    route();
  }

  // ------------------------------------------------------------- archive ---
  async function viewArchive() {
    const days = await TD.store.all();
    if (!days.length) {
      app.innerHTML = `<div class="empty"><h1 class="hand">Дневник пока пуст</h1>
        <p>Опишите день, добавьте фото и песню. Система соберёт страницу с атмосферой этого дня и положит её в папку с коротким названием.</p>
        <div class="row"><a class="btn btn-ink btn-big" href="#/new">Записать первый день</a>
        <button class="btn btn-big" id="demo">Загрузить 6 примеров</button></div></div>`;
      $('#demo').onclick = (e) => loadDemo(e.currentTarget);
      return;
    }
    app.innerHTML = `<div class="bar"><input class="search" type="search" placeholder="Найти день: «парк», «снег», «мама»…" aria-label="Поиск по дням">
      <span class="lbl-sm">${days.length} ${days.length % 10 === 1 && days.length % 100 !== 11 ? 'день' : days.length % 10 >= 2 && days.length % 10 <= 4 && (days.length % 100 < 10 || days.length % 100 >= 20) ? 'дня' : 'дней'}</span></div><div id="list"></div>`;
    const draw = (q) => {
      q = (q || '').toLowerCase().trim();
      const shown = days.filter((d) => !q || (d.title + ' ' + d.rawText + ' ' + (d.song.artist || '') + ' ' + (d.song.title || '')).toLowerCase().includes(q));
      let html = '', month = '';
      shown.forEach((d) => {
        const dt = new Date(d.date + 'T12:00:00'), m = `${MONTHS_N[dt.getMonth()]} ${dt.getFullYear()}`;
        if (m !== month) { html += `${month ? '</div>' : ''}<div class="month">${m}</div><div class="grid">`; month = m; }
        html += `<a class="folder" href="#/day/${encodeURIComponent(d.id)}"><div class="tab"></div><div class="body">
          <img src="${d.cover}" alt="Страница дня «${esc(d.title)}»" loading="lazy"><div class="name">${esc(d.title)}</div>
          <div class="meta">${fmtDate(d.date)} · ${esc(d.design.techniqueInfo.name)}</div></div></a>`;
      });
      $('#list').innerHTML = shown.length ? html + '</div>' : '<p class="lede">Ничего не нашлось.</p>';
    };
    draw();
    $('.search').oninput = (e) => draw(e.target.value);
  }

  async function viewFeed() {
    const days = (await TD.store.all()).slice().reverse();
    app.innerHTML = `<h1 class="hand">Лента</h1>
      <p class="lede">Проверка лентой: дни рядом должны выглядеть как дневник одного человека, но каждый день остаётся своим. Постоянно: бумага, дата, окно для фото с уголками, рукописное название, строка песни, печать дня. Меняется: приём, цвет, ритм, фактура, шрифт подписи.</p>
      <div class="feed">${days.map((d) => `<a href="#/day/${encodeURIComponent(d.id)}"><img src="${d.cover}" alt="${esc(d.title)}">
        <div class="name">${esc(d.title)}</div><div class="meta">${fmtDate(d.date)}</div></a>`).join('') || '<p>Пока нет дней.</p>'}</div>`;
  }

  // ------------------------------------------------------------- new day ---
  function viewNew() {
    app.innerHTML = '';
    app.appendChild($('#tpl-new').content.cloneNode(true));
    const f = $('#day-form');
    f.date.value = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    f.genre.innerHTML = '<option value="">не знаю</option>' + Object.entries(TD.music.GENRES).map(([k, g]) => `<option value="${k}">${g.label}</option>`).join('');
    const files = [];
    const thumbs = $('#thumbs');
    const drawThumbs = () => {
      thumbs.innerHTML = '';
      files.forEach((file, i) => {
        const fig = document.createElement('figure');
        const url = URL.createObjectURL(file);
        fig.innerHTML = `<img src="${url}" alt="Фото ${i + 1}"><button type="button" aria-label="Убрать фото">×</button>`;
        fig.querySelector('button').onclick = () => { files.splice(i, 1); drawThumbs(); };
        thumbs.appendChild(fig);
      });
    };
    const addFiles = (list) => {
      [...list].filter((x) => x.type.startsWith('image/')).forEach((x) => files.length < 6 && files.push(x));
      drawThumbs();
    };
    const drop = $('#drop');
    f.photos.onchange = () => addFiles(f.photos.files);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
    // live hint: what the system already understands
    f.text.oninput = () => {
      const t = TD.analyzeText(f.text.value, f.date.value);
      const bits = [t.places[0] && 'место: ' + t.places[0].nom, t.people[0] && 'люди: ' + t.people[0].with, t.time && 'время: ' + { morning: 'утро', day: 'день', evening: 'вечер', night: 'ночь' }[t.time],
        t.weather.length && 'погода: ' + t.weather.length + ' признак(а)', t.hits.length && 'слов о чувствах: ' + t.hits.length].filter(Boolean);
      $('#text-hint').textContent = bits.length ? 'Система видит → ' + bits.join(' · ') : 'Чем конкретнее, тем точнее страница. Минимум одно предложение.';
    };
    // tap tempo
    let taps = [];
    $('#tap').onclick = () => {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2500) taps = [];
      taps.push(now); taps = taps.slice(-9);
      if (taps.length >= 4) {
        const iv = taps.slice(1).map((t, i) => t - taps[i]);
        const bpm = Math.round(60000 / (iv.reduce((a, b) => a + b, 0) / iv.length));
        f.dataset.tap = bpm; $('#tap-out').textContent = `≈ ${bpm} BPM`;
      } else $('#tap-out').textContent = `ещё ${4 - taps.length}…`;
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#form-error');
      const audio = f.audio.files[0] || null;
      const link = f.link.value.trim();
      if (f.text.value.trim().length < 20) return (err.textContent = 'Напишите о дне хотя бы одно предложение.');
      if (!files.length) return (err.textContent = 'Добавьте хотя бы одно фото дня.');
      if (!audio && !link) return (err.textContent = 'Добавьте песню: ссылку или аудиофайл.');
      if (link && !TD.music.parseLink(link)) return (err.textContent = 'Ссылка на песню выглядит неправильно.');
      err.textContent = '';
      f.hidden = true;
      const box = $('#building'); box.hidden = false;
      const logEl = $('#build-log');
      const log = (s) => { $('#build-step').textContent = s + '…'; logEl.insertAdjacentHTML('beforeend', `<li>${esc(s)}</li>`); };
      try {
        const day = await buildDay({
          date: f.date.value, text: f.text.value.trim(), photos: files, weather: f.weather.value,
          song: { file: audio, fileName: audio && audio.name, link, artist: f.artist.value.trim(), title: f.title.value.trim(),
            genre: f.genre.value, year: f.year.value ? +f.year.value : null, moodHint: f.moodHint.value, tempoHint: f.tempoHint.value,
            tapBpm: f.dataset.tap ? +f.dataset.tap : null },
        }, log);
        location.hash = '#/day/' + encodeURIComponent(day.id);
      } catch (ex) {
        console.error(ex);
        f.hidden = false; box.hidden = true;
        err.textContent = 'Не получилось собрать день: ' + ex.message;
      }
    };
  }

  // ----------------------------------------------------------------- day ---
  async function viewDay(id) {
    const day = await TD.store.get(id);
    if (!day) { location.hash = '#/'; return; }
    const all = await TD.store.all();
    const idx = all.findIndex((d) => d.id === id);
    const D = day.design, s = day.song || {}, t = day.analysis.text, m = day.music;
    const link = TD.music.parseLink(s.link);
    const urls = [];
    const imgs = await Promise.all(day.photos.map(loadImg));
    imgs.forEach((im) => urls.push(im.src));
    const tree = [`запись.txt`, ...day.photos.map((_, i) => `фото-${i + 1}.jpg`), s.file ? `песня (${esc(s.fileName || 'аудио')})` : null,
      `песня.txt${link ? ' — ' + esc(link.platform) : ''}`, 'воспоминание-обложка.jpg', day.video ? 'воспоминание.webm' : null,
      `озвучка.txt — голос «${esc(D.voice.label)}»`, 'правила-оформления.json'].filter(Boolean);
    const groups = {};
    D.why.forEach((w) => (groups[w.group] = groups[w.group] || []).push(w));
    const chips = [
      D.labels.season && 'сезон: ' + D.labels.season + (t.seasonFrom === 'date' ? ' (по дате)' : ''), D.labels.time && 'время: ' + D.labels.time,
      ...D.labels.weather.map((w) => 'погода: ' + w), ...t.places.slice(0, 3).map((p) => 'место: ' + p.nom), ...t.people.slice(0, 3).map((p) => 'люди: ' + p.with),
      ...t.details.slice(0, 4).map((d) => 'деталь: ' + d.nom), ...t.events.slice(0, 2).map((e) => 'событие: ' + e.phrase), t.alone && 'один/одна',
      m.bpm && Math.round(m.bpm) + ' BPM', m.mode && (m.mode === 'major' ? 'мажор' : 'минор'), m.key && 'тональность ' + m.key,
      'энергия песни ' + m.energy, 'фото: ' + day.photos.length,
    ].filter(Boolean);

    app.innerHTML = `<div class="day">
      <div class="stage">
        <div class="frame"><canvas aria-label="Анимированная страница дня"></canvas>
          <button class="play-cover" id="play">▶ Открыть день<span>${s.file ? 'со звуком' : 'песня — в плеере ниже'}</span></button></div>
        <div class="controls">
          <button class="btn" id="pp" disabled>❚❚ Пауза</button>
          <button class="btn" id="speak" ${TD.voice.supported ? '' : 'disabled'}>Озвучить запись</button>
          <button class="btn" id="zip">Папка дня .zip</button>
          <button class="btn" id="rec">Записать видео</button>
        </div>
        ${link ? `<div class="embed">${link.embed ? `<iframe src="${esc(link.embed)}" allow="autoplay; encrypted-media; clipboard-write" loading="lazy" title="Песня дня"></iframe>` : ''}
          <a class="btn btn-ghost" href="${esc(link.open)}" target="_blank" rel="noopener">Открыть песню · ${esc(link.platform)}</a></div>` : ''}
      </div>
      <div class="side">
        <div class="date">${fmtDate(day.date)}</div>
        <h1>${esc(day.title)}</h1>
        <div class="box"><h2>Папка дня</h2><div class="hand" style="font-size:24px">📁 ${esc(day.title)}</div>
          <ul class="tree">${tree.map((x) => `<li>${x}</li>`).join('')}</ul></div>
        <div class="box"><h2>Запись</h2><p class="entry">${esc(day.rawText)}</p></div>
        <div class="box"><h2>Почему день выглядит так</h2><ul class="why">${D.why.map((w) => `<li><span class="g">${esc(w.group)}</span>
          <span><b>${esc(w.input)}</b> → ${esc(w.rule)}<br><span class="r">${esc(w.result)}</span></span></li>`).join('')}</ul></div>
        <div class="box"><h2>Что система увидела</h2><div class="facts">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
          <h2 style="margin-top:14px">Палитра дня (из фото, окрашена настроением)</h2>
          <div class="swatches">${D.palette.colors.map((c) => `<i style="background:${TD.color.hex(c)}" title="${TD.color.hex(c)}"></i>`).join('')}
          <i style="background:${TD.color.hex(D.palette.accent)};outline:2px solid var(--ink)" title="акцент"></i></div></div>
        <div class="nav-days">
          ${all[idx + 1] ? `<a class="btn btn-ghost" href="#/day/${encodeURIComponent(all[idx + 1].id)}">← ${esc(all[idx + 1].title)}</a>` : '<span></span>'}
          ${all[idx - 1] ? `<a class="btn btn-ghost" href="#/day/${encodeURIComponent(all[idx - 1].id)}">${esc(all[idx - 1].title)} →</a>` : '<span></span>'}
        </div>
        <p style="margin-top:18px"><button class="btn btn-ghost" id="del">Удалить день</button></p>
      </div></div>`;

    const canvas = $('canvas', app);
    const player = TD.render.createPlayer(canvas, { day, design: D, images: imgs });
    await player.prepare();
    player.draw(Math.min(D.motion.shotDur * 0.7, 3), { final: true });

    let audio = null, ac = null, gain = null, dest = null;
    if (s.file) {
      audio = new Audio();
      audio.src = URL.createObjectURL(s.file); urls.push(audio.src);
      audio.loop = true; audio.preload = 'auto';
    }
    const graph = () => {
      if (!audio || ac) return;
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        const src = ac.createMediaElementSource(audio);
        gain = ac.createGain(); src.connect(gain); gain.connect(ac.destination);
        if (ac.createMediaStreamDestination) { dest = ac.createMediaStreamDestination(); gain.connect(dest); }
      } catch (e) { ac = null; }
    };
    const duck = (v) => { if (gain) gain.gain.setTargetAtTime(v, ac.currentTime, 0.25); else if (audio) audio.volume = v; };
    let playing = false;
    const pp = $('#pp');
    const play = async () => {
      graph();
      if (ac && ac.state === 'suspended') await ac.resume();
      if (audio) { try { await audio.play(); } catch (e) { toast('Не удалось включить звук: ' + e.message); } }
      if (!playing && pp.dataset.started) player.resume(); else player.start(audio);
      pp.dataset.started = 1; playing = true; pp.disabled = false; pp.textContent = '❚❚ Пауза';
      $('#play').hidden = true;
    };
    const pause = () => { if (audio) audio.pause(); player.pause(); playing = false; pp.textContent = '▶ Играть'; };
    $('#play').onclick = play;
    pp.onclick = () => (playing ? pause() : play());

    $('#speak').onclick = async (e) => {
      const b = e.currentTarget;
      if (b.dataset.on) { TD.voice.stop(); return; }
      b.dataset.on = 1; b.textContent = '■ Остановить голос';
      if (!playing) await play();
      duck(D.voice.duck);
      try {
        await TD.voice.speak(day.rawText, D.voice, { onstart: (v) => !v && toast('Русский голос в браузере не найден, читаю голосом по умолчанию') });
      } catch (ex) { toast(ex.message); }
      duck(1); delete b.dataset.on; b.textContent = 'Озвучить запись';
    };
    $('#zip').onclick = async () => { const z = await TD.store.folderZip(day); download(z.blob, z.name); };
    $('#rec').onclick = async (e) => {
      const b = e.currentTarget;
      if (!window.MediaRecorder || !canvas.captureStream) return toast('Этот браузер не умеет записывать видео с холста');
      const secs = Math.min(30, audio && isFinite(audio.duration) && audio.duration > 3 ? audio.duration : D.motion.shotDur * Math.max(3, day.photos.length) * 2);
      graph();
      const stream = canvas.captureStream(30);
      if (dest) dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((x) => MediaRecorder.isTypeSupported(x));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : undefined);
      const chunks = [];
      rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
      const done = new Promise((r) => (rec.onstop = r));
      b.disabled = true;
      if (audio) audio.currentTime = 0;
      player.stop(); player.pause();
      await play();
      player.start(audio);
      rec.start(250);
      const t0 = Date.now();
      const tick = setInterval(() => (b.textContent = `● Запись ${Math.ceil(secs - (Date.now() - t0) / 1000)} с`), 250);
      await new Promise((r) => setTimeout(r, secs * 1000));
      rec.stop(); await done; clearInterval(tick);
      const blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
      day.video = blob; await TD.store.put(day);
      b.disabled = false; b.textContent = 'Записать видео';
      download(blob, `${day.date}_${TD.store.translit(day.title)}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
      toast('Видео сохранено в папку дня');
    };
    $('#del').onclick = async () => {
      if (!confirm(`Удалить день «${day.title}»? Это нельзя отменить.`)) return;
      await TD.store.del(day.id); location.hash = '#/';
    };

    cleanup = () => {
      player.stop(); TD.voice.stop();
      if (audio) { audio.pause(); audio.src = ''; }
      if (ac) ac.close();
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }

  // --------------------------------------------------------------- rules ---
  function viewRules() {
    const T = TD.system.TECHNIQUES;
    app.innerHTML = `<section class="rules"><h1 class="hand">Правила визуальной системы</h1>
      <p class="lede">Каждый день проходит одни и те же правила. Поэтому лента выглядит как дневник одного человека, а каждая страница остаётся своей. Никакого ИИ: только явные правила, которые можно проверить.</p>
      <div class="box"><h2>Постоянно на каждой странице</h2><p>Формат 9:16 (1080×1920). Бумага одного тона и фактуры. Дата и день недели сверху, моноширинный IBM Plex Mono. Окно для фото на одном месте, с бумажными уголками, как фото, вклеенное в дневник. Название папки рукописным Caveat под окном. Строка песни. «Печать дня» в углу: один и тот же круг, в котором точка показывает настроение (лево–право) и энергию (низ–верх).</p></div>
      <div class="box"><h2>Меняется вместе с днём</h2><p>Художественный приём, обработка и палитра фото, фон окна, ритм смены кадров, переходы, пустое пространство, фактура (зерно, засветка, погода), шрифт и анимация подписи, подача голоса.</p></div>
      <div class="box"><h2>Как настроение превращается в приём</h2><table><tr><th>Настроение</th><th>Приём и референс</th><th>Почему передаёт это ощущение</th></tr>
        ${Object.values(T).map((x) => `<tr><td>${esc(x.when)}</td><td><b>${esc(x.name)}</b><br>${esc(x.ref)}</td><td>${esc(x.why)}</td></tr>`).join('')}</table>
        <p class="hint">Настроение = 55 % текст + 30 % музыка + 15 % фото. Энергия = 35 % текст + 45 % музыка + 20 % фото. Граница приёмов: энергия 0,5 и настроение 0.</p></div>
      <div class="box"><h2>Как каждый вход влияет на форму</h2><table><tr><th>Вход</th><th>Что меняет</th></tr>
        <tr><td>Текст: слова о чувствах (с учётом «не», «очень», «немного»)</td><td>настроение и энергию, значит приём</td></tr>
        <tr><td>Текст: тёплые и холодные слова</td><td>сдвиг оттенков к охре или к синему</td></tr>
        <tr><td>Текст: время суток, погода, сезон</td><td>ночью кадр темнее и зернистее; дождь, снег, листопад, туман поверх кадра; засветка на закате</td></tr>
        <tr><td>Текст: место, люди, событие, деталь</td><td>название папки</td></tr>
        <tr><td>Текст: самое «чувственное» предложение</td><td>подпись на странице</td></tr>
        <tr><td>Фото: доминирующие цвета</td><td>палитра дня (из самих фото)</td></tr>
        <tr><td>Фото: яркость, насыщенность, контраст</td><td>15–20 % настроения и энергии</td></tr>
        <tr><td>Музыка: темп (BPM) и доля</td><td>смена кадров точно в доли (2/4/8 долей на кадр), пульсация форм</td></tr>
        <tr><td>Музыка: мажор / минор</td><td>настроение; минор добавляет 10 % пустого пространства</td></tr>
        <tr><td>Музыка: громкость, ударность</td><td>энергия, сила пульсации</td></tr>
        <tr><td>Музыка: год</td><td>плёночное зерно: до 1970 — 50 %, 70–80-е — 38 %, 90–2000-е — 20 %, после 2010 — 8 %</td></tr></table></div>
      <div class="box"><h2>Названия папок</h2><p>Одна интонация: существительное без глагола, 3–7 слов, с большой буквы, без точки. Шаблоны по порядку: событие + люди («День рождения с друзьями»), время + место + событие («Ночь в офисе перед сдачей»), погода + время + дом + деталь («Дождливый день дома с чаем»), время + место + люди («Вечер в парке с Айгерим»), сезон + место + деталь («Осенний парк и какао»), и запасные.</p></div>
      <div class="box"><h2>Голос</h2><p>У дневника один голос рассказчика, как у его автора. Меняется подача: спокойный день читается медленнее и ниже, с паузами до 0,7 с; насыщенный — быстрее и выше, паузы до 0,2 с. Пока звучит голос, музыка приглушается до 22 %.</p></div>
      <div class="box"><h2>Честные ограничения</h2><p>Словарь понимает русский (и немного английский) по основам слов, без морфологии: сарказм и сложные обороты он может прочитать неверно. Анализ лада иногда путает параллельные мажор и минор, поэтому ответ «песня ощущается светлой/тёмной» важнее анализа. Это не психологическая диагностика: система подбирает оформление, а не оценивает человека.</p></div>
    </section>`;
  }

  // -------------------------------------------------------------- router ---
  async function route() {
    if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
    const h = location.hash || '#/';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on',
      (a.dataset.nav === 'archive' && (h === '#/' || h === '')) || (a.dataset.nav === 'feed' && h === '#/feed') || (a.dataset.nav === 'new' && h === '#/new')));
    window.scrollTo(0, 0);
    try {
      if (h.startsWith('#/day/')) await viewDay(decodeURIComponent(h.slice(6)));
      else if (h === '#/new') viewNew();
      else if (h === '#/feed') await viewFeed();
      else if (h === '#/rules') viewRules();
      else await viewArchive();
    } catch (e) {
      console.error(e);
      app.innerHTML = `<p class="form-error">Ошибка: ${esc(e.message)}</p>`;
    }
  }
  window.addEventListener('hashchange', route);
  TD.app = { buildDay, loadDemo, route };
  route();
})(globalThis.TD = globalThis.TD || {});
