// /stake <bankroll> <odds> <win%> [fraction]
// /stake 100 1.85 55
// /stake 100 1.85 55 0.25

async function calculate(ctx) {
  const args = ctx.message.text.replace("/stake", "").trim().split(/\s+/).filter(Boolean);

  if (args.length < 3) {
    return ctx.reply(
      `💰 *Kelly Stake Calculator*\n\n` +
      `Usage: \`/stake <bankroll> <odds> <win%> [fraction]\`\n\n` +
      `• \`/stake 100 1.85 55\` — default quarter kelly\n` +
      `• \`/stake 100 1.85 55 0.5\` — half kelly\n` +
      `• \`/stake 100 1.85 55 1\` — full kelly (aggressive)\n\n` +
      `*win%* = your honest estimate the bet wins`,
      { parse_mode: "Markdown" }
    );
  }

  const bankroll = parseFloat(args[0]);
  const odds     = parseFloat(args[1]);
  const winPct   = parseFloat(args[2]);
  const fraction = parseFloat(args[3] || "0.25"); // quarter kelly default

  if ([bankroll, odds, winPct].some(isNaN)) {
    return ctx.reply("❌ Invalid numbers. Example: `/stake 100 1.85 55`", { parse_mode: "Markdown" });
  }
  if (odds <= 1)              return ctx.reply("❌ Odds must be greater than 1.0 (decimal format).");
  if (winPct <= 0 || winPct >= 100) return ctx.reply("❌ Win% must be between 1 and 99.");

  const p      = winPct / 100;
  const b      = odds - 1;
  const kelly  = (p * b - (1 - p)) / b;

  if (kelly <= 0) {
    const implied = ((1 / odds) * 100).toFixed(1);
    return ctx.reply(
      `💰 *Kelly Result*\n\n🚫 *DO NOT BET*\n\n` +
      `Your win estimate (${winPct}%) is below what the odds imply (${implied}%).\n` +
      `The bookie has the edge. Skip this one.`,
      { parse_mode: "Markdown" }
    );
  }

  const stake   = Math.max(0, kelly * fraction * bankroll);
  const profit  = stake * b;
  const payout  = stake * odds;
  const implied = (1 / odds * 100).toFixed(1);
  const edge    = (winPct - parseFloat(implied)).toFixed(1);
  const pctUsed = (kelly * fraction * 100).toFixed(1);
  const label   = fraction >= 1 ? "Full Kelly 🔴" : fraction >= 0.5 ? "Half Kelly 🟡" : "Quarter Kelly 🟢";

  ctx.reply(
    `💰 *Kelly Stake Calculator*\n\n` +
    `🏦 Bankroll: *$${bankroll}*  |  📊 Odds: *${odds}*  |  🎯 Win%: *${winPct}%*\n` +
    `⚙️ Strategy: *${label}*\n\n` +
    `${"─".repeat(26)}\n\n` +
    `✅ *Stake: $${stake.toFixed(2)}* (${pctUsed}% of bankroll)\n` +
    `💵 Potential profit: *$${profit.toFixed(2)}*\n` +
    `💰 Potential payout: *$${payout.toFixed(2)}*\n\n` +
    `${"─".repeat(26)}\n\n` +
    `📈 Your edge: *${edge > 0 ? "+" : ""}${edge}%*\n` +
    `🎰 Bookie implied prob: *${implied}%*\n\n` +
    `${parseFloat(edge) < 3 ? "⚠️ _Thin edge — be careful._\n" : ""}`,
    { parse_mode: "Markdown" }
  );
}

module.exports = { calculate };
