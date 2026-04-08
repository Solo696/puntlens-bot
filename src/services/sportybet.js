const axios = require("axios");

const REGIONS = ["ng", "gh", "ke", "tz", "ug", "za"];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://www.sportybet.com/",
  "Origin": "https://www.sportybet.com",
};

async function fetchSportybet(code) {
  for (const region of REGIONS) {
    try {
      const url = `https://www.sportybet.com/api/${region}/orders/share/${code.toUpperCase()}`;
      const res = await axios.get(url, { headers: HEADERS, timeout: 8000 });
      const data = res.data?.data || res.data;
      const selections = data?.outcomes || data?.selections || data?.betGames || data?.events || [];
      if (selections.length) return { success: true, region, data };
    } catch {
      continue;
    }
  }
  return { success: false };
}

function parseSlip(raw) {
  const data = raw?.data || raw;
  const selections = data?.outcomes || data?.selections || data?.betGames || data?.events || [];
  if (!selections.length) return null;

  const games = selections.map((s) => ({
    home:   s.homeTeamName || s.home || s.homeName || "Home",
    away:   s.awayTeamName || s.away || s.awayName || "Away",
    pick:   s.marketName  || s.market || s.outcomeName || s.selection || "?",
    odds:   parseFloat(s.odds || s.oddValue || s.price || 1).toFixed(2),
    time:   s.startTime   || s.matchTime || null,
    league: s.tournament  || s.league || s.competition || "Football",
    status: s.status      || "pending",
  }));

  const totalOdds = games.reduce((acc, g) => acc * parseFloat(g.odds), 1).toFixed(2);

  return {
    games,
    totalOdds,
    stake:        data?.stake       || data?.amount     || null,
    potentialWin: data?.potentialWin || data?.possibleWin || null,
  };
}

function formatSlip(parsed, code, region) {
  const { games, totalOdds, stake, potentialWin } = parsed;
  let msg = `📋 *Slip: \`${code.toUpperCase()}\`* (${region?.toUpperCase()})\n${"─".repeat(28)}\n\n`;

  games.forEach((g, i) => {
    const emoji = g.status === "won" ? "✅" : g.status === "lost" ? "❌" : "⏳";
    const time  = g.time ? `\n   🕐 ${fmtTime(g.time)}` : "";
    msg += `${emoji} *${i + 1}. ${g.home} vs ${g.away}*\n`;
    msg += `   🏆 ${g.league}${time}\n`;
    msg += `   🎯 *${g.pick}* @ *${g.odds}*\n\n`;
  });

  msg += `${"─".repeat(28)}\n`;
  msg += `⚽ *${games.length} games* | 📊 *Total odds: ${totalOdds}*\n`;
  if (stake)        msg += `💵 Stake: ${stake}\n`;
  if (potentialWin) msg += `💰 Potential win: ${potentialWin}\n`;
  return msg;
}

function fmtTime(t) {
  try {
    const d = new Date(typeof t === "number" ? t * 1000 : t);
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return String(t); }
}

module.exports = { fetchSportybet, parseSlip, formatSlip };
