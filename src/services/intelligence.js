/**
 * PuntLens Intelligence Engine
 * Core betting analysis functions
 */

// ── 1. Probability & Value ────────────────────────────────────────────────────

// Convert decimal odds → implied probability (%)
function oddsToImplied(decimalOdds) {
  if (!decimalOdds || decimalOdds <= 1) return 50;
  return parseFloat(((1 / decimalOdds) * 100).toFixed(2));
}

// Detect value bet — compares AI probability vs bookie implied
function detectValueEdge(aiProbability, decimalOdds) {
  const implied = oddsToImplied(decimalOdds);
  const edge    = parseFloat((aiProbability - implied).toFixed(2));

  let label = null;
  if (edge >= 10)     label = "STRONG";
  else if (edge >= 5) label = "MEDIUM";
  else if (edge >= 2) label = "SMALL";

  return {
    aiProbability,
    impliedProbability: implied,
    edge,
    isValue: edge > 0,
    label,                       // null = no value
  };
}

// ── 2. Form Analysis ─────────────────────────────────────────────────────────

// Score a team's recent form string e.g. "WWDLW" → 0–100
function formScore(formString) {
  if (!formString || formString === "N/A") return 50;
  const weights = { W: 3, D: 1, L: 0 };
  const chars   = formString.split("").filter(c => weights[c] !== undefined);
  if (!chars.length) return 50;
  const max  = chars.length * 3;
  const actual = chars.reduce((s, c) => s + weights[c], 0);
  return Math.round((actual / max) * 100);
}

// Estimate base probability using form scores + H2H
function calculateProbability(matchContext, pick) {
  if (!matchContext) return null;

  const { homeTeam, awayTeam, h2h } = matchContext;
  const homeFormScore = formScore(homeTeam.form);
  const awayFormScore = formScore(awayTeam.form);

  // Base win probabilities from form
  const total   = homeFormScore + awayFormScore + 20; // 20 = draw weight
  let homeWinP  = (homeFormScore / total) * 100;
  let awayWinP  = (awayFormScore / total) * 100;
  let drawP     = (20 / total) * 100;

  // Adjust for H2H if available
  if (h2h.total >= 3) {
    const h2hTotal = h2h.homeWins + h2h.awayWins + h2h.draws;
    const h2hHomeP = (h2h.homeWins / h2hTotal) * 100;
    const h2hAwayP = (h2h.awayWins / h2hTotal) * 100;
    const h2hDrawP = (h2h.draws    / h2hTotal) * 100;
    // Blend form (70%) + H2H (30%)
    homeWinP = homeWinP * 0.7 + h2hHomeP * 0.3;
    awayWinP = awayWinP * 0.7 + h2hAwayP * 0.3;
    drawP    = drawP    * 0.7 + h2hDrawP * 0.3;
  }

  // Home advantage boost (~5%)
  homeWinP += 5;
  awayWinP -= 3;
  drawP    -= 2;

  // Normalise
  const sum = homeWinP + awayWinP + drawP;
  homeWinP  = Math.max(5, Math.min(90, (homeWinP / sum) * 100));
  awayWinP  = Math.max(5, Math.min(90, (awayWinP / sum) * 100));
  drawP     = Math.max(5, Math.min(40, (drawP / sum) * 100));

  // Map pick to probability
  const pickLower = pick?.toLowerCase() || "";
  let probability = 50;

  if (pickLower.includes("home") || pickLower === "1" || pickLower.includes(homeTeam.name?.toLowerCase())) {
    probability = homeWinP;
  } else if (pickLower.includes("away") || pickLower === "2" || pickLower.includes(awayTeam.name?.toLowerCase())) {
    probability = awayWinP;
  } else if (pickLower.includes("draw") || pickLower === "x") {
    probability = drawP;
  } else if (pickLower.includes("over 2.5") || pickLower.includes("over2.5")) {
    // Estimate over 2.5 from avg goals
    const combinedAvg = parseFloat(homeTeam.avgGoalsFor) + parseFloat(awayTeam.avgGoalsFor);
    probability = combinedAvg > 2.5 ? Math.min(75, 40 + (combinedAvg - 2.5) * 15) : Math.max(30, 55 - (2.5 - combinedAvg) * 15);
  } else if (pickLower.includes("under 2.5") || pickLower.includes("under2.5")) {
    const combinedAvg = parseFloat(homeTeam.avgGoalsFor) + parseFloat(awayTeam.avgGoalsFor);
    probability = combinedAvg < 2.5 ? Math.min(70, 40 + (2.5 - combinedAvg) * 15) : Math.max(30, 55 - (combinedAvg - 2.5) * 15);
  } else if (pickLower.includes("btts") || pickLower.includes("both teams")) {
    const bothScore = parseFloat(homeTeam.avgGoalsFor) > 1 && parseFloat(awayTeam.avgGoalsFor) > 1;
    probability = bothScore ? 60 : 40;
  }

  return parseFloat(probability.toFixed(1));
}

// Confidence level from probability
function confidenceLevel(probability) {
  if (probability >= 70) return "High";
  if (probability >= 55) return "Medium";
  return "Low";
}

// ── 3. Overlap Detection ─────────────────────────────────────────────────────

function normalizeTeam(name) {
  return (name || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function sameMatch(g1, g2) {
  return (
    normalizeTeam(g1.home) === normalizeTeam(g2.home) &&
    normalizeTeam(g1.away) === normalizeTeam(g2.away)
  );
}

// Classify overlap between two games
function classifyOverlap(g1, g2) {
  if (!sameMatch(g1, g2)) return null;

  const p1 = (g1.pick || "").toLowerCase();
  const p2 = (g2.pick || "").toLowerCase();

  if (p1 === p2) return "REDUNDANT";    // exact same pick

  // Opposite picks — conflict
  const conflicts = [
    ["home win", "away win"],
    ["over 2.5", "under 2.5"],
    ["over 1.5", "under 1.5"],
    ["btts yes", "btts no"],
  ];
  for (const [a, b] of conflicts) {
    if ((p1.includes(a) && p2.includes(b)) || (p1.includes(b) && p2.includes(a))) {
      return "CONFLICT";
    }
  }

  return "CORRELATED"; // same match, different markets
}

// Detect all overlaps across an array of game lists (tickets)
function detectOverlaps(tickets) {
  const overlaps = [];
  for (let t1 = 0; t1 < tickets.length; t1++) {
    for (let t2 = t1 + 1; t2 < tickets.length; t2++) {
      for (const g1 of tickets[t1]) {
        for (const g2 of tickets[t2]) {
          const type = classifyOverlap(g1, g2);
          if (type) {
            overlaps.push({
              type,
              game:    `${g1.home} vs ${g1.away}`,
              ticket1: t1 + 1,
              ticket2: t2 + 1,
              pick1:   g1.pick,
              pick2:   g2.pick,
            });
          }
        }
      }
    }
  }
  return overlaps;
}

// Resolve overlaps based on mode
function resolveOverlaps(games, overlaps, mode = "smart") {
  if (!overlaps.length) return { games, removed: [] };

  const removed = [];
  let filtered  = [...games];

  for (const overlap of overlaps) {
    if (overlap.type === "CONFLICT") {
      // Always remove conflicts
      filtered = filtered.filter(g => {
        const match = `${g.home} vs ${g.away}`;
        if (match === overlap.game && (g.pick || "").toLowerCase() === (overlap.pick2 || "").toLowerCase()) {
          removed.push({ ...g, reason: "Conflict with another pick on same match" });
          return false;
        }
        return true;
      });
    } else if (overlap.type === "REDUNDANT" && mode !== "aggressive") {
      // Remove redundant in strict and smart modes
      let removedOne = false;
      filtered = filtered.filter(g => {
        const match = `${g.home} vs ${g.away}`;
        if (!removedOne && match === overlap.game && (g.pick || "").toLowerCase() === (overlap.pick2 || "").toLowerCase()) {
          removed.push({ ...g, reason: "Duplicate game in multiple tickets" });
          removedOne = true;
          return false;
        }
        return true;
      });
    }
    // CORRELATED: only remove in strict mode
    else if (overlap.type === "CORRELATED" && mode === "strict") {
      let removedOne = false;
      filtered = filtered.filter(g => {
        const match = `${g.home} vs ${g.away}`;
        if (!removedOne && match === overlap.game && (g.pick || "").toLowerCase() === (overlap.pick2 || "").toLowerCase()) {
          removed.push({ ...g, reason: "Correlated market on same match (strict mode)" });
          removedOne = true;
          return false;
        }
        return true;
      });
    }
  }

  return { games: filtered, removed };
}

// ── 4. Diversification Score ─────────────────────────────────────────────────

function calculateDiversification(games) {
  if (!games.length) return 0;

  // Check sport variety
  const sports  = new Set(games.map(g => (g.sport || "football").toLowerCase()));
  const leagues = new Set(games.map(g => (g.league || "unknown").toLowerCase()));
  const matches = new Set(games.map(g => `${g.home}-${g.away}`));

  // No duplicates at all = good start
  const uniquenessScore = (matches.size / games.length) * 40;

  // Sport variety bonus (up to 20)
  const sportBonus  = Math.min(20, (sports.size - 1) * 10);

  // League variety bonus (up to 20)
  const leagueBonus = Math.min(20, (leagues.size - 1) * 5);

  // Odds spread bonus — avoid all same odds (up to 20)
  const oddsValues  = games.map(g => parseFloat(g.odds)).filter(o => !isNaN(o));
  const oddsSpread  = oddsValues.length > 1
    ? Math.min(20, (Math.max(...oddsValues) - Math.min(...oddsValues)) * 5)
    : 0;

  const total = Math.round(uniquenessScore + sportBonus + leagueBonus + oddsSpread);
  return Math.min(100, Math.max(0, total));
}

function diversificationLabel(score) {
  if (score >= 90) return { label: "Excellent 🟢", advice: "Well diversified slip." };
  if (score >= 60) return { label: "Moderate 🟡", advice: "Consider mixing more leagues or sports." };
  return { label: "Risky 🔴", advice: "Too many correlated picks. Spread across different leagues." };
}

// ── 5. Bankroll & Stake ──────────────────────────────────────────────────────

function suggestStake(bankroll, games, overlapCount = 0) {
  if (!bankroll || bankroll <= 0) return null;

  const numGames    = games.length;
  const avgOdds     = games.filter(g => g.odds !== "?")
    .reduce((s, g) => s + parseFloat(g.odds), 0) / numGames || 2;

  // Base stake: 1–5% of bankroll based on combined odds
  let stakePercent;
  if (avgOdds < 1.5)      stakePercent = 5;
  else if (avgOdds < 2.0) stakePercent = 4;
  else if (avgOdds < 3.0) stakePercent = 3;
  else if (avgOdds < 5.0) stakePercent = 2;
  else                    stakePercent = 1;

  // Reduce stake if overlaps detected
  if (overlapCount > 0) stakePercent = Math.max(1, stakePercent - overlapCount * 0.5);

  const stakeAmount = parseFloat((bankroll * (stakePercent / 100)).toFixed(2));

  // Check if any single match exceeds 25% exposure
  const totalOdds = games.filter(g => g.odds !== "?")
    .reduce((acc, g) => acc * parseFloat(g.odds), 1);
  const potentialReturn = stakeAmount * totalOdds;
  const exposureWarning = potentialReturn > bankroll * 0.25;

  return {
    stakePercent,
    stakeAmount,
    potentialReturn: parseFloat(potentialReturn.toFixed(2)),
    exposureWarning,
    note: overlapCount > 0 ? `Reduced by ${overlapCount * 0.5}% due to ${overlapCount} overlaps` : null,
  };
}

// ── 6. Full Game Analysis ────────────────────────────────────────────────────

// Runs all intelligence functions on a single game
async function analyzeGame(game, matchContext) {
  const probability = matchContext
    ? calculateProbability(matchContext, game.pick)
    : null;

  const odds  = parseFloat(game.odds);
  const value = probability && !isNaN(odds)
    ? detectValueEdge(probability, odds)
    : null;

  return {
    ...game,
    probability,
    confidence:   probability ? confidenceLevel(probability) : null,
    value,
    formContext:  matchContext ? {
      homeForm: matchContext.homeTeam.form,
      awayForm: matchContext.awayTeam.form,
      h2hRecord: matchContext.h2h.total
        ? `${matchContext.h2h.homeWins}W-${matchContext.h2h.draws}D-${matchContext.h2h.awayWins}L`
        : "No H2H data",
    } : null,
  };
}

module.exports = {
  oddsToImplied,
  detectValueEdge,
  formScore,
  calculateProbability,
  confidenceLevel,
  detectOverlaps,
  resolveOverlaps,
  classifyOverlap,
  calculateDiversification,
  diversificationLabel,
  suggestStake,
  analyzeGame,
};
