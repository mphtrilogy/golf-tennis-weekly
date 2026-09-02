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

  // Next scheduled event from ESPN's own calendar — captured regardless
  // of whether a tournament is actively playing right now, so a
  // mid-season gap (e.g. between the Tour Championship and the next
  // fall event) still has something real to show instead of nothing.
  const calendar = data.leagues?.[0]?.calendar || [];
  const now = Date.now();
  const upcoming = calendar
    .filter((e) => new Date(e.startDate).getTime() > now)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))[0];
  const nextEvent = upcoming ? { event_name: upcoming.label, start_date: upcoming.startDate } : null;

  const event = data.events?.[0];
  if (!event) return { rows: [], nextEvent };

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

  return { rows, nextEvent };
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

async function upsertNextEvent(supabase, tour, nextEvent) {
  if (!nextEvent) return;
  const { error } = await supabase
    .from('gtw_next_event')
    .upsert({ sport: 'golf', tour, ...nextEvent }, { onConflict: 'sport,tour' });
  if (error) throw new Error(`Supabase next_event upsert failed for ${tour}: ${error.message}`);
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
      const { rows, nextEvent } = await fetchLeaderboardForTour(tour);

      // Next-event info updates independently of the player-row safety
      // check — it's useful even when there's nothing currently playing.
      try {
        await upsertNextEvent(supabase, tour, nextEvent);
      } catch (err) {
        summary.errors.push(`${tour} next_event: ${err.message}`);
      }

      if (rows.length > 0) {
        await replaceRowsForTour(supabase, tour, rows);
        summary[tour] = rows.length;
      } else {
        summary.errors.push(`${tour}: no active tournament right now (calendar gap)`);
      }
    } catch (err) {
      summary.errors.push(`${tour}: ${err.message}`);
    }
  }

  return res.status(200).json(summary);
}
