/* Тот день — local archive (IndexedDB) and "папка дня" ZIP export.
 * Nothing leaves the device: no server, no account.
 */
(function (TD) {
  'use strict';
  const DB = 'tot-den', STORE = 'days', VERSION = 1;
  let dbp = null;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then((d) => new Promise((res, rej) => {
      const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
      const out = fn(s);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    }));
  }
  const put = (day) => tx('readwrite', (s) => s.put(day));
  const get = (id) => tx('readonly', (s) => s.get(id));
  const del = (id) => tx('readwrite', (s) => s.delete(id));
  const all = () => tx('readonly', (s) => s.getAll()).then((list) => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt)));

  // ---------------------------------------------------------------- zip ---
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  /** Store-only ZIP with UTF-8 names. files: [{name, data: Uint8Array}] */
  function zip(files) {
    const enc = new TextEncoder(), chunks = [], central = [];
    let offset = 0;
    const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach((f) => {
      const name = enc.encode(f.name), data = f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      chunks.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const csize = central.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
  }

  const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  /** ASCII file name: some browsers drop non-Latin download names. The folder inside keeps the Russian title. */
  const translit = (s) => s.toLowerCase().split('').map((c) => (TR[c] !== undefined ? TR[c] : c)).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const safe = (s) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
  function dataUrlBytes(url) {
    const b = atob(url.split(',')[1]), u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }
  const extOf = (blob, fallback) => {
    const t = (blob && blob.type) || '';
    return t.includes('png') ? 'png' : t.includes('jpeg') || t.includes('jpg') ? 'jpg' : t.includes('webp') ? 'webp'
      : t.includes('mpeg') || t.includes('mp3') ? 'mp3' : t.includes('wav') ? 'wav' : t.includes('ogg') ? 'ogg'
      : t.includes('mp4') || t.includes('m4a') || t.includes('aac') ? 'm4a' : t.includes('webm') ? 'webm' : fallback;
  };

  /** Everything that belongs to the day, in one folder named by the system. */
  async function folderZip(day) {
    const dir = safe(`${day.date} — ${day.title}`) + '/';
    const enc = new TextEncoder();
    const files = [];
    files.push({ name: dir + 'запись.txt', data: enc.encode(`${day.title}\n${day.date}\n\n${day.rawText}\n`) });
    for (let i = 0; i < day.photos.length; i++) files.push({ name: dir + `фото-${i + 1}.${extOf(day.photos[i], 'jpg')}`, data: await bytes(day.photos[i]) });
    const s = day.song || {};
    if (s.file) files.push({ name: dir + `песня.${extOf(s.file, (s.fileName || '').split('.').pop() || 'audio')}`, data: await bytes(s.file) });
    files.push({ name: dir + 'песня.txt', data: enc.encode([`${s.artist || ''} — ${s.title || ''}`, s.link ? 'Ссылка: ' + s.link : '', s.year ? 'Год: ' + s.year : '', s.genre ? 'Жанр: ' + s.genre : ''].filter(Boolean).join('\n') + '\n') });
    if (day.cover) files.push({ name: dir + 'воспоминание-обложка.jpg', data: dataUrlBytes(day.cover) });
    if (day.video) files.push({ name: dir + `воспоминание.${extOf(day.video, 'webm')}`, data: await bytes(day.video) });
    const v = day.design.voice;
    files.push({ name: dir + 'озвучка.txt', data: enc.encode(`Голос: ${v.label}\nСкорость: ${v.rate}\nВысота: ${v.pitch}\nПаузы между фразами: ${v.pause} мс\n\nБраузер синтезирует голос на лету при открытии дня. Записать его в файл браузер не позволяет.\n\n${day.rawText}\n`) });
    files.push({ name: dir + 'правила-оформления.json', data: enc.encode(JSON.stringify({ title: day.title, titleRule: day.titleRule, mood: day.design.mood, technique: day.design.technique, techniqueInfo: day.design.techniqueInfo, motion: day.design.motion, texture: day.design.texture, voice: day.design.voice, why: day.design.why }, null, 2)) });
    return { blob: zip(files), name: `${day.date}_${translit(day.title)}.zip` };
  }

  TD.store = { put, get, del, all, zip, folderZip, crc32, translit };
})(globalThis.TD = globalThis.TD || {});
