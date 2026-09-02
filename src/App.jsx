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

// ---------------------------------------------------------------------
// Daily Spotlight rosters — mixes current stars with legends, same
// spirit as nysportsdaily's DAILY_PLAYERS. Modest starting list (easy
// to extend later); each entry just needs a name and a short fact —
// photos are resolved live via Wikipedia search, not stored here.
// ---------------------------------------------------------------------
const DAILY_PLAYERS_GOLF = [
  { name: 'Scottie Scheffler', active: true, fact: 'The dominant force in men\'s golf in recent seasons, spending extended stretches at world No. 1.' },
  { name: 'Rory McIlroy', active: true, fact: 'Completed the career Grand Slam with his 2025 Masters win, joining an elite group of golfers to win all four majors.' },
  { name: 'Jon Rahm', active: true, fact: 'Former world No. 1 known for an aggressive, powerful playing style.' },
  { name: 'Xander Schauffele', active: true, fact: 'Two-time major champion known for his consistency across all four majors.' },
  { name: 'Ludvig Åberg', active: true, fact: 'One of the fastest-rising young stars in men\'s golf since turning professional.' },
  { name: 'Viktor Hovland', active: true, fact: 'Norwegian standout known for elite ball-striking and a breakout run of PGA Tour wins.' },
  { name: 'Bryson DeChambeau', active: true, fact: 'Known for a science-driven approach to the game and exceptional driving distance.' },
  { name: 'Nelly Korda', active: true, fact: "One of the top-ranked women's golfers, known for a dominant run of LPGA Tour wins." },
  { name: 'Lydia Ko', active: true, fact: 'Became the youngest golfer, male or female, to reach world No. 1 in professional golf.' },
  { name: 'Lilia Vu', active: true, fact: "Multiple major champion who became one of the LPGA Tour's top players in recent seasons." },
  { name: 'Jack Nicklaus', active: false, fact: 'Won 18 major championships, still the most in golf history.' },
  { name: 'Arnold Palmer', active: false, fact: "Helped popularize golf as a television sport and built one of the sport's most beloved followings, \"Arnie's Army.\"" },
  { name: 'Tiger Woods', active: false, fact: 'Tied the record for career PGA Tour wins and reshaped the sport\'s popularity in the 2000s.' },
  { name: 'Gary Player', active: false, fact: 'One of only five golfers to complete the career Grand Slam, with a career spanning six decades.' },
  { name: 'Tom Watson', active: false, fact: 'Eight-time major champion known for his rivalry with Jack Nicklaus in the 1970s and 80s.' },
  { name: 'Seve Ballesteros', active: false, fact: 'Five-time major champion whose flair and creativity around the greens made him a fan favorite worldwide.' },
  { name: 'Ben Hogan', active: false, fact: 'Won nine major championships and is remembered for one of the great comebacks in sports, returning to win majors after a near-fatal car accident.' },
  { name: 'Annika Sorenstam', active: false, fact: 'Won 10 major championships and is widely regarded as one of the greatest women\'s golfers ever.' },
  { name: 'Mickey Wright', active: false, fact: 'Won 13 major championships and is often cited by peers as having the finest swing in golf history.' },
  { name: 'Nancy Lopez', active: false, fact: 'Won Rookie of the Year and Player of the Year in the same season, helping popularize the LPGA Tour.' },
  { name: 'Justin Thomas', active: true, fact: 'Two-time PGA Championship winner known for one of the most explosive swings on tour.' },
  { name: 'Jordan Spieth', active: true, fact: 'Won three of the four majors before turning 24, missing only the PGA Championship for the career Grand Slam.' },
  { name: 'Patrick Cantlay', active: true, fact: 'Known for his calm, methodical style and a run as one of the top players in FedEx Cup standings.' },
  { name: 'Tommy Fleetwood', active: true, fact: 'Ryder Cup mainstay for Europe known for his consistency across major championships.' },
  { name: 'Brooks Koepka', active: true, fact: 'Won five major championships, with a knack for peaking specifically for golf\'s biggest events.' },
  { name: 'Hideki Matsuyama', active: true, fact: 'Became the first Japanese man to win a major championship, taking the 2021 Masters.' },
  { name: 'Collin Morikawa', active: true, fact: 'Won a major in just his second career start at one, a rare feat in modern golf.' },
  { name: 'Cameron Smith', active: true, fact: 'Known for one of the best short games in golf, highlighted by his 2022 Open Championship win.' },
  { name: 'Shane Lowry', active: true, fact: 'Won the 2019 Open Championship at Royal Portrush in front of an emotional home crowd in Ireland.' },
  { name: 'Charley Hull', active: true, fact: 'English standout known for an aggressive playing style and consistent major championship contention.' },
  { name: 'Jin Young Ko', active: true, fact: 'Spent extended stretches at world No. 1 and is known for one of the most efficient swings in the women\'s game.' },
  { name: 'Minjee Lee', active: true, fact: 'Multiple major champion known for her long game and consistency on the LPGA Tour.' },
  { name: 'Brooke Henderson', active: true, fact: 'Canada\'s most successful golfer, with the most LPGA Tour wins by a Canadian in history.' },
  { name: 'Rose Zhang', active: true, fact: 'Won on her professional debut on the LPGA Tour after a decorated amateur and collegiate career.' },
  { name: 'Sam Snead', active: false, fact: 'Holds the record for most PGA Tour wins in history, with a career spanning four decades.' },
  { name: 'Byron Nelson', active: false, fact: 'Won 11 consecutive PGA Tour events in 1945, a record considered untouchable in modern golf.' },
  { name: 'Walter Hagen', active: false, fact: 'Won 11 major championships and helped elevate professional golfers\' status in the sport\'s early era.' },
  { name: 'Bobby Jones', active: false, fact: 'Won the Grand Slam of his era as an amateur in 1930, then co-founded Augusta National Golf Club.' },
  { name: 'Phil Mickelson', active: false, fact: 'Won six major championships and is remembered for thrilling, high-risk shot-making across his career.' },
  { name: 'Ernie Els', active: false, fact: 'Won four major championships and was known as "The Big Easy" for his smooth swing.' },
  { name: 'Greg Norman', active: false, fact: 'Spent more weeks at world No. 1 than all but a handful of players in golf history.' },
  { name: 'Nick Faldo', active: false, fact: 'Won six major championships and later became one of golf\'s most recognizable broadcasters.' },
  { name: 'Lee Trevino', active: false, fact: 'Won six major championships and was known for his charisma and self-taught playing style.' },
  { name: 'Babe Zaharias', active: false, fact: 'A founding member of the LPGA who won 10 major championships as one of the great all-around athletes of the 20th century.' },
  { name: 'Kathy Whitworth', active: false, fact: 'Holds the record for most professional golf tour wins by any player, male or female.' },
  { name: 'Se Ri Pak', active: false, fact: 'Her 1998 U.S. Women\'s Open win inspired a wave of South Korean golfers who followed her onto the LPGA Tour.' },
  { name: 'Karrie Webb', active: false, fact: 'Completed the career Grand Slam and the Super Career Grand Slam in women\'s golf.' },
  { name: 'Louise Suggs', active: false, fact: 'A founding member of the LPGA and winner of 11 major championships.' },
  { name: 'Sergio García', active: false, fact: 'Broke through for his first major at the 2017 Masters after years as one of the game\'s best without a major title.' },
  { name: 'Ariya Jutanugarn', active: false, fact: 'Won multiple major championships and spent time at world No. 1 as one of Thailand\'s most successful golfers.' },
];

const DAILY_PLAYERS_TENNIS = [
  { name: 'Jannik Sinner', active: true, fact: 'Reached world No. 1 and has established himself among the top Grand Slam contenders on tour.' },
  { name: 'Carlos Alcaraz', active: true, fact: 'Became the youngest world No. 1 in ATP history at age 19.' },
  { name: 'Novak Djokovic', active: true, fact: 'Holds the record for most weeks at world No. 1 in ATP history.' },
  { name: 'Daniil Medvedev', active: true, fact: 'Known for an unorthodox playing style and a Grand Slam title on hard courts.' },
  { name: 'Alexander Zverev', active: true, fact: 'German star known for one of the biggest serves in the modern men\'s game.' },
  { name: 'Iga Swiatek', active: true, fact: 'Multiple-time French Open champion known for her dominance on clay.' },
  { name: 'Coco Gauff', active: true, fact: 'Broke through as a teenager and has since won multiple Grand Slam titles.' },
  { name: 'Aryna Sabalenka', active: true, fact: 'Known for one of the most powerful games in women\'s tennis and multiple Grand Slam titles.' },
  { name: 'Elena Rybakina', active: true, fact: 'Wimbledon champion known for one of the most dominant serves on the WTA Tour.' },
  { name: 'Roger Federer', active: false, fact: 'Won 20 Grand Slam singles titles across a career that redefined the men\'s game.' },
  { name: 'Rafael Nadal', active: false, fact: 'Won a record 14 French Open titles, earning the nickname "King of Clay."' },
  { name: 'Pete Sampras', active: false, fact: 'Held the men\'s Grand Slam singles record for years and won a record seven Wimbledon titles among his 14 majors.' },
  { name: 'Andre Agassi', active: false, fact: 'One of the few men to complete the career Grand Slam, known for his colorful personality and return game.' },
  { name: 'Björn Borg', active: false, fact: 'Won 11 Grand Slam titles and was part of one of tennis\'s great rivalries with John McEnroe.' },
  { name: 'Rod Laver', active: false, fact: 'The only player to complete the calendar-year Grand Slam twice, in 1962 and 1969.' },
  { name: 'Serena Williams', active: false, fact: 'Won 23 Grand Slam singles titles, the most of any player in the Open Era.' },
  { name: 'Martina Navratilova', active: false, fact: 'Won 18 Grand Slam singles titles and dominated women\'s tennis through the 1980s.' },
  { name: 'Steffi Graf', active: false, fact: 'The only player, man or woman, to complete a "Golden Slam" — all four majors plus Olympic gold in the same year.' },
  { name: 'Chris Evert', active: false, fact: 'Won 18 Grand Slam singles titles and was part of a defining rivalry with Martina Navratilova.' },
  { name: 'Billie Jean King', active: false, fact: 'Won 12 Grand Slam singles titles and became a pioneering figure for equality in professional sports.' },
  { name: 'Holger Rune', active: true, fact: 'One of the top young players to break into the ATP top 10, known for his aggressive baseline game.' },
  { name: 'Taylor Fritz', active: true, fact: 'Reached a Grand Slam final and became the top-ranked American man on tour.' },
  { name: 'Ben Shelton', active: true, fact: 'Known for one of the biggest serves in men\'s tennis and a rapid rise up the ATP rankings.' },
  { name: 'Casper Ruud', active: true, fact: 'Reached multiple Grand Slam finals, known for his heavy topspin game built for clay.' },
  { name: 'Stefanos Tsitsipas', active: true, fact: 'Reached the world top 5 and a French Open final with his one-handed backhand and all-court game.' },
  { name: 'Frances Tiafoe', active: true, fact: 'Known for his energetic playing style and a breakthrough US Open semifinal run.' },
  { name: 'Jack Draper', active: true, fact: 'British left-hander who broke into the ATP top 10 behind a powerful serve and forehand.' },
  { name: 'Jessica Pegula', active: true, fact: 'Reached the top of the WTA rankings in doubles and singles, known for her consistent baseline game.' },
  { name: 'Madison Keys', active: true, fact: 'Won a Grand Slam singles title behind one of the biggest serves in the women\'s game.' },
  { name: 'Qinwen Zheng', active: true, fact: 'Won Olympic gold in singles and reached a Grand Slam final, becoming a leading Chinese tennis star.' },
  { name: 'Mirra Andreeva', active: true, fact: 'Broke into the WTA top 10 as a teenager, among the youngest players to do so in recent years.' },
  { name: 'Jasmine Paolini', active: true, fact: 'Reached both the French Open and Wimbledon finals in the same season, a breakout year for Italian tennis.' },
  { name: 'John McEnroe', active: false, fact: 'Won seven Grand Slam singles titles and is remembered for his fiery on-court personality and rivalry with Björn Borg.' },
  { name: 'Jimmy Connors', active: false, fact: 'Won eight Grand Slam singles titles and held the world No. 1 ranking for a record number of consecutive weeks.' },
  { name: 'Ivan Lendl', active: false, fact: 'Won eight Grand Slam singles titles and helped usher in the modern power-baseline game.' },
  { name: 'Boris Becker', active: false, fact: 'Won Wimbledon at just 17 years old, still the youngest men\'s champion in tournament history.' },
  { name: 'Stefan Edberg', active: false, fact: 'Won six Grand Slam singles titles known for his elegant serve-and-volley style.' },
  { name: 'Andy Murray', active: false, fact: 'Ended a 77-year British drought at Wimbledon and won three Grand Slam singles titles overall.' },
  { name: 'Stan Wawrinka', active: false, fact: 'Won three Grand Slam titles, each time defeating the world No. 1 in the final.' },
  { name: 'Justine Henin', active: false, fact: 'Won seven Grand Slam singles titles, known for one of the best one-handed backhands in the women\'s game.' },
  { name: 'Monica Seles', active: false, fact: 'Won nine Grand Slam singles titles before age 20, one of the most dominant runs in tennis history.' },
  { name: 'Venus Williams', active: false, fact: 'Won seven Grand Slam singles titles and was a driving force behind equal prize money in tennis.' },
  { name: 'Maria Sharapova', active: false, fact: 'Completed the career Grand Slam and became one of the most recognizable athletes in the world.' },
  { name: 'Lindsay Davenport', active: false, fact: 'Won three Grand Slam singles titles and an Olympic gold medal, known for her powerful groundstrokes.' },
  { name: 'Arantxa Sánchez Vicario', active: false, fact: 'Won four Grand Slam singles titles and was known for her relentless defensive game.' },
  { name: 'Margaret Court', active: false, fact: 'Holds the record for most Grand Slam singles titles in tennis history, with 24.' },
  { name: 'Evonne Goolagong', active: false, fact: 'Won seven Grand Slam singles titles and was one of the first Indigenous Australians to reach global sporting stardom.' },
  { name: 'Grigor Dimitrov', active: true, fact: 'Known for a versatile, classic playing style and a career-high ranking inside the ATP top 3.' },
  { name: 'Naomi Osaka', active: true, fact: 'Won four Grand Slam singles titles and became one of the highest-profile athletes in the world.' },
  { name: 'Ashleigh Barty', active: false, fact: 'Reached world No. 1 and won three Grand Slam titles before retiring at the peak of her career in 2022.' },
];

// Deterministic "today's pick" — same day, same visitor, same player,
// rotating through the full roster before repeating. Pure date-seeded,
// no team-repeat logic needed here (unlike nysportsdaily's franchises).
function getDailyPlayer(pool) {
  const daysSinceEpoch = Math.floor(Date.now() / 86400000);
  return pool[daysSinceEpoch % pool.length];
}

// Pulls |key = value pairs out of a MediaWiki infobox template, ported
// from The Scouting Report. Stops at the first top-level closing }} so
// it doesn't wander into later templates on the page.
// Deterministic "dispatch number" from a name, purely decorative —
// same flavor as The Scouting Report's card numbering.
function dispatchNumber(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return String(1000 + (hash % 9000));
}

function initials(name) {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

function parseInfobox(wikitext) {
  const start = wikitext.indexOf('{{Infobox');
  if (start === -1) return {};
  let depth = 0;
  let end = start;
  for (let i = start; i < wikitext.length; i++) {
    if (wikitext.slice(i, i + 2) === '{{') { depth++; i++; }
    else if (wikitext.slice(i, i + 2) === '}}') { depth--; i++; if (depth === 0) { end = i; break; } }
  }
  const block = wikitext.slice(start, end);
  const fields = {};
  const lines = block.split(/\n\|/).slice(1);
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).split('\n')[0].trim();
    value = value
      .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2') // [[link|text]] -> text
      .replace(/'''?/g, '')
      .replace(/<ref[^>]*\/>/gi, '')
      .replace(/<ref[^>]*>.*?<\/ref>/gi, '')
      .replace(/\{\{[^{}]*\}\}/g, '') // strip one level of nested templates (flag icons, etc.)
      .replace(/<!--.*?-->/g, '')
      .trim();
    if (key && value) fields[key] = value;
  }
  return fields;
}

// Golf and tennis Wikipedia infoboxes use entirely different field names
// than the statlabelN/statvalueN pattern common on NFL/NBA pages, so this
// uses its own candidate list per sport rather than reusing that pattern.
// Returns up to 4 chips, skipping any field that wasn't found or that
// still looks like leftover wiki markup after cleaning.
function statChipsForSport(fields, sport) {
  const candidates = sport === 'golf'
    ? [
        { key: 'yearpro', label: 'Turned Pro' },
        { key: 'extour', label: 'Tour' },
        { key: 'prowins', label: 'Pro Wins' },
        { key: 'majorwins', label: 'Majors' },
      ]
    : [
        { key: 'turnedpro', label: 'Turned Pro' },
        { key: 'plays', label: 'Plays' },
        { key: 'singlestitles', label: 'Singles Titles' },
        { key: 'highestsinglesranking', label: 'Career-High Rank' },
      ];
  const chips = [];
  for (const { key, label } of candidates) {
    const value = fields[key];
    if (value && !value.includes('{{') && !value.includes('}}') && value.length < 40) {
      chips.push({ label, value });
    }
    if (chips.length >= 4) break;
  }
  return chips;
}

export default function App() {
  const [theme, setTheme] = useState('golf');
  const [period, setPeriod] = useState('wk');
  const [view, setView] = useState('home'); // 'home' | 'rankings' | 'majors' | 'amateur' | 'tutorials' | 'trivia' | 'tv'
  const [liveRankings, setLiveRankings] = useState(null); // null = not loaded yet, [] = loaded-but-empty
  const [spotlightPhoto, setSpotlightPhoto] = useState(null);
  const [spotlightDescription, setSpotlightDescription] = useState(null);
  const [spotlightStats, setSpotlightStats] = useState([]);
  const [spotlightPageUrl, setSpotlightPageUrl] = useState(null);
  const [liveNews, setLiveNews] = useState(null); // null = not loaded yet, [] = loaded-but-empty

  const c = SAMPLE[theme];

  const dailyPlayerPool = theme === 'golf' ? DAILY_PLAYERS_GOLF : DAILY_PLAYERS_TENNIS;
  const dailyPlayer = getDailyPlayer(dailyPlayerPool);

  // Trading-card data layer, ported from The Scouting Report's approach:
  // search Wikipedia by name (self-healing — never depends on a stored
  // URL that could go stale), pull the clean summary for photo/description,
  // then pull raw infobox wikitext for a few "stat chip" fields. Golf and
  // tennis infoboxes use different field names than the statlabelN/
  // statvalueN pattern the original tool was built around, so this uses
  // its own sport-specific candidate list instead.
  useEffect(() => {
    let cancelled = false;
    setSpotlightPhoto(null);
    setSpotlightDescription(null);
    setSpotlightStats([]);
    setSpotlightPageUrl(null);

    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(dailyPlayer.name)}&format=json&origin=*&srlimit=1`;
    let resolvedTitle = null;

    fetch(searchUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return null;
        const title = data?.query?.search?.[0]?.title;
        if (!title) return null;
        resolvedTitle = title;
        return fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
      })
      .then((res) => (res && res.ok ? res.json() : null))
      .then((summary) => {
        if (cancelled || !summary) return;
        if (summary.thumbnail?.source) setSpotlightPhoto(summary.thumbnail.source);
        if (summary.description) setSpotlightDescription(summary.description);
        if (summary.content_urls?.desktop?.page) setSpotlightPageUrl(summary.content_urls.desktop.page);
      })
      .catch(() => {});

    // Separate chain for infobox stats — independent of the summary
    // fetch above so a failure here never blocks the photo/description.
    (async () => {
      try {
        // Reuse the same search result rather than searching twice.
        const searchData = await (await fetch(searchUrl)).json();
        const title = searchData?.query?.search?.[0]?.title;
        if (!title || cancelled) return;
        const wikitextUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&rvsection=0&format=json&origin=*&titles=${encodeURIComponent(title)}`;
        const wtData = await (await fetch(wikitextUrl)).json();
        const page = Object.values(wtData?.query?.pages || {})[0];
        const wikitext = page?.revisions?.[0]?.slots?.main?.['*'] || '';
        const fields = parseInfobox(wikitext);
        const chips = statChipsForSport(fields, theme);
        if (!cancelled) setSpotlightStats(chips);
      } catch {
        // Non-fatal — the card still works with photo + description only.
      }
    })();

    return () => { cancelled = true; };
  }, [dailyPlayer.name]);

  // News is now fetched server-side (api/fetch-news.js, on a daily cron)
  // and stored in Supabase — no client-side CORS proxy involved at all,
  // after two different free proxy services (rss2json, allorigins.win)
  // both proved too unreliable for daily production use. This just
  // reads whatever the server-side job has already gathered, same
  // pattern as the rankings fetch.
  useEffect(() => {
    let cancelled = false;
    setLiveNews(null);
    supabase
      .from('gtw_news')
      .select('*')
      .eq('sport', theme)
      .order('published_at', { ascending: false })
      .limit(8)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data || data.length === 0) {
          setLiveNews([]);
          return;
        }
        setLiveNews(data.map((row) => ({
          title: row.title,
          source: row.source || 'Google News',
          link: row.link,
        })));
      })
      .catch(() => { if (!cancelled) setLiveNews([]); });
    return () => { cancelled = true; };
  }, [theme]);

  // Try live data first; fall back to sample rows if the table's empty
  // (e.g. before the first weekly pull has run) or the query fails.
  useEffect(() => {
    let cancelled = false;
    async function loadRankings() {
      if (!supabase) {
        // Env vars not configured yet — stay on sample data.
        if (!cancelled) setLiveRankings([]);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('gtw_rankings_snapshots')
          .select('*')
          .eq('sport', theme)
          .order('week_of', { ascending: false })
          .order('rank', { ascending: true })
          .limit(2000);
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

  // Which tour codes belong to which column, per sport — matches the
  // order of c.rankCols (men's tour first, women's second).
  const TOUR_BY_SPORT = { golf: ['owgr', 'rolex'], tennis: ['atp', 'wta'] };

  // Group the raw fetched rows into per-tour columns using only the
  // most recent week_of for that tour. Returns null per column until
  // that tour actually has data (e.g. women's golf/Rolex, not fetched
  // yet) — the render below falls back to sample data for that column
  // specifically, so one missing tour doesn't blank out the whole page.
  const liveColumnsBySport = useMemo(() => {
    if (!liveRankings || liveRankings.length === 0) return null;
    const tours = TOUR_BY_SPORT[theme] || [];
    return tours.map((tour) => {
      const rowsForTour = liveRankings.filter((r) => r.tour === tour);
      if (rowsForTour.length === 0) return null;
      const latestWeek = rowsForTour.reduce(
        (max, r) => (r.week_of > max ? r.week_of : max),
        rowsForTour[0].week_of
      );
      const thisWeek = rowsForTour
        .filter((r) => r.week_of === latestWeek)
        .sort((a, b) => a.rank - b.rank);
      // Movement (d) is 0/flat until a second week's snapshot exists to
      // diff against — this is the very first pull, so there's nothing
      // to compare yet. Once next Tuesday's cron run lands, real deltas
      // take over automatically.
      return thisWeek.map((r) => ({ n: r.player_name, d: 0, h: null }));
    });
  }, [liveRankings, theme]);

  const rankColumnsHome = useMemo(() => {
    return c.rankBase.map((base, i) => {
      const live = liveColumnsBySport && liveColumnsBySport[i];
      if (live && live.length > 0) return live.slice(0, 5);
      return extendRankings(base, 25).slice(0, 5);
    });
  }, [c, liveColumnsBySport]);

  const rankColumnsFull = useMemo(() => {
    return c.rankBase.map((base, i) => {
      const live = liveColumnsBySport && liveColumnsBySport[i];
      if (live && live.length > 0) return live.slice(0, 100);
      return extendRankings(base, 100);
    });
  }, [c, liveColumnsBySport]);

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
            {[
              ['rankings', 'Rankings'],
              ['majors', 'Majors & History'],
              ['amateur', 'Amateur'],
              ['tutorials', 'Tutorials'],
              ['trivia', 'Trivia'],
              ['tv', 'TV Schedule'],
            ].map(([key, label]) => (
              <a
                key={key}
                href="#"
                className={view === key ? 'active' : ''}
                onClick={(e) => { e.preventDefault(); setView(key); }}
              >
                {label}
              </a>
            ))}
          </div>
        </div>
      </header>

      {view === 'home' && (
      <div className="wrap">
        <section>
          <div className="section-head"><span className="section-title">Daily Spotlight</span></div>
          <div className="dispatch-card">
            <div className="dispatch-perf" aria-hidden="true">
              {Array.from({ length: 24 }).map((_, i) => <span key={i} className="dispatch-perf-dot" />)}
            </div>
            <div className="dispatch-header-row">
              <span className="dispatch-no">DISPATCH NO. {dispatchNumber(dailyPlayer.name)}</span>
              <span className="dispatch-tag">{dailyPlayer.active ? 'ACTIVE TODAY' : 'LEGENDS SERIES'}</span>
            </div>
            <div className="dispatch-name-row">
              {spotlightPhoto ? (
                <img className="dispatch-thumb" src={spotlightPhoto} alt="" />
              ) : (
                <div className="dispatch-avatar-fallback">{initials(dailyPlayer.name)}</div>
              )}
              <div>
                <div className="dispatch-name">{dailyPlayer.name}</div>
                {spotlightDescription && <div className="dispatch-desc">{spotlightDescription}</div>}
              </div>
            </div>
            <div className="dispatch-hr" />
            <p className="dispatch-fact">{dailyPlayer.fact}</p>
            {spotlightStats.length > 0 && (
              <div className="dispatch-stats-row">
                {spotlightStats.map((s) => (
                  <div className="dispatch-stat-chip" key={s.label}>
                    <div className="dispatch-stat-value">{s.value}</div>
                    <div className="dispatch-stat-label">{s.label}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="dispatch-hr" />
            <div className="dispatch-link-row">
              <a
                className="dispatch-link-chip"
                href={spotlightPageUrl || `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(dailyPlayer.name)}`}
                target="_blank" rel="noopener noreferrer"
              >
                Wikipedia →
              </a>
              <a
                className="dispatch-link-chip"
                href={`https://www.google.com/search?q=${encodeURIComponent(dailyPlayer.name)}`}
                target="_blank" rel="noopener noreferrer"
              >
                Search →
              </a>
            </div>
            <div className="dispatch-footer">SOURCE: WIKIPEDIA · SCOUTING REPORT</div>
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
            <a className="section-link" href="#" onClick={(e) => { e.preventDefault(); setView('rankings'); }}>Full top 100 →</a>
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
                {rankColumnsHome[i].map((p, idx) => {
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
          <button className="rank-expand" onClick={() => setView('rankings')}>
            View full Top 100 →
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
          {(() => {
            const useLive = liveNews && liveNews.length > 0;
            const top = useLive ? liveNews[0] : null;
            const rest = useLive ? liveNews.slice(1, 5) : c.news;
            return (
              <>
                <div className="top-story">
                  <div className="thumb-large" />
                  <div>
                    <span className="badge">TOP STORY</span>
                    {useLive ? (
                      <>
                        <h4><a href={top.link} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{top.title}</a></h4>
                        <div className="src">{top.source}</div>
                      </>
                    ) : (
                      <>
                        <h4>{c.topStory.title}</h4>
                        <p>{c.topStory.dek}</p>
                        <div className="src">{c.topStory.src}</div>
                      </>
                    )}
                  </div>
                </div>
                <div className="news-grid">
                  {useLive
                    ? rest.map((n) => (
                        <div className="news-item" key={n.link}>
                          <div className="thumb" />
                          <h5><a href={n.link} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{n.title}</a></h5>
                          <div className="src">{n.source}</div>
                        </div>
                      ))
                    : rest.map((n) => (
                        <div className="news-item" key={n[0]}>
                          <div className="thumb" />
                          <h5>{n[0]}</h5>
                          <div className="src">{n[1]}</div>
                        </div>
                      ))}
                </div>
              </>
            );
          })()}
        </section>

        <section>
          <div className="feature">
            <div className="label">{c.feature.label}</div>
            <h3>{c.feature.title}</h3>
            <p>{c.feature.body}</p>
          </div>
        </section>
      </div>
      )}

      {view === 'rankings' && (
        <div className="wrap">
          <div className="page-header">
            <a href="#" className="back-home" onClick={(e) => { e.preventDefault(); setView('home'); }}>← Back to Home</a>
            <h2>Full Rankings — Top 100</h2>
          </div>
          <div className="period-toggle">
            {['wk', 'mo', 'yr'].map((p) => (
              <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>
                {p.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="full-rankings-grid">
            {c.rankCols.map((label, i) => (
              <div className="rank-col" key={label}>
                <div className="col-label">{label}</div>
                {rankColumnsFull[i].map((p, idx) => {
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
        </div>
      )}

      {['majors', 'amateur', 'tutorials', 'trivia', 'tv'].includes(view) && (
        <div className="wrap">
          <div className="page-header">
            <a href="#" className="back-home" onClick={(e) => { e.preventDefault(); setView('home'); }}>← Back to Home</a>
            <h2>{{
              majors: 'Majors & History',
              amateur: 'Amateur',
              tutorials: 'Tutorials',
              trivia: 'Trivia',
              tv: 'TV Schedule',
            }[view]}</h2>
          </div>
          <div className="coming-soon">
            <p>This section is still being built — check back soon.</p>
          </div>
        </div>
      )}

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
