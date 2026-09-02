// api/fetch-news.js
//
// Trigger manually by visiting:
//   https://golf-tennis-weekly.vercel.app/api/fetch-news?secret=YOUR_SECRET
// Also runs automatically via the daily cron in vercel.json.
//
// Fetches Google News RSS for golf and tennis directly, server-side —
// no CORS proxy needed here at all, since CORS only applies to browser
// requests. This replaced an earlier client-side version that depended
// on free CORS-proxy services (allorigins.win, rss2json) which both
// turned out too unreliable for daily production use.

import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

async function fetchNewsForSport(sport) {
  const query = sport === 'golf' ? '"PGA Tour" OR "LPGA" golf' : '"ATP" OR "WTA" tennis';
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

  const res = await fetch(rssUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
  });
  if (!res.ok) throw new Error(`Google News fetch failed (${res.status}) for ${sport}`);
  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  const rows = [];
  $('item').slice(0, 10).each((_, el) => {
    const rawTitle = $(el).find('title').first().text();
    const link = $(el).find('link').first().text();
    const pubDate = $(el).find('pubDate').first().text();
    const sourceTag = $(el).find('source').first().text();
    if (!rawTitle) return;

    const cleanTitle = rawTitle.replace(/\s*-\s*[^-]+$/, '').trim() || rawTitle;
    const source = sourceTag || rawTitle.match(/\s*-\s*([^-]+)$/)?.[1]?.trim() || 'Google News';
    const publishedAt = pubDate ? new Date(pubDate).toISOString() : null;

    rows.push({
      sport,
      title: cleanTitle,
      source,
      link,
      published_at: publishedAt,
    });
  });

  return rows;
}

async function upsertRows(supabase, rows) {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('gtw_news')
    .upsert(rows, { onConflict: 'sport,title' });
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
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
  const allRows = [];

  for (const sport of ['golf', 'tennis']) {
    try {
      const rows = await fetchNewsForSport(sport);
      allRows.push(...rows);
      summary[sport] = rows.length;
    } catch (err) {
      summary.errors.push(`${sport}: ${err.message}`);
    }
  }

  try {
    await upsertRows(supabase, allRows);
  } catch (err) {
    summary.errors.push(`upsert: ${err.message}`);
    return res.status(500).json(summary);
  }

  return res.status(200).json({ ...summary, totalRowsWritten: allRows.length });
}
