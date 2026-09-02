// api/fetch-leaderboard.js
//
// Trigger manually by visiting:
//   https://golf-tennis-weekly.vercel.app/api/fetch-leaderboard?secret=YOUR_SECRET
// Also runs automatically via the daily cron in vercel.json.
//
// Pulls the current PGA/LPGA tournament leaderboard from ESPN — this is
// golf's own shape (one event, many competitors ranked by score-to-par),
// distinct from tennis's head-to-head matches, hence its own table and
// its own fetch function.

import { createClient } from '@supabase/supabase-js';

const SITE_BASE = 'https://site.api.espn.com/apis/site/v2/sports/golf';

async function fetchLeaderboardForTour(tour) {
  const res = await fetch(`${SITE_BASE}/${tour}/scoreboard`);
  if (!res.ok) throw new Error(`ESPN golf scoreboard fetch failed (${res.status}) for ${tour}`);
  const data = await res.json();

  const event = data.events?.[0];
  if (!event) return [];

  const tournamentName = event.name;
  const tournamentId = event.id;
  const comp = event.competitions?.[0];
  const statusState = comp?.status?.type?.state || null;
  const statusDetail = comp?.status?.type?.shortDetail || comp?.status?.type?.description || null;

  const rows = (comp?.competitors || []).map((c) => ({
    sport: 'golf',
    tour,
    tournament_name: tournamentName,
    tournament_id: tournamentId,
    status_state: statusState,
    status_detail: statusDetail,
    position: c.order ?? null,
    player_name: c.athlete?.fullName || c.athlete?.displayName || null,
    score_to_par: c.score ?? null,
  })).filter((r) => r.player_name);

  return rows;
}

async function replaceRowsForTour(supabase, tour, rows) {
  if (!rows || rows.length === 0) {
    throw new Error(`Refusing to clear ${tour} leaderboard — new fetch returned nothing`);
  }
  const { error: delErr } = await supabase.from('gtw_leaderboard').delete().eq('tour', tour);
  if (delErr) throw new Error(`Supabase delete failed for ${tour}: ${delErr.message}`);
  const { error: insErr } = await supabase.from('gtw_leaderboard').insert(rows);
  if (insErr) throw new Error(`Supabase insert failed for ${tour}: ${insErr.message}`);
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

  const summary = { pga: 0, lpga: 0, errors: [] };

  for (const tour of ['pga', 'lpga']) {
    try {
      const rows = await fetchLeaderboardForTour(tour);
      await replaceRowsForTour(supabase, tour, rows);
      summary[tour] = rows.length;
    } catch (err) {
      summary.errors.push(`${tour}: ${err.message}`);
    }
  }

  return res.status(200).json(summary);
}
