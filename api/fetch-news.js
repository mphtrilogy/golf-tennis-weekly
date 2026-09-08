// api/fetch-news.js
//
// Trigger manually by visiting:
//   https://golf-tennis-weekly.vercel.app/api/fetch-news?secret=YOUR_SECRET
// Also runs automatically via the daily cron in vercel.json.
//
// Pulls from direct publisher RSS feeds (golf.com, ESPN tennis) rather
// than Google News. Google News' RSS carries no images at all, and its
// <link> URLs are wrapped redirects that only resolve inside a real
// browser — a server-side fetch just lands on Google's own interstitial
// page and grabs Google's logo instead of the article's photo. Direct
// publisher feeds include a proper <enclosure> or <media:content> image
// tag since they're the actual source, not an aggregator — same reason
// nysportsdaily's NY Post feeds always show real photos.

import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

export const config = { maxDuration: 40 };

const FEEDS = {
  // Merged, not just fallback — real breadth from two direct publishers
  // instead of leaning on one. Golfweek's URL follows the same
  // arc/outboundfeeds pattern every other Gannett/USA Today Network
  // site uses (nj.com, silive.com, etc.) — wrapped safely either way,
  // so a wrong guess just yields zero extra items, not a break.
  golf: ['https://golf.com/feed/', 'https://golfweek.usatoday.com/arc/outboundfeeds/rss/'],
  tennis: ['https://www.espn.com/espn/rss/tennis/news', 'https://feeds.bbci.co.uk/sport/tennis/rss.xml'],
};

async function fetchOgImage(url) {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    return $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || null;
  } catch {
    return null;
  }
}

async function fetchOneFeed(url, sport) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
  });
  if (!res.ok) throw new Error(`Feed fetch failed (${res.status}): ${url}`);
  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  const rows = [];
  const items = $('item').slice(0, 25).toArray();
  const feedLabel = new URL(url).hostname.replace('www.', '');

  for (const el of items) {
    const title = $(el).find('title').first().text().trim();
    const link = $(el).find('link').first().text().trim();
    const pubDate = $(el).find('pubDate').first().text().trim();
    const creator = $(el).find('dc\\:creator, creator').first().text().trim();
    if (!title || !link) continue;

    const image =
      $(el).find('media\\:content, content').first().attr('url') ||
      $(el).find('enclosure').first().attr('url') ||
      null;

    rows.push({
      sport,
      title,
      source: creator ? `${creator} (${feedLabel})` : feedLabel,
      link,
      published_at: pubDate ? new Date(pubDate).toISOString() : null,
      image_url: image,
    });
  }

  return rows;
}

// Google News gives real breadth (many outlets, not just one publisher)
// but no images at all, and its <link> is a wrapped redirect that only
// resolves inside a real browser. Neither problem matters here — this
// only feeds the long text list, which never shows images, and linking
// to a Google search for the headline (rather than the raw redirect)
// sidesteps the resolution issue entirely. Same safe pattern already
// used elsewhere in the site family.
async function fetchGoogleNewsBreadth(sport) {
  const query = sport === 'golf' ? '"PGA Tour" OR "LPGA" golf' : '"ATP" OR "WTA" tennis';
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(rssUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  const rows = [];
  $('item').slice(0, 20).each((_, el) => {
    const rawTitle = $(el).find('title').first().text().trim();
    const pubDate = $(el).find('pubDate').first().text().trim();
    const sourceTag = $(el).find('source').first().text().trim();
    if (!rawTitle) return;
    const cleanTitle = rawTitle.replace(/\s*-\s*[^-]+$/, '').trim() || rawTitle;
    const source = sourceTag || rawTitle.match(/\s*-\s*([^-]+)$/)?.[1]?.trim() || 'Google News';
    rows.push({
      sport,
      title: cleanTitle,
      source,
      link: `https://news.google.com/search?q=${encodeURIComponent(cleanTitle)}&hl=en-US`,
      published_at: pubDate ? new Date(pubDate).toISOString() : null,
      image_url: null,
    });
  });
  return rows;
}

async function fetchNewsForSport(sport) {
  const collected = [];
  let anySucceeded = false;

  for (const url of FEEDS[sport]) {
    try {
      const rows = await fetchOneFeed(url, sport);
      if (rows.length > 0) { collected.push(...rows); anySucceeded = true; }
    } catch {
      // One source failing doesn't stop the others — this is exactly
      // the redundancy multiple sources are for.
    }
  }
  if (!anySucceeded) throw new Error(`All feeds for ${sport} returned zero items`);

  const merged = dedupeByTitle(collected).sort(
    (a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0)
  );

  // Only the top-5 featured slots render images — worth the extra
  // fetch there for anything the feed itself didn't already provide.
  for (let i = 0; i < Math.min(5, merged.length); i++) {
    if (!merged[i].image_url) merged[i].image_url = await fetchOgImage(merged[i].link);
  }

  const breadth = await fetchGoogleNewsBreadth(sport).catch(() => []);
  const mergedTitles = new Set(merged.map((r) => r.title));
  const extra = dedupeByTitle(breadth).filter((r) => !mergedTitles.has(r.title));
  return [...merged, ...extra];
}

function dedupeByTitle(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    if (seen.has(r.title)) return false;
    seen.add(r.title);
    return true;
  });
}

async function replaceRowsForSport(supabase, sport, rows) {
  // Only touch the table once we know we have real rows to replace it
  // with — a failed or empty fetch must leave existing data alone
  // rather than wiping it out for nothing.
  if (!rows || rows.length === 0) {
    throw new Error(`Refusing to clear ${sport} rows — new fetch returned nothing`);
  }
  const { error: delErr } = await supabase.from('gtw_news').delete().eq('sport', sport);
  if (delErr) throw new Error(`Supabase delete failed for ${sport}: ${delErr.message}`);
  const { error: insErr } = await supabase.from('gtw_news').insert(rows);
  if (insErr) throw new Error(`Supabase insert failed for ${sport}: ${insErr.message}`);
}

export default async function handler(req, res) {
  const cronAuth = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
  const manualAuth = req.query.secret === process.env.CRON_SECRET;
  if (!cronAuth && !manualAuth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY env var in Vercel.' });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const summary = { golf: 0, tennis: 0, errors: [] };

  for (const sport of ['golf', 'tennis']) {
    try {
      const rows = await fetchNewsForSport(sport);
      await replaceRowsForSport(supabase, sport, rows);
      summary[sport] = rows.length;
    } catch (err) {
      summary.errors.push(`${sport}: ${err.message}`);
    }
  }

  return res.status(200).json(summary);
}
