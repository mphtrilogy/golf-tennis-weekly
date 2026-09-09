// api/fetch-golf-tour-calendar.js
//
// Trigger manually by visiting:
//   https://golf-tennis-weekly.vercel.app/api/fetch-golf-tour-calendar?secret=YOUR_SECRET
// Also runs automatically via the weekly cron in vercel.json.
//
// Same pattern as api/fetch-tour-calendar.js (tennis), pointed at golf's
// PGA/LPGA scoreboard endpoints instead. The date-range trick is
// documented as standard across every ESPN sport, but wasn't
// individually live-tested for golf before this — worth confirming
// once actually triggered.

import { createClient } from '@supabase/supabase-js';

const SITE_BASE = 'https://site.api.espn.com/apis/site/v2/sports/golf';
const WINDOW_DAYS = 150;

function fmtDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function fetchCalendarForTour(tour) {
  const today = new Date();
  const end = new Date(today.getTime() + WINDOW_DAYS * 86400000);
  const range = `${fmtDate(today)}-${fmtDate(end)}`;

  const res = await fetch(`${SITE_BASE}/${tour}/scoreboard?dates=${range}`);
  if (!res.ok) throw new Error(`ESPN calendar fetch failed (${res.status}) for ${tour}`);
  const data = await res.json();

  const seen = new Set();
  const rows = [];
  for (const event of data.events || []) {
    const name = event.name;
    const startDate = event.date ? event.date.slice(0, 10) : null;
    const endDate = event.endDate ? event.endDate.slice(0, 10) : startDate;
    if (!name || !startDate) continue;
    const key = `${name}|${startDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ sport: 'golf', tour, tournament_name: name, start_date: startDate, end_date: endDate });
  }
  return rows;
}

async function replaceCalendarForTour(supabase, tour, rows) {
  if (!rows || rows.length === 0) {
    throw new Error(`Refusing to clear ${tour} calendar — new fetch returned nothing`);
  }
  const { error: delErr } = await supabase.from('gtw_golf_tour_calendar').delete().eq('tour', tour);
  if (delErr) throw new Error(`Supabase delete failed for ${tour}: ${delErr.message}`);
  const { error: insErr } = await supabase.from('gtw_golf_tour_calendar').insert(rows);
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
      const rows = await fetchCalendarForTour(tour);
      await replaceCalendarForTour(supabase, tour, rows);
      summary[tour] = rows.length;
    } catch (err) {
      summary.errors.push(`${tour}: ${err.message}`);
    }
  }

  return res.status(200).json(summary);
}
