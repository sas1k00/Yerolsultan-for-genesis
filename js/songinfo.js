/* Тот день — fill in the song from its link (or file name): title, artist,
 * year and genre, so nobody has to type them.
 *   1) Title (and artist where the service gives it): the services' public
 *      oEmbed endpoints. YouTube titles are usually "Artist - Title"; its
 *      "author" is the uploading channel, not the artist. Spotify gives the
 *      title only, so the person types the artist and the year follows.
 *      Only YouTube and Spotify links are accepted (see TD.music.parseLink).
 *   2) Year and genre: Apple's public iTunes Search. Among releases by the same
 *      artist with the same title, the earliest year is the original (a 2014
 *      compilation of a 1964 song is still a 1964 song); the genre most of
 *      them share wins.
 * The pure parts run in Node for tests; the fetches run in the browser.
 */
(function (TD) {
  'use strict';

  // ------------------------------------------------------------- parsing ---
  /** Remove video noise: (Official Video), [Lyrics], (Remastered 2008), HD… */
  function cleanTitle(s) {
    return String(s || '')
      .replace(/\s*[([][^)\]]*(official|video|audio|lyric|lyrics|visuali[sz]er|remaster|remastered|hd|hq|4k|live|клип|текст|премьера|mv|m\/v)[^)\]]*[)\]]/gi, '')
      .replace(/\s*\|\s*.*$/, '')
      .replace(/\s+(official\s+(music\s+)?video|lyrics?|hd|hq)\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^["'«“\s]+|["'»”\s]+$/g, '')
      .trim();
  }
  /** A YouTube channel name is the artist only when it looks like one ("Frank Sinatra - Topic", "AdeleVEVO"). */
  function artistFromChannel(author) {
    const a = String(author || '');
    if (/ - Topic$/i.test(a)) return a.replace(/ - Topic$/i, '').trim();
    if (/VEVO$/i.test(a)) return a.replace(/VEVO$/i, '').replace(/([a-zа-я])([A-ZА-Я])/g, '$1 $2').trim();
    return null;
  }
  /** "Artist - Title" (also –, —, ‒) → {artist, title}; otherwise title only. */
  function splitArtistTitle(raw, author) {
    const t = cleanTitle(raw);
    const m = t.match(/^(.+?)\s+[-–—‒]\s+(.+)$/);
    if (m) return { artist: cleanTitle(m[1]).replace(/\s+(ft\.?|feat\.?)\s.*$/i, ''), title: cleanTitle(m[2]) };
    return { artist: artistFromChannel(author), title: t };
  }
  /** An audio file name: "01 Frank Sinatra - The Way You Look Tonight.mp3". */
  function fromFileName(name) {
    const base = String(name || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/^\d{1,3}[\s._-]+/, '').replace(/_/g, ' ');
    const r = splitArtistTitle(base);
    return r.title && r.artist ? r : null; // "song.wav" or "track01.mp3" says nothing: leave the fields alone
  }

  // iTunes genre names → the diary's genres (see TD.music.GENRES).
  const GENRE_MAP = [
    [/k-?pop/i, 'kpop'], [/jazz|vocal|swing|big band|blues/i, 'jazz'], [/classical|opera|orchestra/i, 'classical'],
    [/soundtrack|film|tv|anime|score|musicals?/i, 'soundtrack'], [/hip.?hop|rap|r&b|soul|trap/i, 'hiphop'],
    [/electronic|dance|house|techno|edm|trance|dubstep|drum/i, 'electronic'], [/ambient|new age|meditation|relax/i, 'ambient'],
    [/lo-?fi/i, 'lofi'], [/rock|metal|punk|grunge|alternative/i, 'rock'],
    [/singer|songwriter|folk|indie|country|acoustic/i, 'indie'], [/world|kazakh|central asia|ethnic|traditional/i, 'ethno'],
    [/pop|latin|reggaeton|disco|schlager|estrada|эстрада/i, 'pop'],
  ];
  function genreKey(name) {
    for (const [re, key] of GENRE_MAP) if (re.test(name || '')) return key;
    return null;
  }
  const norm = (s) => cleanTitle(s).toLowerCase().replace(/ё/g, 'е').replace(/\s*[-–—]\s*(remaster|live|version|mono|stereo).*$/i, '')
    .replace(/[^a-zа-яәғқңөұүһі0-9]+/gi, ' ').trim();

  // Cyrillic (Russian and Kazakh) → Latin, the way artists write their names on Apple Music:
  // «Молданазар» → «moldanazar», «Қайрат Нұртас» → «kairat nurtas».
  const LAT = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
    ә:'a',ғ:'g',қ:'k',ң:'n',ө:'o',ұ:'u',ү:'u',һ:'h',і:'i' };
  const translit = (s) => String(s || '').toLowerCase().replace(/[а-яёәғқңөұүһі]/g, (c) => LAT[c] ?? c);
  const hasCyr = (s) => /[а-яёәғқңөұүһі]/i.test(s || '');

  /** From iTunes results: the original year and the usual genre of this song by this artist. */
  function pickRelease(results, artist, title) {
    const rs = (results || []).filter((r) => r && r.trackName && r.artistName && r.releaseDate);
    if (!rs.length) return null;
    const a0 = artist ? norm(artist) : null, t0 = title ? norm(title) : null;
    const sameTitle = (r) => !t0 || norm(r.trackName).startsWith(t0) || t0.startsWith(norm(r.trackName));
    const sameArtist = (r) => {
      if (!a0) return true;
      const b = norm(r.artistName), al = translit(a0), bl = translit(b);
      return b.includes(a0) || a0.includes(b) || bl.includes(al) || al.includes(bl);
    };
    // Without an artist there is no honest answer: «Mahabbatym» alone matches ten singers, and the one
    // with the most releases (Say Mo) is not the one people mean (Moldanazar). So ask, don't guess.
    if (!a0) return null;
    const pool = rs.filter((r) => sameTitle(r) && sameArtist(r));
    if (!pool.length) return null;
    const year = Math.min(...pool.map((r) => parseInt(r.releaseDate, 10)).filter((y) => y > 1800));
    const votes = {};
    pool.forEach((r) => { const k = genreKey(r.primaryGenreName); if (k) votes[k] = (votes[k] || 0) + 1; });
    const genre = Object.keys(votes).sort((x, y) => votes[y] - votes[x])[0] || null;
    const best = pool[0];
    return { year: isFinite(year) ? year : null, genre, genreName: best.primaryGenreName, artist: best.artistName, title: cleanTitle(best.trackName) };
  }

  // ------------------------------------------------------------ fetching ---
  async function getJSON(url, ms = 8000) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { if (timer) clearTimeout(timer); }
  }
  const enc = encodeURIComponent;

  /** Title and artist from the link itself. */
  async function fromLink(link) {
    if (!link) return null;
    const u = link.open;
    if (link.youtube) {
      const d = await getJSON(`https://www.youtube.com/oembed?url=${enc(u)}&format=json`);
      return { ...splitArtistTitle(d.title, d.author_name), from: 'YouTube' };
    }
    if (/spotify/i.test(link.platform)) {
      const d = await getJSON(`https://open.spotify.com/oembed?url=${enc(u)}`);
      return { title: cleanTitle(d.title), artist: null, from: 'Spotify' };
    }
    return null;
  }

  /** Year and genre for a known title (and artist, if any). */
  async function release(artist, title) {
    if (!title) return null;
    const term = [artist, title].filter(Boolean).join(' ');
    const d = await getJSON(`https://itunes.apple.com/search?term=${enc(term)}&entity=song&limit=25`);
    const r = pickRelease(d.results, artist, title);
    if (r || !hasCyr(term)) return r;
    // «Молданазар Mahabbatym» finds nothing: Apple Music spells him «Moldanazar». Try it in Latin.
    const d2 = await getJSON(`https://itunes.apple.com/search?term=${enc(translit(term))}&entity=song&limit=25`);
    return pickRelease(d2.results, artist, title);
  }

  /** Everything at once; each step is optional, nothing throws. */
  async function lookup({ link, fileName }) {
    let base = null;
    try { base = link ? await fromLink(link) : fromFileName(fileName); } catch (e) { base = null; }
    if (!base && fileName) base = fromFileName(fileName);
    if (!base || !base.title) return null;
    let rel = null;
    try { rel = await release(base.artist, base.title); } catch (e) { rel = null; }
    return {
      title: base.title, artist: base.artist || null,
      year: rel ? rel.year : null, genre: rel ? rel.genre : null, genreName: rel ? rel.genreName : null, from: base.from || 'имени файла',
    };
  }

  /** YouTube returns titles with HTML entities ("Rock &amp; Roll", "Don&#39;t"). */
  function decodeEntities(s) {
    return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  /** Search YouTube for a song by its name (needs TD.config.youtubeApiKey). Only videos
   *  that may play inside other sites, so the synced player works with them. */
  async function searchYouTube(q, key) {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=5&q=${enc(q)}&key=${enc(key)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const why = (d.error && d.error.errors && d.error.errors[0] && d.error.errors[0].reason) || ('HTTP ' + r.status);
      throw new Error(why === 'quotaExceeded' ? 'на сегодня поиски YouTube закончились' : why === 'keyInvalid' ? 'ключ YouTube неверный' : /referer|referrer/i.test(why) ? 'ключ YouTube не разрешён для этого сайта' : why);
    }
    return (d.items || []).filter((it) => it.id && it.id.videoId).map((it) => ({
      id: it.id.videoId, title: decodeEntities(it.snippet.title), channel: decodeEntities(it.snippet.channelTitle),
      thumb: ((it.snippet.thumbnails || {}).default || {}).url || '',
    }));
  }

  TD.songinfo = { lookup, searchYouTube, decodeEntities, fromLink, release, cleanTitle, splitArtistTitle, fromFileName, pickRelease, genreKey, translit };
})(globalThis.TD = globalThis.TD || {});
