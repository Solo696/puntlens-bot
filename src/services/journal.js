const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../journal.json");

function load() {
  if (!fs.existsSync(FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return []; }
}

function save(bets) {
  fs.writeFileSync(FILE, JSON.stringify(bets, null, 2));
}

function addBet({ description, stake, odds, sport }) {
  const bets = load();
  const bet  = {
    id:           Date.now().toString(),
    description,
    stake:        parseFloat(stake),
    odds:         parseFloat(odds),
    sport:        sport || "Football",
    result:       "pending",
    potentialWin: (parseFloat(stake) * parseFloat(odds)).toFixed(2),
    date:         new Date().toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" }),
    createdAt:    new Date().toISOString(),
  };
  bets.unshift(bet);
  save(bets);
  return bet;
}

function updateBet(id, result) {
  const bets = load();
  const bet  = bets.find((b) => b.id === id);
  if (!bet) throw new Error("Bet not found");
  bet.result     = result;
  bet.settledAt  = new Date().toISOString();
  save(bets);
  return bet;
}

function getRecent(limit = 10) {
  return load().slice(0, limit);
}

function getStats() {
  const bets    = load();
  const settled = bets.filter((b) => b.result !== "pending");
  const won     = settled.filter((b) => b.result === "won");
  const lost    = settled.filter((b) => b.result === "lost");

  const staked  = settled.reduce((s, b) => s + b.stake, 0);
  const returns = won.reduce((s, b) => s + parseFloat(b.potentialWin), 0);
  const pnl     = returns - staked;
  const roi     = staked > 0 ? ((pnl / staked) * 100).toFixed(1) : "0.0";
  const winRate = settled.length > 0 ? ((won.length / settled.length) * 100).toFixed(0) : "0";

  return {
    total:    bets.length,
    pending:  bets.filter((b) => b.result === "pending").length,
    won:      won.length,
    lost:     lost.length,
    staked:   staked.toFixed(2),
    returns:  returns.toFixed(2),
    pnl:      pnl.toFixed(2),
    roi,
    winRate,
  };
}

module.exports = { addBet, updateBet, getRecent, getStats };
