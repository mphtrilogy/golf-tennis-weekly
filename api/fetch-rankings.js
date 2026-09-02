// api/fetch-rankings.js
//
// Trigger this by visiting, in any browser:
//   https://golf-tennis-weekly.vercel.app/api/fetch-rankings?secret=YOUR_SECRET
//
// It pulls current ATP, WTA, and Men's World Golf rankings from ESPN's
// public JSON API and writes them into gtw_rankings_snapshots in Supabase.
// No terminal, no local setup — Vercel runs this file as a small server
// function whenever that URL is visited.
//
// SETUP (one time, in the Vercel dashboard -> this project -> Settings
// -> Environment Variables):
//   SUPABASE_SERVICE_ROLE_KEY = <service role key from Supabase dashboard
//                                 -> Project Settings -> API>
//   CRON_SECRET               = any random string you make up — this is
//                                 just a password so random visitors can't
//                                 trigger the fetch by guessing the URL
//
// (VITE_SUPABASE_URL is already set from the earlier step — this file
// reuses it.)

import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

const ESPN_BASE = 'https://sports.core.api.espn.com/v2/sports';
const ROLEX_RANKINGS_URL = 'https://www.rolexrankings.com/rankings';

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function espnFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN fetch failed (${res.status}): ${url}`);
  return res.json();
}

function publicRef(ref) {
  return ref.replace('sports.core.api.espn.pvt', 'sports.core.api.espn.com');
}

async function resolveAthleteName(ref) {
  try {
    const data = await espnFetch(publicRef(ref));
    return data.displayName || data.fullName || null;
  } catch {
    return null;
  }
}

async function fetchTennisRankings(league) {
  const listUrl = `${ESPN_BASE}/tennis/leagues/${league}/rankings?lang=en&region=us`;
  const list = await espnFetch(listUrl);
  const currentRef = list.items?.[0]?.$ref;
  if (!currentRef) throw new Error(`No current rankings ref for ${league}`);

  const current = await espnFetch(publicRef(currentRef));
  const weekOf = (current.lastUpdated || new Date().toISOString()).slice(0, 10);

  const withNames = await mapWithLimit(current.ranks || [], 8, async (r) => {
    const name = await resolveAthleteName(r.athlete.$ref);
    if (!name) return null;
    return {
      sport: 'tennis',
      tour: league,
      week_of: weekOf,
      rank: r.current,
      player_name: name,
      points: r.points ?? null,
      source: 'primary',
    };
  });

  return withNames.filter(Boolean);
}

async function fetchGolfWorldRankings(season = new Date().getFullYear()) {
  const listUrl = `${ESPN_BASE}/golf/leagues/all/seasons/${season}/rankings/1?lang=en&region=us`;
  const list = await espnFetch(listUrl);
  const latestRef = list.rankings?.[0]?.$ref;
  if (!latestRef) throw new Error('No dated golf rankings ref found');

  const dateMatch = latestRef.match(/dates\/(\d{4})(\d{2})(\d{2})/);
  const weekOf = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : new Date().toISOString().slice(0, 10);

  const current = await espnFetch(publicRef(latestRef));

  const withNames = await mapWithLimit(current.ranks || [], 8, async (r) => {
    const name = await resolveAthleteName(r.athlete.$ref);
    if (!name) return null;
    const totalPoints = r.record?.stats?.find((s) => s.name === 'totalPoints')?.value ?? null;
    return {
      sport: 'golf',
      tour: 'owgr',
      week_of: weekOf,
      rank: r.current,
      player_name: name,
      points: totalPoints,
      source: 'primary',
    };
  });

  return withNames.filter(Boolean);
}

// ---------------------------------------------------------------------
// Golf: Women's World Ranking (Rolex Rankings — the official source
// directly, not ESPN, since ESPN doesn't appear to carry this list).
// Real, clean, server-rendered HTML table — no JS-rendering workaround
// needed, unlike the LPGA's own site.
// ---------------------------------------------------------------------
async function fetchWomensGolfRankings() {
  const res = await fetch(ROLEX_RANKINGS_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GolfTennisWeeklyBot/1.0)' },
  });
  if (!res.ok) throw new Error(`Rolex Rankings fetch failed (${res.status})`);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Pull "Rankings as of YYYY-MM-DD" from the page heading as the real
  // source-of-truth date, rather than guessing today's date.
  const headingText = $('h1, h2').filter((_, el) => /Rankings as of/i.test($(el).text())).first().text();
  const dateMatch = headingText.match(/(\d{4}-\d{2}-\d{2})/);
  const weekOf = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);

  const rows = [];
  // The rankings table's rows — first table on the page is the rankings
  // list. Column order: rank, change, country, player, avg points,
  // total points, events played.
  $('table').first().find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 6) return;
    const rank = parseInt($(cells[0]).text().trim(), 10);
    const playerName = $(cells[3]).find('a').first().text().trim() || $(cells[3]).text().trim();
    const totalPoints = parseFloat($(cells[5]).text().trim());
    if (!rank || !playerName) return;
    rows.push({
      sport: 'golf',
      tour: 'rolex',
      week_of: weekOf,
      rank,
      player_name: playerName,
      points: isNaN(totalPoints) ? null : totalPoints,
      source: 'primary',
    });
  });

  // NOTE: the page currently shows the top 50 only — no pagination link
  // was confirmed during research. Worth revisiting to extend past 50
  // once the real page structure can be inspected for a page-2 pattern.
  return rows;
}

async function upsertRows(supabase, rows) {
  if (rows.length === 0) return;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('gtw_rankings_snapshots')
      .upsert(chunk, { onConflict: 'sport,tour,week_of,player_name' });
    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
  }
}

export default async function handler(req, res) {
  // Vercel Cron Jobs automatically send this header when CRON_SECRET is
  // set — that's the real, automated trigger path. The ?secret= query
  // param still works too, kept around for manual testing in a browser.
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

  const summary = { atp: 0, wta: 0, golf: 0, errors: [] };
  const allRows = [];

  for (const league of ['atp', 'wta']) {
    try {
      const rows = await fetchTennisRankings(league);
      allRows.push(...rows);
      summary[league] = rows.length;
    } catch (err) {
      summary.errors.push(`${league}: ${err.message}`);
    }
  }

  try {
    const rows = await fetchGolfWorldRankings();
    allRows.push(...rows);
    summary.golf = rows.length;
  } catch (err) {
    summary.errors.push(`golf: ${err.message}`);
  }

  try {
    const rows = await fetchWomensGolfRankings();
    allRows.push(...rows);
    summary.golf_women = rows.length;
  } catch (err) {
    summary.errors.push(`golf_women: ${err.message}`);
  }

  try {
    await upsertRows(supabase, allRows);
  } catch (err) {
    summary.errors.push(`upsert: ${err.message}`);
    return res.status(500).json(summary);
  }

  return res.status(200).json({ ...summary, totalRowsWritten: allRows.length });
}
