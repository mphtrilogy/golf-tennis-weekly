import { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabaseClient';

// ---------------------------------------------------------------------
// Placeholder content — shown until gtw_rankings_snapshots /
// gtw_tournament_results actually have rows in them. Same shape the
// live data will arrive in, so swapping over later is a non-event.
// ---------------------------------------------------------------------
const SAMPLE = {
  golf: {
    subline: 'DAILY COVERAGE · NEWSLETTER EVERY TUESDAY · GOLF EDITION',
    spotlight: {
      eyebrow: 'ON THIS DAY · 1997',
      headline: 'The Sunday That Changed the Majors',
      body: 'A look back at a breakout final round that reshaped how the sport thought about its next generation — mixed with a current player making similar noise this week.',
    },
    tourneyNow: { name: 'Sample Invitational', meta: 'Round 3 of 4 · Leader: —', course: 'Course: Sample Ridge Golf Club · Architect: Sample Designer · Est. 1932 · Par 72' },
    tourneyNext: { name: 'Sample Championship', meta: 'Starts Thursday · Field TBD', course: 'Course: Sample Dunes Links · Architect: Sample Designer II · Est. 1958 · Par 71' },
    results: [
      ['Sample Classic', 'Winner — 18 under par'],
      ['Regional Open', 'Winner — playoff, 2nd extra hole'],
      ['Tour Championship Qualifier', 'Winner — wire to wire'],
    ],
    rankCols: ["Men's — OWGR", "Women's — Rolex"],
    rankBase: [
      [{ n: 'Player One', d: 1, h: 'hot' }, { n: 'Player Two', d: -1, h: null }, { n: 'Player Three', d: 0, h: null }, { n: 'Player Four', d: 3, h: 'hot' }, { n: 'Player Five', d: -2, h: 'cold' }],
      [{ n: 'Player A', d: 0, h: null }, { n: 'Player B', d: 2, h: null }, { n: 'Player C', d: -1, h: null }, { n: 'Player D', d: 1, h: null }, { n: 'Player E', d: -3, h: 'cold' }],
    ],
    players: ['Player One', 'Player Two', 'Player Three'],
    news: [
      ['Course changes ahead of next major', 'Sample Wire'],
      ['Rookie of the year race tightens', 'Sample Wire'],
      ['Equipment notes from the range', 'Sample Wire'],
      ['Veteran eyes senior circuit move', 'Sample Wire'],
    ],
    topStory: { title: "A Decade Later, That Final Round Still Gets Talked About", dek: "Fresh reporting on this week's leaderboard, paired with the anniversary of a round that's still the sport's reference point for a great back nine.", src: 'Sample Wire · Featured' },
    feature: { label: 'DEEP DIVE', title: 'How the Majors Got Their Names', body: "A long-form look at the history and traditions behind golf's four biggest weeks of the year." },
  },
  tennis: {
    subline: 'DAILY COVERAGE · NEWSLETTER EVERY TUESDAY · TENNIS EDITION',
    spotlight: {
      eyebrow: 'ON THIS DAY · 2005',
      headline: 'The Final Set That Redefined an Era',
      body: "Revisiting a five-set classic that changed how the sport's biggest rivalries were framed — paired with a rising player drawing early comparisons.",
    },
    tourneyNow: { name: 'Sample Open', meta: 'Quarterfinals · Top seed advances', course: 'Venue: Sample Arena · Hard Court · Cap. 23,700 · Outer courts: 12' },
    tourneyNext: { name: 'Sample Masters', meta: 'Starts Monday · Draw TBD', course: 'Venue: Sample Court Complex · Clay Court · Cap. 15,000 · Outer courts: 18' },
    results: [
      ['Sample Open Final', 'Winner in straight sets'],
      ['Regional Cup', 'Winner — 3-set thriller'],
      ['Challenger Series Finale', 'Winner — first title of the year'],
    ],
    rankCols: ["Men's — ATP", "Women's — WTA"],
    rankBase: [
      [{ n: 'Player One', d: 2, h: 'hot' }, { n: 'Player Two', d: 0, h: null }, { n: 'Player Three', d: -1, h: null }, { n: 'Player Four', d: 1, h: null }, { n: 'Player Five', d: -2, h: 'cold' }],
      [{ n: 'Player A', d: -1, h: null }, { n: 'Player B', d: 3, h: 'hot' }, { n: 'Player C', d: 0, h: null }, { n: 'Player D', d: -1, h: null }, { n: 'Player E', d: -3, h: 'cold' }],
    ],
    players: ['Player One', 'Player Two', 'Player Three'],
    news: [
      ['Surface swap shakes up seeding', 'Sample Wire'],
      ['Doubles pair chase calendar sweep', 'Sample Wire'],
      ['Coaching change ahead of hard-court swing', 'Sample Wire'],
      ['Junior standout earns wildcard', 'Sample Wire'],
    ],
    topStory: { title: "The Comeback Everyone's Comparing to a Classic", dek: "This week's breakout run alongside a look back at the match that set the standard for late-career runs like it.", src: 'Sample Wire · Featured' },
    feature: { label: 'DEEP DIVE', title: 'The Grand Slams: Four Courts, Four Cultures', body: "A long-form look at how each major's surface and setting shaped the way the sport is played and watched." },
  },
};

function extendRankings(base, targetLen) {
  const out = base.slice();
  for (let i = base.length; i < targetLen; i++) {
    const seed = (i * 2654435761) >>> 0;
    const d = (seed % 9) - 4;
    const h = d >= 3 ? 'hot' : d <= -3 ? 'cold' : null;
    out.push({ n: `Player ${i + 1}`, d, h });
  }
  return out;
}

function deltaLabel(d) {
  if (d > 0) return { cls: 'up', txt: `▲${d}` };
  if (d < 0) return { cls: 'down', txt: `▼${Math.abs(d)}` };
  return { cls: 'flat', txt: '—' };
}
function heatEmoji(h) {
  if (h === 'hot') return '🔥';
  if (h === 'cold') return '🧊';
  return '';
}
function eventLinks(name) {
  const q = encodeURIComponent(name);
  return (
    <div className="event-links">
      <a href={`https://en.wikipedia.org/wiki/Special:Search?search=${q}`} target="_blank" rel="noopener noreferrer">Wiki</a>
      <a href={`https://www.google.com/search?q=${q}`} target="_blank" rel="noopener noreferrer">Search</a>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState('golf');
  const [period, setPeriod] = useState('wk');
  const [rankExpanded, setRankExpanded] = useState(false);
  const [liveRankings, setLiveRankings] = useState(null); // null = not loaded yet, [] = loaded-but-empty

  const c = SAMPLE[theme];

  // Try live data first; fall back to sample rows if the table's empty
  // (e.g. before the first weekly pull has run) or the query fails.
  useEffect(() => {
    let cancelled = false;
    async function loadRankings() {
      try {
        const { data, error } = await supabase
          .from('gtw_rankings_snapshots')
          .select('*')
          .eq('sport', theme)
          .order('week_of', { ascending: false })
          .order('rank', { ascending: true })
          .limit(300);
        if (error) throw error;
        if (!cancelled) setLiveRankings(data && data.length ? data : []);
      } catch (err) {
        console.warn('Rankings fetch failed, using sample data:', err);
        if (!cancelled) setLiveRankings([]);
      }
    }
    loadRankings();
    return () => { cancelled = true; };
  }, [theme]);

  const rankColumns = useMemo(() => {
    const showCount = rankExpanded ? 25 : 5;
    // Once live rows exist, this is where they'd be grouped by tour
    // into the same [{n, d, h}] shape the sample data already uses —
    // left as sample fallback until gtw_rankings_snapshots is seeded.
    return c.rankBase.map((base) => extendRankings(base, 25).slice(0, showCount));
  }, [c, rankExpanded]);

  return (
    <div data-theme={theme}>
      <header className="masthead">
        <div className="masthead-inner">
          <div>
            <div className="brand">Golf <span>&amp;</span> Tennis <span>Weekly</span></div>
            <div className="brand-sub">{c.subline}</div>
          </div>
          <div className="toggle">
            <button className={theme === 'golf' ? 'active' : ''} onClick={() => setTheme('golf')}>GOLF</button>
            <button className={theme === 'tennis' ? 'active' : ''} onClick={() => setTheme('tennis')}>TENNIS</button>
          </div>
        </div>
        <div className="wrap">
          <div className="tabs-nav">
            <a href="#rankings">Rankings</a><a href="#majors">Majors &amp; History</a><a href="#amateur">Amateur</a>
            <a href="#tutorials">Tutorials</a><a href="#trivia">Trivia</a><a href="#tv">TV Schedule</a>
          </div>
        </div>
      </header>

      <div className="wrap">
        <section>
          <div className="section-head"><span className="section-title">Daily Spotlight</span></div>
          <div className="spotlight">
            <div className="spotlight-photo" />
            <div>
              <div className="spotlight-eyebrow">{c.spotlight.eyebrow}</div>
              <h3>{c.spotlight.headline}</h3>
              <p>{c.spotlight.body}</p>
            </div>
          </div>
        </section>

        <section>
          <div className="section-head"><span className="section-title">This Week &amp; Next</span></div>
          <div className="tourney-strip">
            <div className="tourney-card">
              <div className="label">In Progress</div>
              <h4>{c.tourneyNow.name}</h4>
              <div className="meta">{c.tourneyNow.meta}</div>
              {eventLinks(c.tourneyNow.name)}
              {c.tourneyNow.course && <div className="course-line">{c.tourneyNow.course}</div>}
            </div>
            <div className="tourney-card">
              <div className="label">Up Next</div>
              <h4>{c.tourneyNext.name}</h4>
              <div className="meta">{c.tourneyNext.meta}</div>
              {eventLinks(c.tourneyNext.name)}
              {c.tourneyNext.course && <div className="course-line">{c.tourneyNext.course}</div>}
            </div>
          </div>
        </section>

        <section>
          <div className="section-head"><span className="section-title">Last Week's Results</span></div>
          <div className="week-nav">
            <button>&larr; Prior Week</button>
            <span>WEEK OF —</span>
            <button>This Week &rarr;</button>
          </div>
          <ul className="results-list">
            {c.results.map((r) => (
              <li key={r[0]}>
                <div className="result-main">
                  <span className="who">{r[0]}</span>
                  <span className="what">{r[1]}</span>
                  {eventLinks(r[0])}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section id="rankings">
          <div className="section-head">
            <span className="section-title">Rankings Snapshot</span>
            <a className="section-link" href="#rankings">Full top 100 →</a>
          </div>
          <div className="period-toggle">
            {['wk', 'mo', 'yr'].map((p) => (
              <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>
                {p.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="rankings-grid">
            {c.rankCols.map((label, i) => (
              <div className="rank-col" key={label}>
                <div className="col-label">{label}</div>
                {rankColumns[i].map((p, idx) => {
                  const d = deltaLabel(p.d);
                  const q = encodeURIComponent(p.n);
                  return (
                    <div className="rank-row" key={p.n}>
                      <span className="num">{idx + 1}</span>
                      <span className="name">
                        <a href={`https://en.wikipedia.org/wiki/Special:Search?search=${q}`} target="_blank" rel="noopener noreferrer">{p.n}</a>
                      </span>
                      <span className={`delta ${d.cls}`}>{d.txt}</span>
                      <span className="heat">{heatEmoji(p.h)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <button className="rank-expand" onClick={() => setRankExpanded((v) => !v)}>
            {rankExpanded ? 'Show fewer ▴' : 'Show full Top 25 (production: Top 100–150) ▾'}
          </button>
        </section>

        <section>
          <div className="section-head"><span className="section-title">Players</span></div>
          <div className="player-search">
            <input type="text" placeholder="Search a player…" />
            <button>Search</button>
          </div>
          <div className="player-cards">
            {c.players.map((p) => {
              const q = encodeURIComponent(p);
              return (
                <div className="player-card" key={p}>
                  <div className="avatar" />
                  <div className="name">{p}</div>
                  <div className="rank">Profile →</div>
                  <div className="player-links">
                    <a href={`https://en.wikipedia.org/wiki/Special:Search?search=${q}`} target="_blank" rel="noopener noreferrer">Wiki</a>
                    <a href={`https://www.google.com/search?q=${q}`} target="_blank" rel="noopener noreferrer">Search</a>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div className="section-head"><span className="section-title">Latest News</span></div>
          <div className="top-story">
            <div className="thumb-large" />
            <div>
              <span className="badge">TOP STORY</span>
              <h4>{c.topStory.title}</h4>
              <p>{c.topStory.dek}</p>
              <div className="src">{c.topStory.src}</div>
            </div>
          </div>
          <div className="news-grid">
            {c.news.map((n) => (
              <div className="news-item" key={n[0]}>
                <div className="thumb" />
                <h5>{n[0]}</h5>
                <div className="src">{n[1]}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="feature">
            <div className="label">{c.feature.label}</div>
            <h3>{c.feature.title}</h3>
            <p>{c.feature.body}</p>
          </div>
        </section>
      </div>

      <footer>
        <span className="mph-mark">MPH</span>Golf and Tennis Weekly — part of the MPH family
        <div className="suite-links">
          <a href="https://nysportsdaily.com" target="_blank" rel="noopener noreferrer">nysportsdaily.com</a> ·{' '}
          <a href="https://nflboxscore.com" target="_blank" rel="noopener noreferrer">nflboxscore.com</a> ·{' '}
          <a href="#">Sports &amp; Arts Daily</a>
        </div>
        <div className="suite-links">
          <a href="https://buymeacoffee.com/mhughes65v" target="_blank" rel="noopener noreferrer">💿 Buy me a record</a>
        </div>
      </footer>
    </div>
  );
}
