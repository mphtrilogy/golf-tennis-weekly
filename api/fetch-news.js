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
  golf: 'https://golf.com/feed/',
  tennis: 'https://www.espn.com/espn/rss/tennis/news',
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

async function fetchNewsForSport(sport) {
  const res = await fetch(FEEDS[sport], {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
  });
  if (!res.ok) throw new Error(`Feed fetch failed (${res.status}) for ${sport}`);
  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  const rows = [];
  const items = $('item').slice(0, 10).toArray();

  for (const el of items) {
    const title = $(el).find('title').first().text().trim();
    const link = $(el).find('link').first().text().trim();
    const pubDate = $(el).find('pubDate').first().text().trim();
    const creator = $(el).find('dc\\:creator, creator').first().text().trim();
    if (!title || !link) continue;

    // Real image, straight from the feed — this is the part Google
    // News could never give us.
    let image =
      $(el).find('media\\:content, content').first().attr('url') ||
      $(el).find('enclosure').first().attr('url') ||
      null;

    // Rare fallback: only scrape the article page if the feed itself
    // didn't include an image.
    if (!image) image = await fetchOgImage(link);

    rows.push({
      sport,
      title,
      source: creator ? `${creator} (${sport === 'golf' ? 'Golf.com' : 'ESPN'})` : (sport === 'golf' ? 'Golf.com' : 'ESPN'),
      link,
      published_at: pubDate ? new Date(pubDate).toISOString() : null,
      image_url: image,
    });
  }

  const seen = new Set();
  return rows.filter((r) => {
    if (seen.has(r.title)) return false;
    seen.add(r.title);
    return true;
  });
}

async function replaceRowsForSport(supabase, sport, rows) {
  // Delete-then-insert rather than upsert: news should fully reflect
  // the latest fetch, not accumulate old titles forever (which is what
  // happened switching away from Google News — old rows with different
  // titles just sat there indefinitely and could out-rank fresh ones).
  const { error: delErr } = await supabase.from('gtw_news').delete().eq('sport', sport);
  if (delErr) throw new Error(`Supabase delete failed for ${sport}: ${delErr.message}`);
  if (rows.length === 0) return;
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
