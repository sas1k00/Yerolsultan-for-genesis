/* Тот день — folder names. One tone for every day: a noun phrase of 3–7 words,
 * no verbs, capital first letter, no final punctuation.
 * Templates are tried in a fixed order; the first that fits wins, so the same
 * entry always gets the same name.
 */
(function (TD) {
  'use strict';
  const L = TD.LEX;

  const MOOD_ADJ = {
    calmPos: { m: 'тёплый', f: 'тёплая', n: 'тёплое', p: 'тёплые' },
    calmNeg: { m: 'тихий', f: 'тихая', n: 'тихое', p: 'тихие' },
    loudPos: { m: 'яркий', f: 'яркая', n: 'яркое', p: 'яркие' },
    loudNeg: { m: 'долгий', f: 'долгая', n: 'долгое', p: 'долгие' },
  };
  const TIME_NOUN = { morning: ['утро', 'n'], day: ['день', 'm'], evening: ['вечер', 'm'], night: ['ночь', 'f'] };
  const PRECIP = ['rain', 'snow', 'fog'];

  const words = (s) => s.trim().split(/\s+/).filter(Boolean);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function moodAdj(mood, g) {
    const key = (mood.energy >= 0.5 ? 'loud' : 'calm') + (mood.valence >= 0 ? 'Pos' : 'Neg');
    return MOOD_ADJ[key][g];
  }

  /** @param t  result of analyzeText  @param mood {valence, energy} combined mood */
  function makeTitle(t, mood) {
    const [timeNoun, timeG] = TIME_NOUN[t.time || 'day'];
    const season = t.season ? L.SEASON[t.season].adj : null;
    const wx = t.weather.find((w) => PRECIP.includes(w));
    const wxAdj = wx ? L.WEATHER[wx].adj : null;
    const place = t.places[0];
    const person = t.people[0];
    // A detail that only repeats the season ("осенний … и листья") is skipped.
    const detail = t.details.find((d) => d.season !== t.season) || null;
    const event = t.events[0];
    const adjFor = (g, preferWeather) => (preferWeather && wxAdj ? wxAdj[g] : season ? season[g] : moodAdj(mood, g));
    const rule = [];

    let title = '', timeFirst = false;
    if (event && event.nom && person) {
      title = `${event.nom} ${person.with}`; rule.push('событие + люди');
    } else if (event && place && !place.home) {
      title = `${timeNoun} ${place.loc} ${event.phrase}`; timeFirst = true; rule.push('время суток + место + событие');
    } else if (event) {
      title = `${adjFor(timeG)} ${timeNoun} ${event.phrase}`; rule.push('сезон + время суток + событие');
    } else if (place && place.home && detail) {
      title = `${adjFor(timeG, true)} ${timeNoun} ${place.loc} ${detail.with}`; rule.push('погода + время суток + дом + деталь');
    } else if (place && person) {
      title = `${timeNoun} ${place.loc} ${person.with}`; timeFirst = true; rule.push('время суток + место + люди');
    } else if (place && detail && !place.proper) {
      title = `${adjFor(place.g)} ${place.nom} и ${detail.nom}`; rule.push('сезон + место + деталь');
    } else if (place) {
      title = `${adjFor(timeG, true)} ${timeNoun} ${place.loc}`; rule.push('погода/сезон + время суток + место');
    } else if (person) {
      title = `${adjFor(timeG)} ${timeNoun} ${person.with}`; rule.push('сезон + время суток + люди');
    } else if (detail) {
      title = `${adjFor(timeG)} ${timeNoun} ${detail.with}`; rule.push('сезон + время суток + деталь');
    } else if (t.alone) {
      title = `${moodAdj(mood, timeG)} ${timeNoun} в одиночестве`; rule.push('настроение + время суток + одиночество');
    } else {
      title = `${moodAdj(mood, timeG)} ${season ? season[timeG] + ' ' : ''}${timeNoun}`; rule.push('настроение + сезон + время суток');
    }

    // Length rule: 3–7 words.
    let w = words(title);
    if (w.length < 4 && season && timeFirst) {
      w.unshift(season[timeG]); rule.push('добавлен сезон до 4+ слов');
    }
    if (w.length < 3) { w.unshift(moodAdj(mood, timeG)); rule.push('добавлено настроение до 3 слов'); }
    if (w.length > 7) { w = w.slice(0, 7); rule.push('обрезано до 7 слов'); }
    title = cap(w.join(' ').replace(/[.,!?;:]+$/, ''));
    return { title, rule: rule.join('; ') };
  }

  TD.makeTitle = makeTitle;
})(globalThis.TD = globalThis.TD || {});
