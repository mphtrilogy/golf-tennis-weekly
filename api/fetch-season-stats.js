// api/fetch-season-stats.js
//
// Trigger manually by visiting:
//   https://golf-tennis-weekly.vercel.app/api/fetch-season-stats?secret=YOUR_SECRET
// Also runs automatically via the daily cron in vercel.json.
//
// Season earnings and FedEx Cup points aren't in the rankings feed —
// they come from ESPN's per-athlete stats endpoint, which lists every
// tournament a player entered this season with that week's money and
// points earned. Summed across the season, that's the real total.
// Golf only for now — tennis's equivalent hasn't been verified yet,
// deliberately not assumed to work the same way.

import { createClient } from '@supabase/supabase-js';

const STATS_BASE = 'https://site.web.api.espn.com/apis/common/v3/sports/golf/athletes';

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

async function fetchSeasonStatsForAthlete(espnId, season) {
  const res = await fetch(`${STATS_BASE}/${espnId}/stats?season=${season}`);
  if (!res.ok) return null;
  const data = await res.json();

  let earnings = 0;
  let cupPoints = 0;
  for (const league of data.leaguesStats || []) {
    for (const event of league.eventsStats || []) {
      const stats = event.competitions?.[0]?.competitors?.[0]?.stats || [];
      const amount = stats.find((s) => s.name === 'officialAmount')?.value;
      const points = stats.find((s) => s.name === 'cupPoints')?.value;
      if (typeof amount === 'number') earnings += amount;
      if (typeof points === 'number') cupPoints += points;
    }
  }
  return { earnings, cupPoints };
}

async function fetchAndStoreSeasonStats(supabase, season) {
  // Pull whichever golfers we already have real ESPN IDs for, from the
  // most recent OWGR snapshot — no separate "who to look up" list needed.
  const { data: rankingRows, error } = await supabase
    .from('gtw_rankings_snapshots')
    .select('player_name, espn_id, week_of')
    .eq('sport', 'golf')
    .eq('tour', 'owgr')
    .not('espn_id', 'is', null)
    .order('week_of', { ascending: false })
    .limit(300);
  if (error) throw new Error(`Reading rankings for season stats failed: ${error.message}`);
  if (!rankingRows || rankingRows.length === 0) throw new Error('No golf rankings with espn_id found yet');

  const latestWeek = rankingRows[0]?.week_of;
  const players = rankingRows.filter((r) => r.week_of === latestWeek);

  const results = await mapWithLimit(players, 5, async (p) => {
    const stats = await fetchSeasonStatsForAthlete(p.espn_id, season);
    if (!stats) return null;
    return {
      sport: 'golf',
      tour: 'owgr',
      player_name: p.player_name,
      season_earnings: stats.earnings,
      fedex_cup_points: stats.cupPoints,
      season_year: season,
    };
  });

  const rows = results.filter(Boolean);
  if (rows.length === 0) throw new Error('Season stats fetch returned nothing usable');

  const { error: upsertErr } = await supabase
    .from('gtw_season_stats')
    .upsert(rows, { onConflict: 'sport,tour,player_name,season_year' });
  if (upsertErr) throw new Error(`Supabase upsert failed: ${upsertErr.message}`);

  return rows.length;
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
  const season = new Date().getFullYear();

  try {
    const count = await fetchAndStoreSeasonStats(supabase, season);
    return res.status(200).json({ golf: count, season });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
