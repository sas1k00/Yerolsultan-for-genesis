/* Тот день — fill in the song from its link (or file name): title and artist,
 * so nobody has to type them. Only YouTube and Spotify are used:
 *   - YouTube oEmbed: titles are usually "Artist - Title"; its "author" is the
 *     uploading channel, not the artist (unless "… - Topic" or "…VEVO").
 *   - Spotify oEmbed: the title only, so the person types the artist.
 *   - A file named "Artist - Title.mp3": read from the name, no network.
 * Year and genre are the person's own (optional) answers.
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

  /** Everything at once; each step is optional, nothing throws. */
  async function lookup({ link, fileName }) {
    let base = null;
    try { base = link ? await fromLink(link) : fromFileName(fileName); } catch (e) { base = null; }
    if (!base && fileName) base = fromFileName(fileName);
    if (!base || !base.title) return null;
    return { title: base.title, artist: base.artist || null, from: base.from || 'имени файла' };
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

  TD.songinfo = { lookup, searchYouTube, decodeEntities, fromLink, cleanTitle, splitArtistTitle, fromFileName };
})(globalThis.TD = globalThis.TD || {});
