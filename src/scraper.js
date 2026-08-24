/**
 * scraper.js
 *
 * Fetches https://isimsf.rnu.tn/fra and extracts the "À la une" announcements.
 *
 * IMPORTANT: This structure was confirmed against the REAL live HTML of
 * isimsf.rnu.tn (fetched manually on 2026-08-22). It is plain server-rendered
 * HTML — no JavaScript rendering, no API, no RSS feed exists for this section.
 *
 * Do not "guess-fix" selectors if this breaks in the future — re-inspect the
 * live page (View Source) and update SELECTORS below to match reality.
 */

const cheerio = require('cheerio');

const BASE_URL = 'https://isimsf.rnu.tn/';
const HOME_URL = 'https://isimsf.rnu.tn/';

// French month abbreviations as used on the site -> month index (0-11)
const FR_MONTHS = {
  'jan': 0, 'fév': 1, 'fev': 1, 'mar': 2, 'avr': 3, 'mai': 4, 'jun': 5,
  'jui': 5, 'jul': 6, 'aoû': 7, 'aou': 7, 'sep': 8, 'oct': 9, 'nov': 10,
  'déc': 11, 'dec': 11,
};

/**
 * Turns a day number + French month abbreviation into a full ISO date.
 * The site never prints a year for these entries, so we infer it:
 * assume current year; if that would put the date in the future,
 * assume it was actually last year (handles the Dec -> Jan rollover
 * when checking in early January for a "31 Déc." post).
 */
function inferDate(day, monthAbbrevRaw, now = new Date()) {
  const monthKey = monthAbbrevRaw
    .toLowerCase()
    .replace('.', '')
    .trim()
    .slice(0, 3);

  const monthIndex = FR_MONTHS[monthKey];
  if (monthIndex === undefined) {
    return null; // unrecognized month abbreviation; caller should log & skip year inference
  }

  const dayNum = parseInt(day, 10);
  if (Number.isNaN(dayNum)) return null;

  let year = now.getFullYear();
  let candidate = new Date(Date.UTC(year, monthIndex, dayNum));

  // If the candidate date is more than 1 day in the future, it must be last year.
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (candidate.getTime() > now.getTime() + oneDayMs) {
    year -= 1;
    candidate = new Date(Date.UTC(year, monthIndex, dayNum));
  }

  return candidate.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Parses raw HTML of the ISIMS homepage and returns an array of announcements
 * from the "À la une" section, newest first (as ordered on the page).
 *
 * Only the FIRST article-page is parsed (that's the current/newest page of
 * items — page 2+ is older archive, not needed for new-post detection).
 */
function parseAnnouncements(html, { now = new Date() } = {}) {
  const $ = cheerio.load(html);

  const newsBlock = $('#home_news');
  if (newsBlock.length === 0) {
    throw new Error(
      'SCRAPER_STRUCTURE_CHANGED: #home_news not found. The ISIMS site markup ' +
      'may have changed — re-inspect https://isimsf.rnu.tn/ manually before ' +
      'updating selectors. Refusing to guess.'
    );
  }

  const firstPage = newsBlock.find('.article-page').first();
  if (firstPage.length === 0) {
    throw new Error(
      'SCRAPER_STRUCTURE_CHANGED: .article-page not found inside #home_news.'
    );
  }

  const articles = firstPage.find('.article.plus');
  if (articles.length === 0) {
    throw new Error(
      'SCRAPER_STRUCTURE_CHANGED: no .article.plus elements found. The site ' +
      'may currently have zero announcements, or the markup changed — verify ' +
      'manually before assuming this is expected.'
    );
  }

  const results = [];

  articles.each((_, el) => {
    const article = $(el);

    const day = article.find('.article-date-day').first().text().trim();
    const monthAbbrev = article.find('.article-date-month').first().text().trim();

    // Title: strip the leading "new" badge <img> if present, keep only text
    const titleEl = article.find('.article-title').first().clone();
    titleEl.find('img').remove();
    const title = titleEl.text().trim();

    const descriptionHtml = article.find('.article_desc').first().html();
    const description = descriptionHtml
      ? $('<div>').html(descriptionHtml).text().trim().replace(/\s+/g, ' ')
      : null;

    const relativeHref = article
      .find('.article-content a.styled-btn')
      .first()
      .attr('href');

    if (!relativeHref) {
      // No link means no unique ID -> can't safely dedupe this entry, skip it
      // rather than fabricate an ID.
      return;
    }

    const url = relativeHref.startsWith('http')
      ? relativeHref
      : BASE_URL + relativeHref.replace(/^\//, '');

    const publicationDate = inferDate(day, monthAbbrev, now);

    results.push({
      // The relative href is stable and unique per post — use it as the
      // dedup key (id), independent of any DB-assigned primary key.
      external_id: relativeHref,
      title,
      url,
      publication_date: publicationDate, // 'YYYY-MM-DD' or null if unparseable
      category: null, // not present in the site markup (article-handel is always empty)
      description,
    });
  });

  return results;
}

/**
 * Fetches the live page and parses it. Throws on network failure or on
 * structural parse failure — caller (scheduler) is responsible for catching,
 * logging, and NOT deleting existing data / NOT sending notifications on error.
 */
async function fetchOnce(fetchImpl, timeoutMs) {
  const res = await fetchImpl(HOME_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CampusWatch-Monitor/1.0 (personal use, low-frequency polling)',
    },
    timeout: timeoutMs,
  });

  if (!res.ok) {
    throw new Error(`ISIMS_FETCH_FAILED: HTTP ${res.status} ${res.statusText}`);
  }

  return res.text();
}

async function fetchAnnouncements(fetchImpl = require('node-fetch')) {
  // ISIMS is a Tunisian academic site and can be slow (or briefly flaky) to
  // reach from Render's US/EU datacenter IPs, even when it loads fine from a
  // regular browser. Use a longer timeout and one retry before giving up —
  // monitor.js already handles a genuine failure safely (no data loss, no
  // fake notifications), this just avoids treating a slow response as one.
  const TIMEOUT_MS = 30000;

  let html;
  try {
    html = await fetchOnce(fetchImpl, TIMEOUT_MS);
  } catch (err) {
    console.warn(`[scraper] First attempt failed (${err.message}), retrying once...`);
    await new Promise((r) => setTimeout(r, 3000));
    html = await fetchOnce(fetchImpl, TIMEOUT_MS);
  }

  return parseAnnouncements(html);
}

module.exports = { parseAnnouncements, fetchAnnouncements, inferDate, HOME_URL };
