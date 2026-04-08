const { ask } = require("../services/groq");
const { fetchSportybet, parseSlip } = require("../services/sportybet");
const journal = require("../services/journal");

// /compare <code1> <code2>
async function compare(ctx) {
  const args = ctx.message.text.replace("/compare", "").trim().split(/\s+/);
  if (args.length < 2) {
    return ctx.reply(
      `⚖️ *Compare Two Slips*\n\nUsage: \`/compare CODE1 CODE2\`\nExample: \`/compare ABC123 XYZ456\``,
      { parse_mode: "Markdown" }
    );
  }

  const msg = await ctx.reply("⚖️ Fetching and comparing both slips...");

  try {
    const [r1, r2] = await Promise.all([fetchSportybet(args[0]), fetchSportybet(args[1])]);
    if (!r1.success || !r2.success) {
      return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `❌ Could not fetch one or both codes. Check they are valid Sportybet codes.`
      );
    }

    const p1 = parseSlip(r1.data);
    const p2 = parseSlip(r2.data);

    const slip1 = p1.games.map((g, i) => `${i+1}. ${g.home} vs ${g.away} — ${g.pick} @ ${g.odds}`).join("\n");
    const slip2 = p2.games.map((g, i) => `${i+1}. ${g.home} vs ${g.away} — ${g.pick} @ ${g.odds}`).join("\n");

    const result = await ask(
      `You are a sports betting analyst on Telegram. Be concise. Use emojis.
Compare two betting slips and:
1. Analyze each slip's strength and weaknesses
2. Compare total odds and implied win probability
3. Identify which has better value
4. Give a clear recommendation: which slip to go with and why
5. Suggest if splitting stake between both makes sense`,
      `Compare these two slips:\n\nSLIP 1 (${args[0].toUpperCase()}, ${p1.totalOdds} odds):\n${slip1}\n\nSLIP 2 (${args[1].toUpperCase()}, ${p2.totalOdds} odds):\n${slip2}`
    );

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `⚖️ *Slip Comparison*\n\n${result}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚠️ Error: ${err.message}`);
  }
}

// /explain <code or text>
async function explain(ctx) {
  const arg = ctx.message.text.replace("/explain", "").trim();
  if (!arg) {
    return ctx.reply(
      `📖 *Explain My Slip*\n\nI'll explain every bet market in plain English.\n\nUsage:\n\`/explain ABC12345\` — from code\n\`/explain [paste slip]\` — from text`,
      { parse_mode: "Markdown" }
    );
  }

  const msg = await ctx.reply("📖 Explaining your slip in plain English...");

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
      `You are a beginner-friendly betting tutor on Telegram. Use simple language and emojis.
For each game in the slip:
1. Explain what the bet market means in plain English
2. What needs to happen for this leg to win
3. How likely it is (easy/medium/hard)
Keep each explanation to 2-3 lines max. Be encouraging.`,
      `Explain each bet in this slip:\n\n${slipText}`
    );

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `📖 *Slip Explained*\n\n${result}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚠️ Error: ${err.message}`);
  }
}

// /bankroll <amount> — set or view bankroll
const bankrollStore = {};
async function bankroll(ctx) {
  const arg = ctx.message.text.replace("/bankroll", "").trim();
  const chatId = ctx.chat.id;

  if (!arg) {
    const current = bankrollStore[chatId];
    return ctx.reply(
      current
        ? `🏦 Your current bankroll: *$${current}*\n\nUpdate it: \`/bankroll 200\``
        : `🏦 *Set Your Bankroll*\n\nUsage: \`/bankroll 100\`\n\nI'll use this automatically in all Kelly calculations.`,
      { parse_mode: "Markdown" }
    );
  }

  const amount = parseFloat(arg);
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply("❌ Please enter a valid amount. Example: `/bankroll 100`", { parse_mode: "Markdown" });
  }

  bankrollStore[chatId] = amount;
  ctx.reply(
    `✅ *Bankroll set to $${amount}*\n\nI'll now use this in Kelly calculations automatically.\nUpdate anytime with \`/bankroll <amount>\``,
    { parse_mode: "Markdown" }
  );
}

// /streak — win/loss streak from journal
async function streak(ctx) {
  const bets = journal.getRecent(50).filter(b => b.result !== "pending");

  if (!bets.length) {
    return ctx.reply("📓 No settled bets yet. Log some bets with `/log` first.", { parse_mode: "Markdown" });
  }

  let currentStreak = 0;
  let streakType = bets[0].result;
  for (const b of bets) {
    if (b.result === streakType) currentStreak++;
    else break;
  }

  const emoji = streakType === "won" ? "🔥" : "❄️";
  const messages = {
    won: ["You're on fire! Keep the discipline.", "Hot streak! Don't get greedy.", "Nice run! Stay focused and stick to your strategy."],
    lost: ["Tough run. Review your selections.", "It happens to everyone. Stick to the process.", "Take a breath. Quality over quantity."]
  };
  const tip = messages[streakType][Math.floor(Math.random() * 3)];

  ctx.reply(
    `${emoji} *Current Streak: ${currentStreak} ${streakType.toUpperCase()}${currentStreak > 1 ? "S" : ""}*\n\n` +
    `💬 ${tip}\n\n` +
    `Use /stats for your full record.`,
    { parse_mode: "Markdown" }
  );
}

// /tip — daily betting tip
async function tip(ctx) {
  const tips = [
    "📌 *Tip:* Never bet more than 5% of your bankroll on a single bet — even if you're confident.",
    "📌 *Tip:* Accumulators are exciting but hard to win. Singles and doubles give you much better odds of profit long-term.",
    "📌 *Tip:* Track every bet. You can't improve what you don't measure. Use /log after every bet.",
    "📌 *Tip:* Value matters more than winning. A 2.0 odds bet you win 55% of the time is more profitable than a 1.3 odds bet you win 80% of the time.",
    "📌 *Tip:* Avoid betting on your favorite team. Emotions cloud judgment.",
    "📌 *Tip:* The bookmaker always has an edge. Your goal is to find the rare spots where they've mispriced a market.",
    "📌 *Tip:* Losing streaks are normal even for profitable bettors. What matters is your ROI over 100+ bets.",
    "📌 *Tip:* Set a monthly betting budget and never chase losses beyond it.",
    "📌 *Tip:* Specialise. Knowing one league well beats guessing across many.",
    "📌 *Tip:* The Kelly Criterion exists for a reason. Use /stake to calculate the right bet size.",
    "📌 *Tip:* Odds dropping before kickoff usually means sharp money is on that side. Pay attention to line movement.",
    "📌 *Tip:* Both Teams to Score (BTTS) markets are often better value than match result in high-scoring leagues.",
  ];

  const t = tips[Math.floor(Math.random() * tips.length)];
  ctx.reply(t + "\n\n_Use /tip anytime for another tip._", { parse_mode: "Markdown" });
}

// /odds <value> <format> — convert odds
async function odds(ctx) {
  const args = ctx.message.text.replace("/odds", "").trim().split(/\s+/);

  if (args.length < 1 || !args[0]) {
    return ctx.reply(
      `🔄 *Odds Converter*\n\n` +
      `Usage: \`/odds <value> <format>\`\n\n` +
      `Formats: \`decimal\`, \`american\`, \`fractional\`, \`implied\`\n\n` +
      `Examples:\n` +
      `\`/odds 1.85 decimal\` — convert from decimal\n` +
      `\`/odds +150 american\` — convert from american\n` +
      `\`/odds 55 implied\` — convert from implied probability %`,
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
      const pct = parseFloat(val);
      decimal = 100 / pct;
    } else {
      return ctx.reply("❌ Unknown format. Use: `decimal`, `american`, `fractional`, or `implied`", { parse_mode: "Markdown" });
    }

    if (isNaN(decimal) || decimal <= 1) {
      return ctx.reply("❌ Invalid odds value.", { parse_mode: "Markdown" });
    }

    const american = decimal >= 2
      ? `+${((decimal - 1) * 100).toFixed(0)}`
      : `-${(100 / (decimal - 1)).toFixed(0)}`;

    const impliedPct = (1 / decimal * 100).toFixed(2);
    const profitUnit = (decimal - 1).toFixed(4);
    // Simple fractional approximation
    const fracNumerator = Math.round((decimal - 1) * 100);
    const fractional = `${fracNumerator}/100`;

    ctx.reply(
      `🔄 *Odds Conversion*\n\n` +
      `📊 Decimal: *${decimal.toFixed(2)}*\n` +
      `🇺🇸 American: *${american}*\n` +
      `🇬🇧 Fractional: *${fractional}*\n` +
      `🎯 Implied Prob: *${impliedPct}%*\n` +
      `💵 Profit per $1 staked: *$${profitUnit}*`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    ctx.reply(`⚠️ Could not convert odds: ${err.message}`);
  }
}

module.exports = { compare, explain, bankroll, streak, tip, odds, bankrollStore };
