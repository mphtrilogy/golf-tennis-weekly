// api/fetch-matches.js
//
// Trigger manually by visiting:
//   https://golf-tennis-weekly.vercel.app/api/fetch-matches?secret=YOUR_SECRET
// Also runs automatically via the daily cron in vercel.json.
//
// Pulls live/scheduled/finished tennis matches from ESPN's scoreboard
// endpoint (ATP + WTA) — real tournaments, rounds, courts, and a
// pre-formatted human-readable score summary per match, straight from
// ESPN's own "notes" field. Server-side, so no CORS proxy needed.

import { createClient } from '@supabase/supabase-js';

const SITE_BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';

async function fetchMatchesForTour(tour) {
  const res = await fetch(`${SITE_BASE}/${tour}/scoreboard`);
  if (!res.ok) throw new Error(`ESPN scoreboard fetch failed (${res.status}) for ${tour}`);
  const data = await res.json();

  const rows = [];
  for (const event of data.events || []) {
    const tournamentName = event.name;
    for (const grouping of event.groupings || []) {
      for (const comp of grouping.competitions || []) {
        const [c1, c2] = comp.competitors || [];
        const summary = comp.notes?.[0]?.text || null;
        rows.push({
          espn_id: comp.id,
          sport: 'tennis',
          tour,
          tournament_name: tournamentName,
          round: comp.round?.displayName || null,
          court: comp.venue?.court || null,
          summary,
          player1: c1?.athlete?.displayName || null,
          player2: c2?.athlete?.displayName || null,
          status_state: comp.status?.type?.state || null,
          status_detail: comp.status?.type?.shortDetail || comp.status?.type?.description || null,
          match_date: comp.date || null,
        });
      }
    }
  }
  return rows;
}

async function upsertRows(supabase, rows) {
  if (rows.length === 0) return;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('gtw_matches')
      .upsert(chunk, { onConflict: 'espn_id' });
    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
  }
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

  const summary = { atp: 0, wta: 0, errors: [] };
  const allRows = [];

  for (const tour of ['atp', 'wta']) {
    try {
      const rows = await fetchMatchesForTour(tour);
      allRows.push(...rows);
      summary[tour] = rows.length;
    } catch (err) {
      summary.errors.push(`${tour}: ${err.message}`);
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
