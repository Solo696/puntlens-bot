const journal = require("../services/journal");
const { Markup } = require("telegraf");

// /log Description | Stake | Odds [| Sport]
async function logBet(ctx) {
  const text = ctx.message.text.replace("/log", "").trim();

  if (!text) {
    return ctx.reply(
      `📓 *Log a Bet*\n\n` +
      `\`/log Description | Stake | Odds\`\n\n` +
      `Examples:\n` +
      `\`/log Man City Win | 10 | 1.85\`\n` +
      `\`/log Over 2.5 Goals | 5 | 1.75 | Football\``,
      { parse_mode: "Markdown" }
    );
  }

  const parts = text.split("|").map((p) => p.trim());
  if (parts.length < 3) {
    return ctx.reply("❌ Format: `/log Description | Stake | Odds`", { parse_mode: "Markdown" });
  }

  const [description, stakeStr, oddsStr, sport] = parts;
  const stake = parseFloat(stakeStr);
  const odds  = parseFloat(oddsStr);

  if (isNaN(stake) || isNaN(odds)) {
    return ctx.reply("❌ Stake and odds must be numbers. E.g. `10` and `1.85`", { parse_mode: "Markdown" });
  }

  try {
    const bet = journal.addBet({ description, stake, odds, sport });
    ctx.reply(
      `✅ *Bet Logged*\n\n` +
      `📝 ${description}\n` +
      `💵 $${stake} @ ${odds} → potential *$${bet.potentialWin}*\n\n` +
      `Mark result when it settles:`,
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([[
          Markup.button.callback("✅ Won",  `result_won_${bet.id}`),
          Markup.button.callback("❌ Lost", `result_lost_${bet.id}`),
          Markup.button.callback("↩️ Void", `result_void_${bet.id}`),
        ]]).reply_markup,
      }
    );
  } catch (err) {
    ctx.reply(`⚠️ Failed to log: ${err.message}`);
  }
}

async function updateResult(ctx) {
  await ctx.answerCbQuery();
  const [, result, id] = ctx.match;

  try {
    const bet   = journal.updateBet(id, result);
    const emoji = result === "won" ? "✅" : result === "lost" ? "❌" : "↩️";
    const pnl   = result === "won"
      ? `+$${(bet.stake * (bet.odds - 1)).toFixed(2)}`
      : result === "lost" ? `-$${bet.stake.toFixed(2)}` : "$0 (void)";

    ctx.editMessageText(
      `${emoji} *${result.toUpperCase()}*\n\n📝 ${bet.description}\n💵 $${bet.stake} @ ${bet.odds}\n📊 P&L: *${pnl}*`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    ctx.reply(`⚠️ ${err.message}`);
  }
}

async function showStats(ctx) {
  const s = journal.getStats();

  if (s.total === 0) {
    return ctx.reply("📓 No bets yet. Use `/log` to start tracking.", { parse_mode: "Markdown" });
  }

  const pnlSign = parseFloat(s.pnl) >= 0 ? "+" : "";
  const roiSign = parseFloat(s.roi) >= 0 ? "+" : "";
  const roiIcon = parseFloat(s.roi) >= 0 ? "📈" : "📉";

  ctx.reply(
    `📊 *Your Stats*\n\n` +
    `🎯 Total: *${s.total}*  |  ⏳ Pending: *${s.pending}*\n` +
    `✅ Won: *${s.won}*  |  ❌ Lost: *${s.lost}*\n` +
    `🏆 Win rate: *${s.winRate}%*\n\n` +
    `${"─".repeat(24)}\n\n` +
    `💵 Staked: *$${s.staked}*\n` +
    `💰 Returns: *$${s.returns}*\n` +
    `📊 P&L: *${pnlSign}$${s.pnl}*\n` +
    `${roiIcon} ROI: *${roiSign}${s.roi}%*\n\n` +
    `Use /history to see recent bets.`,
    { parse_mode: "Markdown" }
  );
}

async function showHistory(ctx) {
  const bets = journal.getRecent(10);
  if (!bets.length) {
    return ctx.reply("📓 No bets yet. Use `/log` to start.", { parse_mode: "Markdown" });
  }

  let msg = `📋 *Last ${bets.length} Bets*\n\n`;
  bets.forEach((b) => {
    const e = b.result === "won" ? "✅" : b.result === "lost" ? "❌" : "⏳";
    msg += `${e} *${b.description}*\n   $${b.stake} @ ${b.odds} · ${b.sport} · ${b.date}\n\n`;
  });
  msg += `_/stats for full summary_`;

  ctx.reply(msg, { parse_mode: "Markdown" });
}

module.exports = { logBet, updateResult, getStats: showStats, getHistory: showHistory };
