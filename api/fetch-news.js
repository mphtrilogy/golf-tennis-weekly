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

export const config = { maxDuration: 30 };

const FEEDS = {
  golf: ['https://golf.com/feed/'],
  // ESPN's dedicated tennis "wire" feed appears to sit empty much of
  // the time — BBC Sport's tennis feed is the fallback if so.
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
  const items = $('item').slice(0, 10).toArray();
  const feedLabel = new URL(url).hostname.replace('www.', '');

  for (const el of items) {
    const title = $(el).find('title').first().text().trim();
    const link = $(el).find('link').first().text().trim();
    const pubDate = $(el).find('pubDate').first().text().trim();
    const creator = $(el).find('dc\\:creator, creator').first().text().trim();
    if (!title || !link) continue;

    let image =
      $(el).find('media\\:content, content').first().attr('url') ||
      $(el).find('enclosure').first().attr('url') ||
      null;
    if (!image) image = await fetchOgImage(link);

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

async function fetchNewsForSport(sport) {
  let lastErr = null;
  for (const url of FEEDS[sport]) {
    try {
      const rows = await fetchOneFeed(url, sport);
      if (rows.length > 0) return dedupeByTitle(rows);
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error(`All feeds for ${sport} returned zero items`);
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
