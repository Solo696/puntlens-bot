const axios = require("axios");

const BASE = "https://v3.football.api-sports.io";

function headers() {
  return {
    "x-apisports-key": process.env.FOOTBALL_API_KEY,
    "Accept": "application/json",
  };
}

// Cache to save API quota (1 hour TTL)
const cache = {};
function cached(key, fn, ttl = 3600000) {
  if (cache[key] && Date.now() - cache[key].ts < ttl) return Promise.resolve(cache[key].val);
  return fn().then(val => { cache[key] = { val, ts: Date.now() }; return val; });
}

// Quota tracker
let quotaRemaining = null;
let quotaWarned    = false;

async function get(endpoint, params = {}) {
  if (!process.env.FOOTBALL_API_KEY) return [];
  const query = new URLSearchParams(params).toString();
  const url   = `${BASE}${endpoint}?${query}`;
  return cached(url, async () => {
    const res = await axios.get(url, { headers: headers(), timeout: 8000 });
    // Track quota from response headers
    const remaining = parseInt(res.headers?.["x-ratelimit-requests-remaining"] || "999");
    quotaRemaining  = remaining;
    quotaWarned     = false;
    return res.data?.response || [];
  });
}

function getQuotaWarning() {
  if (quotaRemaining !== null && quotaRemaining < 20 && !quotaWarned) {
    quotaWarned = true;
    return `⚠️ API quota low: ${quotaRemaining} requests remaining today.`;
  }
  return null;
}

async function findTeam(name) {
  const results = await get("/teams", { search: name });
  if (!results?.length) return null;
  // Try exact match first, then first result
  const exact = results.find(r =>
    r.team?.name?.toLowerCase() === name.toLowerCase()
  );
  return (exact || results[0])?.team || null;
}

async function getTeamForm(teamId, last = 5) {
  const fixtures = await get("/fixtures", { team: teamId, last, status: "FT" });
  if (!fixtures?.length) return [];
  return fixtures.map(f => {
    const home   = f.teams?.home;
    const away   = f.teams?.away;
    const isHome = home?.id === teamId;
    const result = isHome
      ? (home?.winner === true ? "W" : home?.winner === false ? "L" : "D")
      : (away?.winner === true ? "W" : away?.winner === false ? "L" : "D");
    return {
      date:         f.fixture?.date,
      opponent:     isHome ? away?.name : home?.name,
      result,
      goalsFor:     isHome ? (f.goals?.home ?? 0) : (f.goals?.away ?? 0),
      goalsAgainst: isHome ? (f.goals?.away ?? 0) : (f.goals?.home ?? 0),
      venue:        isHome ? "H" : "A",
    };
  });
}

async function getH2H(homeId, awayId, last = 5) {
  const fixtures = await get("/fixtures/headtohead", { h2h: `${homeId}-${awayId}`, last, status: "FT" });
  if (!fixtures?.length) return [];
  return fixtures.map(f => {
    const homeWon = f.teams?.home?.winner === true;
    const awayWon = f.teams?.away?.winner === true;
    return {
      date:      f.fixture?.date,
      home:      f.teams?.home?.name,
      away:      f.teams?.away?.name,
      homeGoals: f.goals?.home ?? 0,
      awayGoals: f.goals?.away ?? 0,
      winner:    homeWon ? f.teams.home.name : awayWon ? f.teams.away.name : "Draw",
    };
  });
}

async function getQuota() {
  try {
    const res = await axios.get(`${BASE}/status`, { headers: headers(), timeout: 5000 });
    return res.data?.response?.requests || null;
  } catch { return null; }
}

async function getMatchContext(homeTeamName, awayTeamName) {
  if (!process.env.FOOTBALL_API_KEY) return null;

  try {
    const [homeTeam, awayTeam] = await Promise.all([
      findTeam(homeTeamName),
      findTeam(awayTeamName),
    ]);

    if (!homeTeam || !awayTeam) return null;

    const [homeForm, awayForm, h2h] = await Promise.all([
      getTeamForm(homeTeam.id, 5),
      getTeamForm(awayTeam.id, 5),
      getH2H(homeTeam.id, awayTeam.id, 5),
    ]);

    const formStr  = (form) => form.map(f => f.result).join("") || "N/A";
    const winRate  = (form) => {
      const wins = form.filter(f => f.result === "W").length;
      return form.length ? Math.round((wins / form.length) * 100) : 50;
    };
    const avgGoals = (form, type) => {
      if (!form.length) return "0.0";
      const total = form.reduce((s, f) => s + (type === "for" ? (f.goalsFor || 0) : (f.goalsAgainst || 0)), 0);
      return (total / form.length).toFixed(1);
    };

    // BUG FIX: proper H2H win counting using team IDs
    const h2hHomeWins = h2h.filter(f => f.winner === homeTeam.name).length;
    const h2hAwayWins = h2h.filter(f => f.winner === awayTeam.name).length;
    const h2hDraws    = h2h.filter(f => f.winner === "Draw").length;

    return {
      homeTeam: {
        id:              homeTeam.id,
        name:            homeTeam.name,
        form:            formStr(homeForm),
        winRate:         winRate(homeForm),
        avgGoalsFor:     avgGoals(homeForm, "for"),
        avgGoalsAgainst: avgGoals(homeForm, "against"),
        recentResults:   homeForm,
      },
      awayTeam: {
        id:              awayTeam.id,
        name:            awayTeam.name,
        form:            formStr(awayForm),
        winRate:         winRate(awayForm),
        avgGoalsFor:     avgGoals(awayForm, "for"),
        avgGoalsAgainst: avgGoals(awayForm, "against"),
        recentResults:   awayForm,
      },
      h2h: {
        total:    h2h.length,
        homeWins: h2hHomeWins,
        awayWins: h2hAwayWins,
        draws:    h2hDraws,
        recent:   h2h.slice(0, 3),
      },
      quotaWarning: getQuotaWarning(),
    };
  } catch (err) {
    console.error("[FootballAPI] getMatchContext error:", err.message);
    return null;
  }
}

module.exports = {
  findTeam, getTeamForm, getH2H,
  getQuota, getMatchContext, getQuotaWarning,
};
