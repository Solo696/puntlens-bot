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
      const selections = extractSelections(data);
      if (selections.length) return { success: true, region, data };
    } catch { continue; }
  }
  return { success: false };
}

function extractSelections(data) {
  return data?.outcomes || data?.selections || data?.betGames || data?.events || data?.fixtures || data?.bets || data?.items || [];
}

function parseSlip(raw) {
  const data       = raw?.data || raw;
  const selections = extractSelections(data);
  if (!selections.length) return null;

  const games = selections.map((s) => {
    const home   = s.homeTeamName || s.homeName || s.home || "Home";
    const away   = s.awayTeamName || s.awayName || s.away || "Away";
    const sport  = (typeof s.sport === "object" ? s.sport?.name : s.sport) || s.sportName || "Unknown";
    const market = s.markets?.[0];
    const marketDesc = market?.desc || "";
    const marketSpec = market?.specifier || "";
    const outcomeList = market?.outcomes || market?.selections || [];
    const outcome     = outcomeList?.[0];
    const outcomeName = outcome?.desc || outcome?.name || outcome?.outcomeName || "";
    const oddsRaw     = outcome?.odds || outcome?.oddValue || outcome?.price;

    let pickStr = outcomeName;
    if (marketSpec) {
      const specVal = marketSpec.split("=")[1];
      if (specVal && outcomeName && !outcomeName.includes(specVal)) pickStr = `${outcomeName} ${specVal}`;
    }
    if (marketDesc && marketDesc !== pickStr) {
      pickStr = pickStr ? `${pickStr} (${marketDesc})` : marketDesc;
    }
    if (!pickStr) pickStr = "?";

    const oddsNum = parseFloat(oddsRaw);
    const odds    = (!isNaN(oddsNum) && oddsNum > 1) ? oddsNum.toFixed(2) : "?";
    const timeRaw = s.estimateStartTime || s.startTime || s.matchTime;
    const league  = s.sport?.category?.tournament?.name || s.tournament?.name || s.league || "";
    const statusMap = { 0: "pending", 1: "won", 2: "lost", 3: "void", 4: "ended" };
    const status  = statusMap[s.status] || s.matchStatus || "pending";

    return {
      home, away, pick: pickStr, odds, sport, time: timeRaw, league, status,
      // Raw IDs needed for booking code creation
      eventId:   s.eventId,
      marketId:  market?.id,
      outcomeId: outcome?.id,
      oddsRaw:   oddsRaw,
      specifier: market?.specifier || "",
      product:   market?.product,
    };
  });

  const validOdds = games.filter(g => g.odds !== "?").map(g => parseFloat(g.odds));
  const totalOdds = validOdds.length ? validOdds.reduce((a, b) => a * b, 1).toFixed(2) : "?";

  return {
    games,
    totalOdds,
    stake:        data?.stake || data?.amount || null,
    potentialWin: data?.potentialWin || data?.possibleWin || null,
  };
}

function formatSlip(parsed, code, region) {
  const { games, totalOdds, stake, potentialWin } = parsed;
  let msg = `📋 *Slip: \`${code.toUpperCase()}\`* (${region?.toUpperCase()})\n${"─".repeat(28)}\n\n`;

  games.forEach((g, i) => {
    const emoji  = g.status === "won" ? "✅" : g.status === "lost" ? "❌" : g.status === "ended" ? "🏁" : "⏳";
    const time   = g.time   ? `\n   🕐 ${fmtTime(g.time)}` : "";
    const league = g.league ? `\n   🏆 ${g.league}` : "";
    const sport  = g.sport  ? ` · ${g.sport}` : "";
    msg += `${emoji} *${i+1}. ${g.home} vs ${g.away}*${sport}${league}${time}\n`;
    msg += `   🎯 *${g.pick}* @ *${g.odds}*\n\n`;
  });

  msg += `${"─".repeat(28)}\n`;
  msg += `⚽ *${games.length} games* | 📊 *Total odds: ${totalOdds}*\n`;
  if (stake)        msg += `💵 Stake: ${stake}\n`;
  if (potentialWin) msg += `💰 Potential win: ${potentialWin}\n`;
  return msg;
}

// ── Booking Code Creator ──────────────────────────────────────────────────────
// Uses real eventId/marketId/outcomeId extracted from existing slips
async function createBookingCode(games, region = "ng") {
  const outcomes = games
    .map(g => ({
      eventId:   g.eventId,
      marketId:  String(g.marketId),
      outcomeId: String(g.outcomeId),
      odds:      String(g.oddsRaw || g.odds),
      specifier: g.specifier || "",
      product:   g.product || 1,
    }))
    .filter(o => o.eventId && o.marketId && o.outcomeId);

  if (!outcomes.length) return { success: false, reason: "no_event_ids" };

  // Try multiple payload shapes — Sportybet may vary by region/version
  const payloads = [
    { outcomes },
    { selections: outcomes },
    { betItems: outcomes },
    { bets: outcomes },
  ];

  for (const payload of payloads) {
    try {
      const res = await axios.post(
        `https://www.sportybet.com/api/${region}/orders/share`,
        payload,
        {
          headers: { ...HEADERS, "Content-Type": "application/json" },
          timeout: 10000,
        }
      );

      const code =
        res.data?.data?.shareCode  ||
        res.data?.data?.bookingCode ||
        res.data?.data?.code       ||
        res.data?.shareCode        ||
        res.data?.bookingCode      ||
        res.data?.code;

      if (code) return { success: true, code, region, payload: Object.keys(payload)[0] };

      // Got a response but no code — log it for debugging
      console.log("[CreateCode] Response no code:", JSON.stringify(res.data).slice(0, 300));

    } catch (err) {
      console.log(`[CreateCode] ${region}/${Object.keys(payload)[0]} failed:`, err.response?.status, err.message);
      continue;
    }
  }

  return { success: false, reason: "all_payloads_failed" };
}

function fmtTime(t) {
  try {
    const d = new Date(typeof t === "number" && t > 1e10 ? t : t * 1000);
    return d.toLocaleString("en-GB", { weekday:"short", day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
  } catch { return String(t); }
}

module.exports = { fetchSportybet, parseSlip, formatSlip, createBookingCode };
