// api/send-digest.js
//
// The weekly Tuesday send. Fires via cron (see vercel.json) or can be
// triggered manually: /api/send-digest?secret=YOUR_SECRET
//
// Manual triggers:
//   ?secret=...&dryRun=true  — builds everything for real (content,
//     rendering) but skips the actual Resend call AND every database
//     write (no feature marked sent, no send-log entry). Zero
//     real-world side effects. Returns the first subscriber's full
//     rendered HTML as `previewHtml` in the response, so it can be
//     reviewed without risking anything reaching a real inbox.
//   ?secret=...&force=true  — sends for real, skipping the
//     duplicate-send guard (for re-testing an actual send without
//     waiting a week). Does NOT skip emailing subscribers.
//
// Includes: personalization by sport preference, real news headlines,
// live match status for tennis tournaments actually in progress, a
// recap/preview from live tournament data (3 upcoming events, not
// just 1), rankings (men's + women's for both sports, with a real
// Rolex link where women's golf can't be automated), rankings movers
// (🔥/🧊, same logic as the site itself), FedEx Cup standings +
// season earnings for golf, the week's feature article, a real
// "this week in history" or rotating legend spotlight, a rotating
// weekly tip, trivia (100 questions seeded through mid-2027), an
// issue number + date that only increments on a genuine send, the
// week's bigger story leading the issue, a dynamic hook paragraph, a
// real unsubscribe link, a forward-to-a-friend link, cross-promotion
// of the other two newsletters, a hidden preheader line, a dynamic
// subject line, and a duplicate-send guard.
//
// A note on CAN-SPAM: the real unsubscribe link below satisfies the
// requirement that matters most in practice. A physical mailing
// address is also technically required by the same law, but Mike's
// made the call to skip it for now given the actual scale of this
// (a handful of subscribers, no revenue) — worth revisiting if this
// ever grows into something bigger.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'newsletter@gtw.nysportsdaily.com';

// gtw_history only has complete year-by-year champion data for the 8
// actual majors (4 golf, 4 tennis) — not the Players Championship,
// Ryder/Presidents Cup, Davis Cup, or Skins Game, since those never
// got a full historical seed, only current-year rows in gtw_majors.
// So "this week in history" is only ever genuinely real during these
// months; every other month correctly falls back to the rotating
// spotlight below rather than faking a date match that isn't real.
const GOLF_MAJOR_MONTHS = { 4: 'masters', 5: 'pga_championship', 6: 'us_open', 7: 'open_championship' };
const TENNIS_MAJOR_MONTHS = { 1: 'australian_open', 5: 'french_open', 6: 'wimbledon', 7: 'wimbledon', 8: 'us_open', 9: 'us_open' };

async function getHistorySpotlight(supabase, sport) {
  const month = new Date().getUTCMonth() + 1; // 1-12
  const majorMap = sport === 'golf' ? GOLF_MAJOR_MONTHS : TENNIS_MAJOR_MONTHS;
  const majorKey = majorMap[month];

  if (majorKey) {
    // Real date-matched history: pull every champion of this specific
    // major and pick one deterministically by week-of-year, so it
    // rotates through real history rather than showing the same name
    // every time this month comes around.
    const { data } = await supabase
      .from('gtw_history')
      .select('*')
      .eq('sport', sport)
      .eq('major_key', majorKey)
      .order('year', { ascending: true });
    if (data && data.length > 0) {
      const weekOfYear = Math.floor((Date.now() - new Date(new Date().getUTCFullYear(), 0, 1)) / (7 * 86400000));
      const pick = data[weekOfYear % data.length];
      return { ...pick, isDateMatched: true };
    }
  }

  // Rotating spotlight: no major genuinely happening this month, so
  // pull from the full history pool across all majors for this sport
  // instead — framed as a spotlight, not a false "this week" claim.
  const { data: allHistory } = await supabase
    .from('gtw_history')
    .select('*')
    .eq('sport', sport)
    .order('year', { ascending: true });
  if (!allHistory || allHistory.length === 0) return null;
  const weekOfYear = Math.floor((Date.now() - new Date(new Date().getUTCFullYear(), 0, 1)) / (7 * 86400000));
  const pick = allHistory[weekOfYear % allHistory.length];
  return { ...pick, isDateMatched: false };
}

// Rather than write and maintain our own pool of tips, this rotates
// through real, professionally maintained instruction archives —
// linking only to confirmed, stable root sections (never a guessed
// sub-category URL that might not actually exist). The topic framing
// each week is ours to write; the destination is always solid.
const GOLF_TIPS = [
  { topic: 'Driving', source: 'Golf Digest', url: 'https://www.golfdigest.com/how-to' },
  { topic: 'Putting', source: 'Golf.com', url: 'https://golf.com/instruction/' },
  { topic: 'Short Game', source: 'Golf Digest', url: 'https://www.golfdigest.com/how-to' },
  { topic: 'Approach Shots', source: 'Golf.com', url: 'https://golf.com/instruction/' },
  { topic: 'Bunker Play', source: 'Golf.com', url: 'https://golf.com/instruction/' },
  { topic: 'Fitness for Golf', source: 'Golf Digest', url: 'https://www.golfdigest.com/how-to' },
  { topic: 'Beginner Fundamentals', source: 'Golf Digest', url: 'https://www.golfdigest.com/how-to' },
];
const TENNIS_TIPS = [
  { topic: 'Strokes & Technique', source: 'Tennis Channel Academy', url: 'https://www.tennischannel.com' },
  { topic: 'Footwork & Movement', source: 'USTA', url: 'https://www.usta.com' },
  { topic: 'Fitness for Tennis', source: 'Tennis Channel Academy', url: 'https://www.tennischannel.com' },
  { topic: 'Doubles Strategy', source: 'Tennis Channel Academy', url: 'https://www.tennischannel.com' },
  { topic: 'Mental Game', source: 'Tennis Channel Academy', url: 'https://www.tennischannel.com' },
  { topic: 'Getting Started', source: 'ITF Play Tennis', url: 'https://www.itftennis.com' },
];

function getWeeklyTip(sport) {
  const list = sport === 'golf' ? GOLF_TIPS : TENNIS_TIPS;
  const weekOfYear = Math.floor((Date.now() - new Date(new Date().getUTCFullYear(), 0, 1)) / (7 * 86400000));
  return list[weekOfYear % list.length];
}

// Same technique as the site's own PlayerCardAvatar component, just
// running server-side so the email itself can embed a real photo
// rather than linking out to one.
async function fetchWikipediaPhoto(name) {
  if (!name) return null;
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&origin=*&srlimit=1`;
    const searchData = await (await fetch(searchUrl)).json();
    const title = searchData?.query?.search?.[0]?.title;
    if (!title) return null;
    const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    if (!summaryRes.ok) return null;
    const summary = await summaryRes.json();
    return summary?.thumbnail?.source || null;
  } catch {
    return null; // Non-fatal — the section just renders without a photo.
  }
}

const SITE_URL = 'https://golf-tennis-weekly.vercel.app';

function excerptWords(body, wordCount) {
  const plain = body
    .replace(/^#.*$/m, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/---/g, '')
    .replace(/##/g, '')
    .trim();
  const words = plain.split(/\s+/).filter(Boolean);
  return words.slice(0, wordCount).join(' ') + (words.length > wordCount ? '…' : '');
}

// This week's Tuesday, as a date string — the key for the duplicate-send guard.
function thisWeekTuesday() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun..6=Sat
  const diff = (2 - day + 7) % 7; // days until/since Tuesday
  const tue = new Date(now);
  tue.setUTCDate(now.getUTCDate() - ((day + 5) % 7)); // back up to most recent Tuesday
  return tue.toISOString().slice(0, 10);
}

async function getNextUnsentFeature(supabase, sport) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('gtw_features')
    .select('*')
    .eq('sport', sport)
    .is('sent_on', null)
    .lte('published_date', today)
    .order('published_date', { ascending: true })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0];
}

// Surface is a fixed property of each tennis tournament (Wimbledon is
// always grass, the French Open is always clay) - not something any
// live data source gives us, but stable enough to hardcode reliably.
// Matched by substring since tour calendar names vary slightly
// year to year (e.g. sponsor names change). Unmapped events just
// don't show a surface rather than guessing.
const TENNIS_SURFACES = [
  ['Australian Open', 'Hard'],
  ['French Open', 'Clay'], ['Roland-Garros', 'Clay'],
  ['Wimbledon', 'Grass'],
  ['US Open', 'Hard'],
  ['Indian Wells', 'Hard'],
  ['Miami Open', 'Hard'],
  ['Monte Carlo', 'Clay'],
  ['Madrid Open', 'Clay'],
  ['Italian Open', 'Clay'], ['Rome', 'Clay'],
  ['Halle', 'Grass'],
  ['Queen\'s', 'Grass'],
  ['Canadian Open', 'Hard'], ['Rogers Cup', 'Hard'], ['National Bank Open', 'Hard'],
  ['Cincinnati', 'Hard'],
  ['Shanghai', 'Hard'],
  ['Paris Masters', 'Hard (Indoor)'],
  ['ATP Finals', 'Hard (Indoor)'],
  ['WTA Finals', 'Hard (Indoor)'],
  ['Davis Cup', 'Hard (Indoor)'],
];

function getSurfaceFor(tournamentName) {
  if (!tournamentName) return null;
  const match = TENNIS_SURFACES.find(([key]) => tournamentName.includes(key));
  return match ? match[1] : null;
}

async function getRecapAndPreview(supabase, sport) {
  // Recap: most recently completed major, if one wrapped recently.
  // Kept deliberately simple for now — arbitrary non-major weekly
  // recap logic (which regular tour stop just finished) is a real
  // V2 addition, not attempted here.
  const { data: majors } = await supabase
    .from('gtw_majors')
    .select('*')
    .eq('sport', sport)
    .eq('status', 'completed')
    .order('end_date', { ascending: false })
    .limit(1);
  const recap = majors && majors.length > 0 ? majors[0] : null;

  // Preview: next 3 scheduled tournaments from the season calendar,
  // not just the very next one - gives a fuller look at what's coming.
  const calendarTable = sport === 'golf' ? 'gtw_golf_tour_calendar' : 'gtw_tour_calendar';
  const today = new Date().toISOString().slice(0, 10);
  const { data: upcoming } = await supabase
    .from(calendarTable)
    .select('*')
    .gt('start_date', today)
    .order('start_date', { ascending: true })
    .limit(3);
  const preview = upcoming || [];

  return { recap, preview };
}

async function getTriviaForWeek(supabase, sport) {
  const thisWeek = thisWeekTuesday();
  const { data: current } = await supabase
    .from('gtw_trivia')
    .select('question, week_of')
    .eq('sport', sport)
    .eq('week_of', thisWeek)
    .maybeSingle();

  // Last week's answer, shown alongside this week's new question - the
  // same continuity trick nysportsdaily uses for its own trivia.
  const lastWeek = new Date(new Date(thisWeek).getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const { data: previous } = await supabase
    .from('gtw_trivia')
    .select('question, answer')
    .eq('sport', sport)
    .eq('week_of', lastWeek)
    .maybeSingle();

  return { current: current || null, previous: previous || null };
}

async function getTopRankingsForTour(supabase, sport, tour, limit = 3) {
  const { data: latest } = await supabase
    .from('gtw_rankings_snapshots')
    .select('week_of')
    .eq('sport', sport)
    .eq('tour', tour)
    .order('week_of', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return [];
  const { data } = await supabase
    .from('gtw_rankings_snapshots')
    .select('rank, player_name')
    .eq('sport', sport)
    .eq('tour', tour)
    .eq('week_of', latest.week_of)
    .order('rank', { ascending: true })
    .limit(limit);
  return data || [];
}

async function getTopRankings(supabase, sport) {
  if (sport === 'golf') {
    const men = await getTopRankingsForTour(supabase, 'golf', 'owgr');
    return {
      men: men.length > 0 ? { label: "Men's — OWGR", players: men } : null,
      // Women's golf (Rolex Rankings) has never been automatable - the
      // site blocks every scraping approach tried. Same honest call as
      // the site itself: link to the real source instead of faking it.
      women: { label: "Women's — Rolex", linkOnly: true, url: 'https://www.rolexrankings.com/rankings' },
    };
  }

  const men = await getTopRankingsForTour(supabase, 'tennis', 'atp');
  const women = await getTopRankingsForTour(supabase, 'tennis', 'wta');
  return {
    men: men.length > 0 ? { label: "Men's — ATP", players: men } : null,
    women: women.length > 0 ? { label: "Women's — WTA", players: women } : null,
  };
}

async function getFedExStandings(supabase, limit = 5) {
  const season = new Date().getUTCFullYear();
  const { data } = await supabase
    .from('gtw_season_stats')
    .select('player_name, fedex_cup_points, season_earnings')
    .eq('sport', 'golf')
    .eq('season_year', season)
    .order('fedex_cup_points', { ascending: false })
    .limit(limit);
  return data || [];
}

async function getRankingsMovers(supabase, sport, tour) {
  // Same week-over-week logic as the site's own rankings page
  // (1-week lookback, ±3 spots = hot/cold) - just run server-side here.
  const { data: rows } = await supabase
    .from('gtw_rankings_snapshots')
    .select('rank, player_name, week_of')
    .eq('sport', sport)
    .eq('tour', tour)
    .order('week_of', { ascending: false });
  if (!rows || rows.length === 0) return [];

  const weeksAvailable = [...new Set(rows.map((r) => r.week_of))].sort((a, b) => (a < b ? 1 : -1));
  if (weeksAvailable.length < 2) return []; // not enough history yet to show movement

  const currentWeek = weeksAvailable[0];
  const compareWeek = weeksAvailable[1];
  const thisWeekRows = rows.filter((r) => r.week_of === currentWeek).sort((a, b) => a.rank - b.rank);
  const compareRankByName = {};
  for (const r of rows.filter((r) => r.week_of === compareWeek)) {
    compareRankByName[r.player_name] = r.rank;
  }

  const movers = [];
  for (const r of thisWeekRows) {
    const prevRank = compareRankByName[r.player_name];
    if (prevRank == null) continue;
    const delta = prevRank - r.rank;
    if (delta >= 3) movers.push({ name: r.player_name, delta, direction: 'up' });
    else if (delta <= -3) movers.push({ name: r.player_name, delta: Math.abs(delta), direction: 'down' });
  }
  return movers.sort((a, b) => b.delta - a.delta).slice(0, 3);
}

async function getLiveMatches(supabase, tour) {
  const { data } = await supabase
    .from('gtw_matches')
    .select('tournament_name, round, player1, player2, status_detail')
    .eq('tour', tour)
    .eq('status_state', 'in')
    .limit(3);
  return data || [];
}

async function getTopNews(supabase, sport, limit = 5) {
  // Same live gtw_news data that already powers the site's news
  // ticker — daily from Golf.com, Golfweek, BBC, and ESPN.
  const { data } = await supabase
    .from('gtw_news')
    .select('title, source, link, published_at')
    .eq('sport', sport)
    .order('published_at', { ascending: false })
    .limit(limit);
  return data || [];
}

function buildSportSection(sport, { recap, preview, feature, spotlight, tip, recapPhoto, spotlightPhoto, news, trivia, rankings, fedexStandings, movers, moversATP, moversWTA, liveATP, liveWTA }) {
  const emoji = sport === 'golf' ? '⛳' : '🎾';
  const label = sport === 'golf' ? "Bird's Eye View" : 'Hawkeye';

  let html = `<div style="margin-bottom:32px">`;
  html += `<h2 style="font-family:Georgia,serif;font-size:20px;color:#14181f;border-bottom:2px solid #c97a2b;padding-bottom:8px;margin-bottom:16px">${emoji} ${sport === 'golf' ? 'Golf' : 'Tennis'}</h2>`;

  html += `<div style="text-align:center;background:#f8f6f0;padding:10px;margin-bottom:18px;border:1px dashed #ddd">`;
  html += `<a href="${SITE_URL}" style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#c97a2b;text-decoration:none;font-weight:bold">🔍 Look up any ${sport === 'golf' ? 'golfer' : 'tennis player'} — free trading-card style scouting report →</a>`;
  html += `</div>`;

  if (news && news.length > 0) {
    html += `<div style="margin-bottom:18px">`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:15px;color:#14181f;margin-bottom:8px">📰 In the News</div>`;
    for (const item of news) {
      html += `<div style="font-size:13px;color:#444;line-height:1.5;margin-bottom:6px">`;
      html += `<a href="${item.link}" style="color:#14181f;text-decoration:none">${item.title}</a>`;
      html += ` <span style="color:#999;font-size:11px">— ${item.source}</span>`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  const liveMatches = [...(liveATP || []), ...(liveWTA || [])];
  if (liveMatches.length > 0) {
    html += `<div style="margin-bottom:18px;background:#fff8e8;border-left:3px solid #c97a2b;padding:10px 14px">`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:14px;color:#14181f;margin-bottom:6px">🔴 LIVE</div>`;
    for (const m of liveMatches) {
      const surface = getSurfaceFor(m.tournament_name);
      html += `<div style="font-size:13px;color:#444;line-height:1.5;margin-bottom:4px">`;
      html += `<strong>${m.player1}</strong> vs <strong>${m.player2}</strong> — ${m.tournament_name}${m.round ? `, ${m.round}` : ''}${surface ? ` <span style="color:#999">· ${surface}</span>` : ''}`;
      if (m.status_detail) html += ` <span style="color:#999">(${m.status_detail})</span>`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  if (recap) {
    html += `<div style="margin-bottom:18px;display:flex;align-items:center;gap:12px">`;
    if (recapPhoto) html += `<img src="${recapPhoto}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:1px solid #e0dccf;flex-shrink:0">`;
    html += `<div>`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:15px;color:#14181f">🏆 <a href="https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(recap.display_name || '')}" style="color:#14181f;text-decoration:none">${recap.display_name || 'Last Major'}</a></div>`;
    html += `<div style="font-size:14px;color:#444;line-height:1.6">`;
    if (recap.winner_name) html += `Winner: <strong>${recap.winner_name}</strong>`;
    if (recap.venue_name) html += ` at <a href="https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(recap.venue_name)}" style="color:#c97a2b;text-decoration:none">${recap.venue_name}</a>`;
    if (recap.winner_share) html += ` · $${(recap.winner_share / 1000000).toFixed(2)}M`;
    html += ` &nbsp;<a href="https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(recap.display_name || '')}" style="color:#c97a2b;text-decoration:none;font-size:12px">Full results →</a>`;
    html += `</div></div></div>`;
  }

  if (preview && preview.length > 0) {
    html += `<div style="margin-bottom:18px">`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:15px;color:#14181f;margin-bottom:6px">📅 Coming Up</div>`;
    for (const p of preview) {
      const surface = sport === 'tennis' ? getSurfaceFor(p.tournament_name) : null;
      const eventUrl = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(p.tournament_name)}`;
      html += `<div style="font-size:14px;color:#444;line-height:1.6"><a href="${eventUrl}" style="color:#14181f;text-decoration:none">${p.tournament_name}</a> — ${new Date(p.start_date).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}${surface ? ` <span style="color:#999;font-size:12px">(${surface})</span>` : ''}</div>`;
    }
    html += `</div>`;
  }

  if (rankings && (rankings.men || rankings.women)) {
    html += `<div style="margin-bottom:18px">`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:15px;color:#14181f;margin-bottom:6px">📊 Rankings</div>`;
    for (const col of [rankings.men, rankings.women]) {
      if (!col) continue;
      html += `<div style="font-size:12px;color:#888;margin:8px 0 4px">${col.label}</div>`;
      if (col.linkOnly) {
        html += `<div style="font-size:13px;color:#444;line-height:1.5">Can't be automated — <a href="${col.url}" style="color:#c97a2b;text-decoration:none">see the real rankings →</a></div>`;
      } else {
        for (const p of col.players) {
          html += `<div style="font-size:14px;color:#444;line-height:1.5">${p.rank}. ${p.player_name}</div>`;
        }
      }
    }
    html += `</div>`;
  }

  const allMovers = sport === 'golf' ? (movers || []) : [...(moversATP || []), ...(moversWTA || [])];
  if (allMovers.length > 0) {
    html += `<div style="margin-bottom:18px">`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:15px;color:#14181f;margin-bottom:6px">📈 Movers This Week</div>`;
    for (const m of allMovers) {
      const emoji = m.direction === 'up' ? '🔥' : '🧊';
      const arrow = m.direction === 'up' ? '▲' : '▼';
      html += `<div style="font-size:14px;color:#444;line-height:1.5">${emoji} ${m.name} ${arrow}${m.delta}</div>`;
    }
    html += `</div>`;
  }

  if (fedexStandings && fedexStandings.length > 0) {
    html += `<div style="margin-bottom:18px">`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:15px;color:#14181f;margin-bottom:6px">🏆 FedEx Cup Standings</div>`;
    fedexStandings.forEach((p, i) => {
      html += `<div style="font-size:14px;color:#444;line-height:1.5">${i + 1}. ${p.player_name} — ${Math.round(p.fedex_cup_points || 0)} pts`;
      if (p.season_earnings) html += ` · $${(p.season_earnings / 1000000).toFixed(2)}M`;
      html += `</div>`;
    });
    html += `</div>`;
  }

  if (spotlight) {
    const spotlightLabel = spotlight.isDateMatched ? '📖 THIS WEEK IN HISTORY' : '🏅 LEGEND SPOTLIGHT';
    const searchUrl = `${SITE_URL}/#search-${encodeURIComponent(spotlight.winner_name)}`;
    html += `<div style="margin-bottom:18px;display:flex;align-items:center;gap:12px">`;
    if (spotlightPhoto) html += `<img src="${spotlightPhoto}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:1px solid #e0dccf;flex-shrink:0">`;
    html += `<div>`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:15px;color:#14181f">${spotlightLabel}</div>`;
    html += `<div style="font-size:14px;color:#444;line-height:1.6">`;
    html += `${spotlight.year} — <strong>${spotlight.winner_name}</strong> won the ${spotlight.tournament_name}`;
    if (spotlight.country) html += ` (${spotlight.country})`;
    html += ` &nbsp;<a href="${searchUrl}" style="color:#c97a2b;text-decoration:none;font-size:12px">🔍 Learn more →</a>`;
    html += `</div></div></div>`;
  }

  if (feature) {
    const excerpt = excerptWords(feature.body, 150);
    html += `<div style="background:#f8f6f0;border-left:4px solid #c97a2b;padding:16px 18px;margin-bottom:8px">`;
    html += `<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.1em;color:#c97a2b;margin-bottom:6px">${label.toUpperCase()}</div>`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:16px;color:#14181f;margin-bottom:8px">${feature.title}</div>`;
    html += `<div style="font-size:14px;color:#444;line-height:1.65;margin-bottom:12px">${excerpt}</div>`;
    html += `<a href="${SITE_URL}/#feature-${feature.slug}" style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#c97a2b;text-decoration:none;font-weight:bold">Read the full piece →</a>`;
    html += `</div>`;
  }

  if (tip) {
    html += `<div style="margin-bottom:8px">`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:15px;color:#14181f">🎯 This Week's Tip: ${tip.topic}</div>`;
    html += `<div style="font-size:14px;color:#444;line-height:1.6">Sharpen up your ${tip.topic.toLowerCase()} this week — <a href="${tip.url}" style="color:#c97a2b;text-decoration:none">${tip.source}'s full archive →</a></div>`;
    html += `</div>`;
  }

  if (trivia && (trivia.current || trivia.previous)) {
    html += `<div style="margin-top:8px;padding-top:14px;border-top:1px dashed #ddd">`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:15px;color:#14181f;margin-bottom:8px">🧠 Trivia</div>`;
    if (trivia.previous) {
      html += `<div style="font-size:12px;color:#888;margin-bottom:10px"><em>Last week's answer:</em> ${trivia.previous.answer}</div>`;
    }
    if (trivia.current) {
      html += `<div style="font-size:14px;color:#444;line-height:1.6">${trivia.current.question}</div>`;
      html += `<div style="font-size:11px;color:#aaa;margin-top:4px">Answer in next week's issue.</div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

// Which sport leads the issue: whichever has a recap (a major that
// just wrapped) is inherently the bigger, fresher story. If both or
// neither do, fall back to whichever has a feature ready. Final
// tiebreak is golf, arbitrarily but consistently, so ordering never
// looks random week to week.
function determineLeadSport(golfContent, tennisContent) {
  if (golfContent.recap && !tennisContent.recap) return 'golf';
  if (tennisContent.recap && !golfContent.recap) return 'tennis';
  if (golfContent.feature && !tennisContent.feature) return 'golf';
  if (tennisContent.feature && !golfContent.feature) return 'tennis';
  return 'golf';
}

function buildHookParagraph(leadSport, content) {
  const sportLabel = leadSport === 'golf' ? 'golf' : 'tennis';
  if (content.recap?.winner_name) {
    return `<strong>${content.recap.winner_name}</strong> just won ${content.recap.display_name || 'the week\'s big event'} — that's where we start, plus what's next and a story worth your time.`;
  }
  if (content.feature) {
    return `This week's big read: <strong>${content.feature.title}</strong>.`;
  }
  return `Here's what's new in ${sportLabel} this week.`;
}

function buildSubjectLine(golfContent, tennisContent) {
  // Prefer leading with whichever sport actually has a recap this
  // week — a real result beats a generic subject line.
  if (golfContent?.recap?.winner_name) {
    return `⛳ ${golfContent.recap.winner_name} Wins ${golfContent.recap.display_name || 'the Major'} — Golf & Tennis Weekly`;
  }
  if (tennisContent?.recap?.winner_name) {
    return `🎾 ${tennisContent.recap.winner_name} Wins ${tennisContent.recap.display_name || 'the Major'} — Golf & Tennis Weekly`;
  }
  return '⛳🎾 Golf & Tennis Weekly — This Week';
}

export default async function handler(req, res) {
  const cronAuth = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
  const manualAuth = req.query.secret === process.env.CRON_SECRET;
  if (!cronAuth && !manualAuth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY || !RESEND_KEY) {
    return res.status(500).json({ error: 'Missing required env vars (VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or RESEND_API_KEY).' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const weekKey = thisWeekTuesday();
  const force = req.query.force === 'true';
  const dryRun = req.query.dryRun === 'true';

  try {
    // Duplicate-send guard — skip unless explicitly forced (useful
    // for testing a re-send without waiting a week).
    if (!force) {
      const { data: existing } = await supabase
        .from('gtw_send_log')
        .select('id')
        .eq('sent_week', weekKey)
        .maybeSingle();
      if (existing) {
        return res.status(200).json({ skipped: true, reason: `Already sent for week of ${weekKey}` });
      }
    }

    // Issue number = how many real sends have happened so far, plus
    // one for this one. Computed here (not just read from an insert
    // result) so a forced test send can preview the number without
    // actually consuming it — only a real, non-forced send writes to
    // gtw_send_log below and makes the number permanent.
    const { count: pastIssueCount } = await supabase
      .from('gtw_send_log')
      .select('*', { count: 'exact', head: true });
    const issueNumber = (pastIssueCount || 0) + 1;

    const golfContent = await getRecapAndPreview(supabase, 'golf');
    const tennisContent = await getRecapAndPreview(supabase, 'tennis');
    golfContent.feature = await getNextUnsentFeature(supabase, 'golf');
    tennisContent.feature = await getNextUnsentFeature(supabase, 'tennis');
    golfContent.spotlight = await getHistorySpotlight(supabase, 'golf');
    tennisContent.spotlight = await getHistorySpotlight(supabase, 'tennis');
    golfContent.tip = getWeeklyTip('golf');
    tennisContent.tip = getWeeklyTip('tennis');
    golfContent.recapPhoto = await fetchWikipediaPhoto(golfContent.recap?.winner_name);
    tennisContent.recapPhoto = await fetchWikipediaPhoto(tennisContent.recap?.winner_name);
    golfContent.spotlightPhoto = await fetchWikipediaPhoto(golfContent.spotlight?.winner_name);
    tennisContent.spotlightPhoto = await fetchWikipediaPhoto(tennisContent.spotlight?.winner_name);
    golfContent.news = await getTopNews(supabase, 'golf');
    tennisContent.news = await getTopNews(supabase, 'tennis');
    golfContent.trivia = await getTriviaForWeek(supabase, 'golf');
    tennisContent.trivia = await getTriviaForWeek(supabase, 'tennis');
    golfContent.rankings = await getTopRankings(supabase, 'golf');
    tennisContent.rankings = await getTopRankings(supabase, 'tennis');
    golfContent.fedexStandings = await getFedExStandings(supabase);
    golfContent.movers = await getRankingsMovers(supabase, 'golf', 'owgr');
    tennisContent.moversATP = await getRankingsMovers(supabase, 'tennis', 'atp');
    tennisContent.moversWTA = await getRankingsMovers(supabase, 'tennis', 'wta');
    tennisContent.liveATP = await getLiveMatches(supabase, 'atp');
    tennisContent.liveWTA = await getLiveMatches(supabase, 'wta');

    if (!golfContent.feature && !tennisContent.feature && !golfContent.recap && !tennisContent.recap) {
      return res.status(200).json({ skipped: true, reason: 'No content available to send this week.' });
    }

    const { data: subscribers, error: subError } = await supabase
      .from('gtw_subscribers')
      .select('*')
      .eq('active', true)
      .eq('confirmed', true);
    if (subError) throw new Error(`Fetching subscribers failed: ${subError.message}`);
    if (!subscribers || subscribers.length === 0) {
      return res.status(200).json({ skipped: true, reason: 'No active subscribers.' });
    }

    const subject = buildSubjectLine(golfContent, tennisContent);
    const leadSport = determineLeadSport(golfContent, tennisContent);
    const leadContent = leadSport === 'golf' ? golfContent : tennisContent;
    const hookParagraph = buildHookParagraph(leadSport, leadContent);
    const issueDate = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    let sentCount = 0;
    const errors = [];
    let previewHtml = null;

    for (const sub of subscribers) {
      const sports = sub.sports || ['golf', 'tennis'];
      // Lead sport's section renders first, whichever it is, so the
      // bigger story of the week always leads the issue rather than
      // the two sports just sitting in a fixed, arbitrary order.
      const sectionOrder = leadSport === 'golf' ? ['golf', 'tennis'] : ['tennis', 'golf'];
      let bodyHtml = '';
      for (const s of sectionOrder) {
        if (!sports.includes(s)) continue;
        bodyHtml += buildSportSection(s, s === 'golf' ? golfContent : tennisContent);
      }
      if (!bodyHtml) continue;

      const greeting = sub.name ? `, ${sub.name}` : '';
      const unsubUrl = `${SITE_URL}/api/unsubscribe?id=${sub.id}`;
      const forwardUrl = `mailto:?subject=${encodeURIComponent('Check out Golf & Tennis Weekly')}&body=${encodeURIComponent(`Thought you might like this: ${SITE_URL}`)}`;
      const preheaderText = leadContent.recap?.winner_name
        ? `${leadContent.recap.winner_name} wins, plus what's next and this week's read.`
        : 'This week in golf and tennis.';

      const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f2ede1;font-family:Georgia,serif;color:#14181f">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheaderText}</div>
<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e0dccf">
<div style="background:#14181f;padding:24px;text-align:center;border-bottom:3px solid #c97a2b">
<div style="font-size:24px;font-weight:900;color:#ffffff">Golf <span style="color:#c97a2b">&amp;</span> Tennis <span style="font-weight:300;color:#aaa">Weekly</span></div>
<div style="font-size:10px;color:#c97a2b;letter-spacing:0.2em;margin-top:6px">${issueDate.toUpperCase()} · ISSUE #${issueNumber}${force ? ' (PREVIEW)' : ''}</div>
</div>
<div style="padding:28px 32px">
<p style="font-size:15px;color:#444;margin:0 0 10px">Hey${greeting} —</p>
<p style="font-size:16px;color:#14181f;margin:0 0 24px;line-height:1.6">${hookParagraph}</p>
${bodyHtml}
</div>
<div style="background:#f0ede4;border-top:1px solid #ddd;padding:16px 24px;text-align:center">
<p style="color:#888;font-size:12px;margin:0 0 8px;font-style:italic">Good, clean fun for the golf and tennis enthusiast. ⛳🎾</p>
<a href="https://buymeacoffee.com/mhughes65v" style="color:#888;font-size:11px;text-decoration:none">💿 Buy me a record</a>
<p style="color:#aaa;font-size:11px;margin:14px 0 6px">Know someone who'd like this? <a href="${forwardUrl}" style="color:#c97a2b;text-decoration:none">Forward it along →</a></p>
<p style="color:#aaa;font-size:11px;margin:6px 0">Also from the same desk: <a href="https://nysportsdaily.com" style="color:#888;text-decoration:none">NY Sports Daily</a> · <a href="https://nflboxscore.com" style="color:#888;text-decoration:none">The Final Whistle</a></p>
<p style="color:#bbb;font-size:10px;margin:14px 0 0"><a href="${unsubUrl}" style="color:#999;text-decoration:underline">Unsubscribe</a></p>
</div>
</div></body></html>`;

      if (dryRun) {
        // Skips the actual send entirely - captures what the first
        // subscriber would have received so it can be inspected in
        // the response, with zero risk of anything reaching a real inbox.
        sentCount++;
        if (!previewHtml) previewHtml = fullHtml;
        continue;
      }

      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
          body: JSON.stringify({
            from: `Golf & Tennis Weekly <${FROM_EMAIL}>`,
            to: [sub.email],
            subject,
            html: fullHtml,
          }),
        });
        if (resendRes.ok) sentCount++;
        else errors.push(`${sub.email}: ${await resendRes.text()}`);
      } catch (err) {
        errors.push(`${sub.email}: ${err.message}`);
      }
    }

    // Mark whichever features were actually used as sent — this is
    // also what flips them from hidden to publicly visible on the site.
    // Skipped entirely on a dry run - a preview should never have any
    // real-world side effect, not even marking a feature as sent.
    const today = new Date().toISOString().slice(0, 10);
    if (!dryRun) {
      if (golfContent.feature) {
        await supabase.from('gtw_features').update({ sent_on: today }).eq('slug', golfContent.feature.slug);
      }
      if (tennisContent.feature) {
        await supabase.from('gtw_features').update({ sent_on: today }).eq('slug', tennisContent.feature.slug);
      }
    }

    // Log this week as sent, so a second cron fire (or accidental
    // manual trigger) this same week doesn't send everyone a duplicate.
    // Skipped on a forced test send or dry run — that's exactly what
    // keeps the issue number honest, since this insert is what makes
    // it permanent.
    if (!force && !dryRun) {
      await supabase.from('gtw_send_log').insert({ sent_week: weekKey });
    }

    return res.status(200).json({
      dryRun: dryRun || undefined,
      sent: dryRun ? 0 : sentCount,
      wouldHaveSent: dryRun ? sentCount : undefined,
      subject,
      issueNumber: (force || dryRun) ? `${issueNumber} (preview only — not saved)` : issueNumber,
      totalSubscribers: subscribers.length,
      golfFeature: golfContent.feature?.slug || null,
      tennisFeature: tennisContent.feature?.slug || null,
      previewHtml: dryRun ? previewHtml : undefined,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
