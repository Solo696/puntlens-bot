const { ask } = require("../services/groq");
const { fetchSportybet, parseSlip } = require("../services/sportybet");
const journal = require("../services/journal");
const { getSession, setSession } = require("../services/session");
const {
  detectValueEdge,
  oddsToImplied,
  calculateProbability,
  confidenceLevel,
} = require("../services/intelligence");
const { getMatchContext } = require("../services/footballapi");
const { safeSend } = require("../utils/helpers");

// Shared bankroll store — also syncs to session
function getBankroll(chatId) {
  const session = getSession(chatId);
  return session?.bankroll || null;
}

function setBankroll(chatId, amount) {
  const session = getSession(chatId) || {};
  setSession(chatId, { ...session, bankroll: amount });
}

// /compare CODE1 CODE2
async function compare(ctx) {
  const args = ctx.message.text.replace("/compare", "").trim().split(/\s+/);
  if (args.length < 2 || !args[1]) {
    return ctx.reply(
      `⚖️ *Compare Two Slips*\n\nUsage: \`/compare CODE1 CODE2\``,
      { parse_mode: "Markdown" }
    );
  }

  const msg = await ctx.reply("⚖️ Fetching and comparing both slips...");

  try {
    const [r1, r2] = await Promise.all([fetchSportybet(args[0]), fetchSportybet(args[1])]);
    if (!r1.success || !r2.success) {
      return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `❌ Could not fetch one or both codes.`
      );
    }

    const p1 = parseSlip(r1.data);
    const p2 = parseSlip(r2.data);

    const slip1 = p1.games.map((g, i) => `${i+1}. ${g.home} vs ${g.away} — ${g.pick} @ ${g.odds}`).join("\n");
    const slip2 = p2.games.map((g, i) => `${i+1}. ${g.home} vs ${g.away} — ${g.pick} @ ${g.odds}`).join("\n");

    const result = await ask(
      `You are a sports betting analyst on Telegram. Be concise. Use emojis.
Compare two betting slips:
1. Analyze each slip's strengths and weaknesses
2. Compare total odds and implied win probability
3. Identify which has better value
4. Clear recommendation: which to go with and why
5. Suggest if splitting stake between both makes sense`,
      `SLIP 1 (${args[0].toUpperCase()}, ${p1.totalOdds} odds):\n${slip1}\n\nSLIP 2 (${args[1].toUpperCase()}, ${p2.totalOdds} odds):\n${slip2}`
    );

    await safeSend(ctx, msg.message_id, `⚖️ *Slip Comparison*\n\n${result}`);
  } catch (err) {
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚠️ Error: ${err.message}`);
  }
}

// /explain CODE or text
async function explain(ctx) {
  const arg = ctx.message.text.replace("/explain", "").trim();
  if (!arg) {
    return ctx.reply(
      `📖 *Explain My Slip*\n\nUsage:\n\`/explain ABC12345\` — from code\n\`/explain [paste slip]\` — from text`,
      { parse_mode: "Markdown" }
    );
  }

  const msg = await ctx.reply("📖 Explaining your slip...");

  try {
    let slipText = arg;
    if (/^[a-zA-Z0-9]{5,15}$/.test(arg)) {
      const fetched = await fetchSportybet(arg);
      if (fetched.success) {
        const parsed = parseSlip(fetched.data);
        if (parsed?.games?.length) {
          slipText = parsed.games.map((g, i) =>
            `${i+1}. ${g.home} vs ${g.away} — ${g.pick} @ ${g.odds}`
          ).join("\n");
        }
      }
    }

    const result = await ask(
      `You are a beginner-friendly betting tutor on Telegram. Simple language. Emojis.
For each game:
1. Explain the market in plain English
2. What needs to happen to win this leg
3. Difficulty: Easy/Medium/Hard
Keep each to 2-3 lines. Be encouraging.`,
      `Explain each bet:\n\n${slipText}`
    );

    await safeSend(ctx, msg.message_id, `📖 *Slip Explained*\n\n${result}`);
  } catch (err) {
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚠️ Error: ${err.message}`);
  }
}

// /value CODE — scan slip for value bets
async function value(ctx) {
  const arg = ctx.message.text.replace("/value", "").trim();
  if (!arg) {
    return ctx.reply(
      `💎 *Value Bet Scanner*\n\nScans a slip for value bets — where AI probability beats the bookie's odds.\n\nUsage: \`/value ABC12345\``,
      { parse_mode: "Markdown" }
    );
  }

  const msg = await ctx.reply("💎 Scanning for value bets...");

  try {
    let games = [];
    if (/^[a-zA-Z0-9]{5,15}$/.test(arg)) {
      const fetched = await fetchSportybet(arg);
      if (!fetched.success) {
        return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
          `❌ Could not fetch code \`${arg.toUpperCase()}\``, { parse_mode: "Markdown" }
        );
      }
      const parsed = parseSlip(fetched.data);
      games = parsed?.games || [];
    }

    if (!games.length) {
      return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `⚠️ No games found to scan.`
      );
    }

    // Enrich with form and value detection
    const enriched = await Promise.all(games.map(async (g) => {
      const odds = parseFloat(g.odds);
      if (isNaN(odds)) return { ...g, value: null };
      try {
        const context = await getMatchContext(g.home, g.away);
        const prob    = context ? calculateProbability(context, g.pick) : null;
        const val     = prob ? detectValueEdge(prob, odds) : { impliedProbability: oddsToImplied(odds), edge: 0, isValue: false, label: null };
        return { ...g, probability: prob, value: val };
      } catch {
        return { ...g, probability: null, value: { impliedProbability: oddsToImplied(odds), edge: 0, isValue: false, label: null } };
      }
    }));

    const valueBets = enriched.filter(g => g.value?.isValue);
    let report = `💎 *Value Bet Report*\n${"─".repeat(26)}\n\n`;

    if (!valueBets.length) {
      report += `No strong value bets detected in this slip.\n\n`;
      report += `_Tip: Value betting works over 100+ bets. A single slip having no value is normal._\n\n`;
    } else {
      report += `Found *${valueBets.length} value bet${valueBets.length > 1 ? "s" : ""}*:\n\n`;
      valueBets.forEach(g => {
        report += `✅ *${g.home} vs ${g.away}*\n`;
        report += `   🎯 ${g.pick} @ ${g.odds}\n`;
        report += `   📊 AI Prob: *${g.probability}%* vs Bookie: *${g.value.impliedProbability}%*\n`;
        report += `   💎 Edge: *+${g.value.edge}%* — ${g.value.label}\n\n`;
      });
    }

    report += `${"─".repeat(26)}\n`;
    report += `*All games:*\n`;
    enriched.forEach((g, i) => {
      const v = g.value?.isValue ? ` 💎 +${g.value.edge}%` : "";
      const p = g.probability ? ` (${g.probability}%)` : "";
      report += `${i+1}. ${g.home} vs ${g.away} — ${g.pick} @ ${g.odds}${p}${v}\n`;
    });

    await safeSend(ctx, msg.message_id, report);
  } catch (err) {
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚠️ Error: ${err.message}`);
  }
}

// /bankroll — now syncs to session
async function bankroll(ctx) {
  const arg    = ctx.message.text.replace("/bankroll", "").trim();
  const chatId = ctx.chat.id;

  if (!arg) {
    const current = getBankroll(chatId);
    return ctx.reply(
      current
        ? `🏦 Your current bankroll: *$${current}*\n\nUpdate: \`/bankroll 200\``
        : `🏦 *Set Your Bankroll*\n\nUsage: \`/bankroll 100\`\n\nUsed automatically in stake suggestions and smart tickets.`,
      { parse_mode: "Markdown" }
    );
  }

  const amount = parseFloat(arg);
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply("❌ Enter a valid amount. Example: `/bankroll 100`", { parse_mode: "Markdown" });
  }

  setBankroll(chatId, amount);
  ctx.reply(
    `✅ *Bankroll set to $${amount}*\n\nUsed in Kelly calculations, smart tickets, and stake suggestions.`,
    { parse_mode: "Markdown" }
  );
}

// /streak
async function streak(ctx) {
  const bets = journal.getRecent(50).filter(b => b.result !== "pending");

  if (!bets.length) {
    return ctx.reply("📓 No settled bets yet. Use `/log` to start tracking.", { parse_mode: "Markdown" });
  }

  let currentStreak = 0;
  const streakType  = bets[0].result;
  for (const b of bets) {
    if (b.result === streakType) currentStreak++;
    else break;
  }

  const emoji = streakType === "won" ? "🔥" : "❄️";
  const msgs  = {
    won:  ["You're on fire! Keep the discipline.", "Hot streak! Don't get greedy.", "Nice run! Stick to your strategy."],
    lost: ["Tough run. Review your selections.", "It happens to everyone. Stick to the process.", "Take a breath. Quality over quantity."],
  };
  const tipMsg = msgs[streakType][Math.floor(Math.random() * 3)];

  ctx.reply(
    `${emoji} *Streak: ${currentStreak} ${streakType.toUpperCase()}${currentStreak > 1 ? "S" : ""}*\n\n💬 ${tipMsg}\n\nUse /stats for full record.`,
    { parse_mode: "Markdown" }
  );
}

// /tip
async function tip(ctx) {
  const tips = [
    "📌 Never bet more than 5% of your bankroll on a single bet.",
    "📌 Accumulators are exciting but hard to win. Singles give better long-term ROI.",
    "📌 Track every bet. You can't improve what you don't measure. Use /log.",
    "📌 Value matters more than winning. A 2.0 odds bet won 55% beats a 1.3 odds bet won 80% long-term.",
    "📌 Avoid betting on your favourite team. Emotions cloud judgment.",
    "📌 The bookmaker always has an edge. Your job is to find mispriced markets.",
    "📌 Losing streaks are normal even for profitable bettors. Judge over 100+ bets.",
    "📌 Set a monthly budget and never chase losses beyond it.",
    "📌 Specialise. Knowing one league well beats guessing across many.",
    "📌 Use /smart for AI-generated tickets or /value to scan slips for value bets.",
    "📌 Line movement before kickoff often means sharp money moved. Pay attention.",
    "📌 BTTS markets are often better value than match result in high-scoring leagues.",
  ];
  ctx.reply(tips[Math.floor(Math.random() * tips.length)] + "\n\n_/tip for another_", { parse_mode: "Markdown" });
}

// /odds converter
async function odds(ctx) {
  const args = ctx.message.text.replace("/odds", "").trim().split(/\s+/);

  if (!args[0]) {
    return ctx.reply(
      `🔄 *Odds Converter*\n\nUsage: \`/odds <value> <format>\`\nFormats: \`decimal\`, \`american\`, \`fractional\`, \`implied\`\n\nExamples:\n\`/odds 1.85 decimal\`\n\`/odds +150 american\`\n\`/odds 55 implied\``,
      { parse_mode: "Markdown" }
    );
  }

  const val = args[0].replace("+", "");
  const fmt = (args[1] || "decimal").toLowerCase();
  let decimal;

  try {
    if (fmt === "decimal") {
      decimal = parseFloat(val);
    } else if (fmt === "american") {
      const n = parseFloat(val);
      decimal = n > 0 ? (n / 100) + 1 : (100 / Math.abs(n)) + 1;
    } else if (fmt === "fractional") {
      const parts = val.split("/");
      decimal = parts.length === 2 ? (parseFloat(parts[0]) / parseFloat(parts[1])) + 1 : parseFloat(val) + 1;
    } else if (fmt === "implied") {
      decimal = 100 / parseFloat(val);
    } else {
      return ctx.reply("❌ Unknown format. Use: `decimal`, `american`, `fractional`, `implied`", { parse_mode: "Markdown" });
    }

    if (isNaN(decimal) || decimal <= 1) return ctx.reply("❌ Invalid odds value.");

    const american = decimal >= 2
      ? `+${((decimal - 1) * 100).toFixed(0)}`
      : `-${(100 / (decimal - 1)).toFixed(0)}`;
    const impliedPct  = (1 / decimal * 100).toFixed(2);
    const profitUnit  = (decimal - 1).toFixed(4);
    const fracNum     = Math.round((decimal - 1) * 100);

    ctx.reply(
      `🔄 *Odds Conversion*\n\n📊 Decimal: *${decimal.toFixed(2)}*\n🇺🇸 American: *${american}*\n🇬🇧 Fractional: *${fracNum}/100*\n🎯 Implied Prob: *${impliedPct}%*\n💵 Profit per $1: *$${profitUnit}*`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    ctx.reply(`⚠️ Could not convert: ${err.message}`);
  }
}

module.exports = { compare, explain, value, bankroll, streak, tip, odds, getBankroll };
