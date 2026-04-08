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
  return data?.outcomes || data?.selections || data?.betGames ||
         data?.events   || data?.fixtures  || data?.bets     ||
         data?.items    || [];
}

// Find the best market+outcome from a game's markets array
// Looks for: isActive=1, valid odds (>1.00), has a desc
function findBestMarketOutcome(markets) {
  if (!markets?.length) return { market: null, outcome: null };

  for (const market of markets) {
    const outcomes = market?.outcomes || market?.selections || [];
    for (const outcome of outcomes) {
      const odds = parseFloat(outcome?.odds || outcome?.oddValue || outcome?.price || 0);
      const isActive = outcome?.isActive === 1 || outcome?.isActive === "1" || outcome?.active === true;
      const hasDesc  = !!(outcome?.desc || outcome?.name || outcome?.outcomeName);
      // Valid outcome: active, has description, odds > 1.00
      if (isActive && hasDesc && odds > 1.00) {
        return { market, outcome };
      }
    }
  }

  // Fallback: just get first outcome with odds > 1.00
  for (const market of markets) {
    const outcomes = market?.outcomes || market?.selections || [];
    for (const outcome of outcomes) {
      const odds = parseFloat(outcome?.odds || outcome?.oddValue || outcome?.price || 0);
      if (odds > 1.00) return { market, outcome };
    }
  }

  // Last resort: first market, first outcome
  const m = markets[0];
  const o = (m?.outcomes || m?.selections || [])[0];
  return { market: m, outcome: o };
}

function parseSlip(raw) {
  const data       = raw?.data || raw;
  const selections = extractSelections(data);
  if (!selections.length) return null;

  const games = selections.map((s) => {
    // ── Teams ──────────────────────────────────────────────────────────────
    const home  = s.homeTeamName || s.homeName || s.home || "Home";
    const away  = s.awayTeamName || s.awayName || s.away || "Away";

    // ── Sport ──────────────────────────────────────────────────────────────
    const sport = (typeof s.sport === "object" ? s.sport?.name : s.sport)
                 || s.sportName || "Unknown";

    // ── League ─────────────────────────────────────────────────────────────
    const league = s.sport?.category?.tournament?.name
                 || s.tournament?.name || s.league || "";

    // ── Market + Outcome — find best valid one ─────────────────────────────
    const { market, outcome } = findBestMarketOutcome(s.markets);

    const marketDesc  = market?.desc || "";
    const marketSpec  = market?.specifier || "";
    const outcomeName = outcome?.desc || outcome?.name || outcome?.outcomeName || "";

    // Build pick string
    let pickStr = outcomeName;
    if (marketSpec) {
      const specVal = marketSpec.split("=")[1];
      if (specVal && outcomeName && !outcomeName.includes(specVal)) {
        pickStr = `${outcomeName} ${specVal}`;
      }
    }
    if (marketDesc && marketDesc !== outcomeName) {
      pickStr = pickStr ? `${pickStr} (${marketDesc})` : marketDesc;
    }
    if (!pickStr) pickStr = "?";

    // ── Odds ───────────────────────────────────────────────────────────────
    const oddsRaw = outcome?.odds || outcome?.oddValue || outcome?.price;
    const oddsNum = parseFloat(oddsRaw);
    const odds    = (!isNaN(oddsNum) && oddsNum > 1.00) ? oddsNum.toFixed(2) : "?";

    // ── Time ───────────────────────────────────────────────────────────────
    const timeRaw = s.estimateStartTime || s.startTime || s.matchTime || s.kickOffTime;

    // ── Status ─────────────────────────────────────────────────────────────
    const statusMap = { 0: "pending", 1: "won", 2: "lost", 3: "void", 4: "ended" };
    const status    = statusMap[s.status] ?? (s.matchStatus || "pending");

    return {
      home, away, pick: pickStr, odds, sport, time: timeRaw, league, status,
      // IDs for booking code creation
      eventId:   s.eventId,
      marketId:  market?.id,
      outcomeId: outcome?.id,
      oddsRaw,
      specifier: market?.specifier || "",
      product:   market?.product,
    };
  });

  const validOdds = games.filter(g => g.odds !== "?").map(g => parseFloat(g.odds));
  const totalOdds = validOdds.length
    ? validOdds.reduce((a, b) => a * b, 1).toFixed(2)
    : "?";

  return {
    games,
    totalOdds,
    stake:        data?.stake        || data?.amount      || null,
    potentialWin: data?.potentialWin || data?.possibleWin || null,
  };
}

function formatSlip(parsed, code, region) {
  const { games, totalOdds, stake, potentialWin } = parsed;

  // For large slips, show summary + first 20 games to avoid Telegram limit
  const displayGames = games.slice(0, 20);
  const truncated    = games.length > 20;

  let msg = `📋 *Slip: \`${code.toUpperCase()}\`* (${region?.toUpperCase()})\n${"─".repeat(28)}\n\n`;

  displayGames.forEach((g, i) => {
    const emoji  = { won: "✅", lost: "❌", ended: "🏁", void: "↩️" }[g.status] || "⏳";
    const time   = g.time   ? `\n   🕐 ${fmtTime(g.time)}` : "";
    const league = g.league ? `\n   🏆 ${g.league}` : "";
    const sport  = g.sport && g.sport !== "Unknown" ? ` · ${g.sport}` : "";
    msg += `${emoji} *${i+1}. ${g.home} vs ${g.away}*${sport}${league}${time}\n`;
    msg += `   🎯 *${g.pick}* @ *${g.odds}*\n\n`;
  });

  if (truncated) {
    msg += `_...and ${games.length - 20} more games_\n\n`;
  }

  msg += `${"─".repeat(28)}\n`;
  msg += `⚽ *${games.length} games* | 📊 *Total odds: ${totalOdds}*\n`;
  if (stake)        msg += `💵 Stake: ${stake}\n`;
  if (potentialWin) msg += `💰 Potential win: ${potentialWin}\n`;
  return msg;
}

// ── Booking Code Creator ──────────────────────────────────────────────────────
async function createBookingCode(games, region = "ng") {
  const outcomes = games
    .map(g => ({
      eventId:   g.eventId,
      marketId:  String(g.marketId || ""),
      outcomeId: String(g.outcomeId || ""),
      odds:      String(g.oddsRaw || g.odds || ""),
      specifier: g.specifier || "",
      product:   g.product || 1,
    }))
    .filter(o => o.eventId && o.marketId && o.outcomeId && o.marketId !== "undefined");

  if (!outcomes.length) return { success: false, reason: "no_event_ids" };

  const payloads = [
    { outcomes },
    { selections: outcomes },
    { betItems:   outcomes },
  ];

  for (const payload of payloads) {
    try {
      const res = await axios.post(
        `https://www.sportybet.com/api/${region}/orders/share`,
        payload,
        { headers: { ...HEADERS, "Content-Type": "application/json" }, timeout: 10000 }
      );

      const code =
        res.data?.data?.shareCode   ||
        res.data?.data?.bookingCode ||
        res.data?.data?.code        ||
        res.data?.shareCode         ||
        res.data?.bookingCode       ||
        res.data?.code;

      if (code) return { success: true, code, region };

      // Log actual response for debugging
      console.log("[CreateCode] No code in response:", JSON.stringify(res.data).slice(0, 400));

    } catch (err) {
      const status = err.response?.status;
      const body   = JSON.stringify(err.response?.data || {}).slice(0, 200);
      console.log(`[CreateCode] ${region} failed: HTTP ${status} — ${body}`);
      // 401/403 = needs auth — stop trying
      if (status === 401 || status === 403) {
        return { success: false, reason: "auth_required", status };
      }
      continue;
    }
  }

  return { success: false, reason: "all_payloads_failed" };
}

function fmtTime(t) {
  try {
    const d = new Date(typeof t === "number" && t > 1e10 ? t : t * 1000);
    return d.toLocaleString("en-GB", {
      weekday: "short", day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit"
    });
  } catch { return String(t); }
}

module.exports = { fetchSportybet, parseSlip, formatSlip, createBookingCode };
