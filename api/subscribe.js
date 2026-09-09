// api/subscribe.js
//
// Direct adaptation of nysportsdaily's subscribe.js — same proven
// mechanism (Supabase + Resend), swapping the `teams` array for a
// `sports` array (['golf'], ['tennis'], or both). The weekly digest
// (api/send-digest.js) reads this same field to personalize each
// subscriber's Tuesday email.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'newsletter@gtw.nysportsdaily.com'; // verified in Resend Sept 9, 2026
const SITE_URL = 'https://golf-tennis-weekly.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, name, sports } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  const cleanSports = (Array.isArray(sports) && sports.length > 0)
    ? sports.filter((s) => s === 'golf' || s === 'tennis')
    : ['golf', 'tennis']; // default to both if nothing selected

  try {
    const sbRes = await fetch(SUPABASE_URL + '/rest/v1/gtw_subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        email: email.toLowerCase().trim(),
        name: name || '',
        sports: cleanSports,
        active: true,
        confirmed: true,
      }),
    });

    if (!sbRes.ok && sbRes.status !== 409) {
      const err = await sbRes.text();
      console.error('Supabase error:', err);
      return res.status(500).json({ error: 'Could not save subscription' });
    }

    const sportsLabel = cleanSports.length === 2
      ? 'Golf & Tennis'
      : cleanSports[0] === 'golf' ? 'Golf' : 'Tennis';
    const greeting = name ? (', ' + name) : '';

    const welcomeHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
      + '<body style="margin:0;padding:0;background:#f2ede1;font-family:Georgia,serif;color:#14181f">'
      + '<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e0dccf">'

      // Header
      + '<div style="background:#14181f;padding:24px;text-align:center;border-bottom:3px solid #c97a2b">'
      + '<div style="font-size:26px;font-weight:900;color:#ffffff;letter-spacing:-0.01em">'
      + 'Golf <span style="color:#c97a2b">&amp;</span> Tennis <span style="font-weight:300;color:#aaa">Weekly</span>'
      + '</div>'
      + '<div style="font-size:10px;color:#c97a2b;letter-spacing:0.2em;margin-top:6px">EVERY TUESDAY</div>'
      + '</div>'

      // Body
      + '<div style="padding:28px 32px">'
      + '<h2 style="color:#14181f;font-size:22px;margin:0 0 10px;font-weight:900">Welcome' + greeting + '! ⛳🎾</h2>'
      + '<p style="color:#444;font-size:15px;line-height:1.7;margin:0 0 20px">'
      + 'Every <strong style="color:#c97a2b">Tuesday</strong> you\'ll get your personalized Golf &amp; Tennis Weekly digest.'
      + '</p>'

      // Feature list
      + '<div style="background:#f8f6f0;border-left:4px solid #c97a2b;padding:16px 20px;margin:0 0 20px">'
      + '<div style="margin-bottom:8px;color:#222;font-size:14px">🏆 &nbsp;<strong>Last tournament recap</strong> — winner, score, purse</div>'
      + '<div style="margin-bottom:8px;color:#222;font-size:14px">📅 &nbsp;<strong>What\'s next</strong> — dates, venue, past champions</div>'
      + '<div style="margin-bottom:8px;color:#222;font-size:14px">✍️ &nbsp;<strong>A deep-dive feature</strong> — golf or tennis, every week</div>'
      + '<div style="margin-bottom:8px;color:#222;font-size:14px">📖 &nbsp;<strong>A piece of history</strong> — this week, or a legend spotlight</div>'
      + '<div style="color:#222;font-size:14px">🎯 &nbsp;<strong>A tip, and a trivia question</strong> to test yourself</div>'
      + '</div>'

      // Preference
      + '<p style="color:#555;font-size:14px;margin:0 0 24px">'
      + 'Your picks: <strong style="color:#c97a2b">' + sportsLabel + '</strong>'
      + '</p>'

      // CTA button
      + '<div style="text-align:center;margin:24px 0 28px">'
      + '<a href="' + SITE_URL + '" style="display:inline-block;background:#c97a2b;color:#ffffff;'
      + 'text-decoration:none;padding:13px 32px;font-weight:900;font-size:13px;'
      + 'letter-spacing:0.1em;font-family:Georgia,serif">'
      + 'VISIT THE SITE →'
      + '</a>'
      + '</div>'

      + '</div>'

      // Footer
      + '<div style="background:#f0ede4;border-top:1px solid #ddd;padding:16px 24px;text-align:center">'
      + '<p style="color:#888;font-size:12px;margin:0 0 6px;font-style:italic">'
      + 'Good, clean fun for the golf and tennis enthusiast. ⛳🎾'
      + '</p>'
      + '<p style="color:#aaa;font-size:11px;margin:0 0 8px">Golf &amp; Tennis Weekly · Free always · No ads ever</p>'
      + '<a href="https://buymeacoffee.com/mhughes65v" style="color:#888;font-size:11px;text-decoration:none">'
      + '💿 Buy me a record'
      + '</a>'
      + '</div>'

      + '</div></body></html>';

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + RESEND_KEY,
      },
      body: JSON.stringify({
        from: 'Golf & Tennis Weekly <' + FROM_EMAIL + '>',
        to: [email],
        subject: '⛳🎾 Welcome to Golf & Tennis Weekly',
        html: welcomeHtml,
      }),
    });

    return res.status(200).json({ ok: true, message: 'Subscribed! Check your email.' });

  } catch (err) {
    console.error('Subscribe error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
