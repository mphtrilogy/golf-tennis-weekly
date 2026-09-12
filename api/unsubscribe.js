// api/unsubscribe.js
//
// CAN-SPAM requires every commercial email to include a working
// unsubscribe mechanism. This is that mechanism — a one-click link
// (no login, no confirmation page maze) that sets active=false on
// the subscriber's row. send-digest.js already only ever emails
// active=true subscribers, so this takes effect immediately on the
// next send.
//
// Supports two lookups: ?id=<subscriber id> (used in every email
// footer link) and ?email=<address> (used by the self-service
// unsubscribe box on the site itself, for anyone without an old
// email handy).

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  const subscriberId = req.query.id;
  const email = req.query.email;
  if (!subscriberId && !email) {
    return res.status(400).send('Missing subscriber id or email.');
  }

  try {
    const filter = subscriberId
      ? `id=eq.${encodeURIComponent(subscriberId)}`
      : `email=eq.${encodeURIComponent(email.toLowerCase().trim())}`;

    const sbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/gtw_subscribers?${filter}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({ active: false }),
      }
    );

    if (!sbRes.ok) {
      return res.status(500).send('Something went wrong unsubscribing — please try again, or just reply to this email and I\'ll remove you by hand.');
    }

    const updated = await sbRes.json();
    if (email && (!updated || updated.length === 0)) {
      // Don't confirm/deny whether an email is subscribed to anyone
      // probing the endpoint - just show the same friendly message
      // either way.
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Georgia,serif;background:#f2ede1;padding:40px;text-align:center;color:#14181f">
<h2>Done.</h2>
<p style="color:#555">If that email was subscribed, it's been removed.</p>
</body></html>`);
    }

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Georgia,serif;background:#f2ede1;padding:40px;text-align:center;color:#14181f">
<h2>You're unsubscribed.</h2>
<p style="color:#555">You won't get any more Golf &amp; Tennis Weekly emails. Sorry to see you go — the site itself is still there anytime you want to check scores or read something, no email required.</p>
</body></html>`);
  } catch (err) {
    return res.status(500).send('Something went wrong — please reply to this email and I\'ll remove you by hand.');
  }
}
