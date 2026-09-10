// api/send-digest.js
//
// The weekly Tuesday send. Fires via cron (see vercel.json) or can be
// triggered manually: /api/send-digest?secret=YOUR_SECRET
//
// Includes: personalization by sport preference, recap/preview from
// live data, the week's feature article (teaser + link to the full
// piece on-site), a real "this week in history" or rotating legend
// spotlight (with a deep link to that player's own trading card on
// the site), a dynamic subject line, and a duplicate-send guard.
//
// Still deliberately NOT included: trivia and a tutorial tip. Both
// are real, planned additions — layering them in once this version
// is proven on a real send is safer than growing the file further
// before the first actual email goes out.

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

  // Preview: next scheduled tournament from the season calendar.
  const calendarTable = sport === 'golf' ? 'gtw_golf_tour_calendar' : 'gtw_tour_calendar';
  const today = new Date().toISOString().slice(0, 10);
  const { data: upcoming } = await supabase
    .from(calendarTable)
    .select('*')
    .gt('start_date', today)
    .order('start_date', { ascending: true })
    .limit(1);
  const preview = upcoming && upcoming.length > 0 ? upcoming[0] : null;

  return { recap, preview };
}

function buildSportSection(sport, { recap, preview, feature, spotlight }) {
  const emoji = sport === 'golf' ? '⛳' : '🎾';
  const label = sport === 'golf' ? "Bird's Eye View" : 'Hawkeye';

  let html = `<div style="margin-bottom:32px">`;
  html += `<h2 style="font-family:Georgia,serif;font-size:20px;color:#14181f;border-bottom:2px solid #c97a2b;padding-bottom:8px;margin-bottom:16px">${emoji} ${sport === 'golf' ? 'Golf' : 'Tennis'}</h2>`;

  if (recap) {
    html += `<div style="margin-bottom:18px">`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:15px;color:#14181f">🏆 ${recap.display_name || 'Last Major'}</div>`;
    html += `<div style="font-size:14px;color:#444;line-height:1.6">`;
    if (recap.winner_name) html += `Winner: <strong>${recap.winner_name}</strong>`;
    if (recap.venue_name) html += ` at ${recap.venue_name}`;
    if (recap.winner_share) html += ` · $${(recap.winner_share / 1000000).toFixed(2)}M`;
    html += `</div></div>`;
  }

  if (preview) {
    html += `<div style="margin-bottom:18px">`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:15px;color:#14181f">📅 Coming Up</div>`;
    html += `<div style="font-size:14px;color:#444;line-height:1.6">${preview.tournament_name} — ${new Date(preview.start_date).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</div>`;
    html += `</div>`;
  }

  if (spotlight) {
    const spotlightLabel = spotlight.isDateMatched ? '📖 THIS WEEK IN HISTORY' : '🏅 LEGEND SPOTLIGHT';
    const searchUrl = `${SITE_URL}/#search-${encodeURIComponent(spotlight.winner_name)}`;
    html += `<div style="margin-bottom:18px">`;
    html += `<div style="font-family:Georgia,serif;font-weight:bold;font-size:15px;color:#14181f">${spotlightLabel}</div>`;
    html += `<div style="font-size:14px;color:#444;line-height:1.6">`;
    html += `${spotlight.year} — <strong>${spotlight.winner_name}</strong> won the ${spotlight.tournament_name}`;
    if (spotlight.country) html += ` (${spotlight.country})`;
    html += ` &nbsp;<a href="${searchUrl}" style="color:#c97a2b;text-decoration:none;font-size:12px">🔍 Learn more →</a>`;
    html += `</div></div>`;
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

  html += `</div>`;
  return html;
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

    const golfContent = await getRecapAndPreview(supabase, 'golf');
    const tennisContent = await getRecapAndPreview(supabase, 'tennis');
    golfContent.feature = await getNextUnsentFeature(supabase, 'golf');
    tennisContent.feature = await getNextUnsentFeature(supabase, 'tennis');
    golfContent.spotlight = await getHistorySpotlight(supabase, 'golf');
    tennisContent.spotlight = await getHistorySpotlight(supabase, 'tennis');

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
    let sentCount = 0;
    const errors = [];

    for (const sub of subscribers) {
      const sports = sub.sports || ['golf', 'tennis'];
      let bodyHtml = '';
      if (sports.includes('golf')) bodyHtml += buildSportSection('golf', golfContent);
      if (sports.includes('tennis')) bodyHtml += buildSportSection('tennis', tennisContent);
      if (!bodyHtml) continue;

      const greeting = sub.name ? `, ${sub.name}` : '';
      const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f2ede1;font-family:Georgia,serif;color:#14181f">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e0dccf">
<div style="background:#14181f;padding:24px;text-align:center;border-bottom:3px solid #c97a2b">
<div style="font-size:24px;font-weight:900;color:#ffffff">Golf <span style="color:#c97a2b">&amp;</span> Tennis <span style="font-weight:300;color:#aaa">Weekly</span></div>
<div style="font-size:10px;color:#c97a2b;letter-spacing:0.2em;margin-top:6px">TUESDAY EDITION</div>
</div>
<div style="padding:28px 32px">
<p style="font-size:15px;color:#444;margin:0 0 24px">Hey${greeting} — here's your week.</p>
${bodyHtml}
</div>
<div style="background:#f0ede4;border-top:1px solid #ddd;padding:16px 24px;text-align:center">
<p style="color:#888;font-size:12px;margin:0 0 8px;font-style:italic">Good, clean fun for the golf and tennis enthusiast. ⛳🎾</p>
<a href="https://buymeacoffee.com/mhughes65v" style="color:#888;font-size:11px;text-decoration:none">💿 Buy me a record</a>
</div>
</div></body></html>`;

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
    const today = new Date().toISOString().slice(0, 10);
    if (golfContent.feature) {
      await supabase.from('gtw_features').update({ sent_on: today }).eq('slug', golfContent.feature.slug);
    }
    if (tennisContent.feature) {
      await supabase.from('gtw_features').update({ sent_on: today }).eq('slug', tennisContent.feature.slug);
    }

    // Log this week as sent, so a second cron fire (or accidental
    // manual trigger) this same week doesn't send everyone a duplicate.
    await supabase.from('gtw_send_log').insert({ sent_week: weekKey });

    return res.status(200).json({
      sent: sentCount,
      totalSubscribers: subscribers.length,
      golfFeature: golfContent.feature?.slug || null,
      tennisFeature: tennisContent.feature?.slug || null,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
