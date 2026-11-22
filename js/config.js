/* Тот день — settings you can fill in yourself.
 *
 * youtubeApiKey: lets «Найти на YouTube» show matching videos right in the form.
 * Without it, the button opens YouTube's own search in a new tab instead.
 *
 * A browser key is public by nature (it ships inside the page), so in Google
 * Cloud restrict it to this site's address and to "YouTube Data API v3" only.
 * The free quota is 10,000 units a day; one search costs 100 → about 100
 * searches a day. Steps: see README, «Поиск песни на YouTube».
 */
globalThis.TD = globalThis.TD || {};
TD.config = {
  youtubeApiKey: 'AIzaSyDkDkeuPlglABBC1OSFRyYjHtzIxmhhP7o',
};
