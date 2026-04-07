const { fetchSportybet, parseSlip, formatSlip } = require("../services/sportybet");
const { ask } = require("../services/groq");
const { getSession, setSession, clearSession } = require("../services/session");
const { safeSend } = require("../utils/helpers");
const { getMatchContext } = require("../services/footballapi");
const {
  detectValueEdge,
  calculateDiversification,
  diversificationLabel,
  detectOverlaps,
  suggestStake,
  calculateProbability,
  confidenceLevel,
} = require("../services/intelligence");
const { Markup } = require("telegraf");

const waitingForCode = new Set();

const SLIP_SYSTEM = `You are PuntLens AI, a conversational betting slip assistant on Telegram.
The user has shared a betting slip. Help them analyze, modify and optimize it.

You can:
- Analyze: difficulty, weakest legs, implied probability, tips
- Remove games by number or name, recalculate odds
- Add new games (suggest real fixtures)
- Make safer: remove/replace riskiest legs
- Split into 2-3 smaller tickets
- Explain specific markets in plain English

After ANY modification, ALWAYS show the updated slip:

---SLIP---
1. Home vs Away (Sport)
Pick: prediction | Odds: decimal
---END---
TOTAL ODDS: X.XX

Be concise. Mobile chat.`;

async function promptCode(ctx) {
  waitingForCode.add(ctx.chat.id);
  await ctx.reply(
    `📋 *Send me your Sportybet booking code*\n\nJust type or paste it (e.g. \`ABC12345\`)`,
    { parse_mode: "Markdown" }
  );
}

async function byCode(ctx, rawCode) {
  const input = rawCode || ctx.message?.text?.replace("/analyze", "").trim() || "";
  const code  = input.toUpperCase();
  if (!code) return promptCode(ctx);

  waitingForCode.delete(ctx.chat.id);
  const msg = await ctx.reply(`🔍 Fetching \`${code}\`...`, { parse_mode: "Markdown" });

  try {
    const fetched = await fetchSportybet(code);
    if (!fetched.success) {
      return safeSend(ctx, msg.message_id,
        `❌ Could not fetch code \`${code}\`\n\nPossible reasons:\n• Code expired\n• Wrong code\n• Unsupported region\n\nSupported: Sportybet NG, GH, KE, TZ, UG, ZA`
      );
    }

    const parsed = parseSlip(fetched.data);
    if (!parsed?.games?.length) {
      return safeSend(ctx, msg.message_id, `⚠️ Fetched but couldn't read the games.`);
    }

    // Show raw slip first
    await safeSend(ctx, msg.message_id, formatSlip(parsed, code, fetched.region));

    // Run intelligence on games
    const analyzing = await ctx.reply("🧠 Running intelligence analysis...");

    const enriched = await Promise.all(parsed.games.map(async (g) => {
      try {
        const context = await getMatchContext(g.home, g.away);
        const prob    = context ? calculateProbability(context, g.pick) : null;
        const odds    = parseFloat(g.odds);
        const value   = prob && !isNaN(odds) ? detectValueEdge(prob, odds) : null;
        return { ...g, probability: prob, confidence: prob ? confidenceLevel(prob) : null, value };
      } catch {
        return g;
      }
    }));

    const overlaps  = detectOverlaps([enriched]);
    const divScore  = calculateDiversification(enriched);
    const divInfo   = diversificationLabel(divScore);
    const session   = getSession(ctx.chat.id);
    const bankroll  = session?.bankroll || null;
    const stakeInfo = bankroll ? suggestStake(bankroll, enriched, overlaps.length) : null;

    // Build intelligence report
    let report = `🧠 *Intelligence Report*\n${"─".repeat(28)}\n\n`;

    enriched.forEach((g, i) => {
      const prob   = g.probability ? `${g.probability}%` : "N/A";
      const conf   = g.confidence || "";
      const val    = g.value?.label ? ` 💎 ${g.value.label} VALUE (edge: +${g.value.edge}%)` : "";
      report += `*${i+1}. ${g.home} vs ${g.away}*\n`;
      report += `   🎯 ${g.pick} @ ${g.odds} | Prob: *${prob}* ${conf}${val}\n\n`;
    });

    report += `${"─".repeat(28)}\n`;
    report += `🎯 *Diversification: ${divScore}/100* — ${divInfo.label}\n`;
    if (divInfo.advice) report += `_${divInfo.advice}_\n`;

    if (overlaps.length) {
      report += `\n⚠️ *${overlaps.length} overlap(s):*\n`;
      overlaps.forEach(o => report += `  • ${o.type}: ${o.game}\n`);
    }

    if (stakeInfo) {
      report += `\n💰 Suggested stake: *$${stakeInfo.stakeAmount}* (${stakeInfo.stakePercent}%)\n`;
      if (stakeInfo.exposureWarning) report += `⚠️ High exposure warning.\n`;
    }

    report += `\n_💬 Chat to modify — remove games, add games, make safer, split, etc._`;

    // Set session
    const slipText = enriched.map((g, i) =>
      `${i+1}. ${g.home} vs ${g.away} (${g.sport}) — Pick: ${g.pick} | Odds: ${g.odds}${g.probability ? ` | Prob: ${g.probability}%` : ""}`
    ).join("\n");

    setSession(ctx.chat.id, {
      type:      "analyze",
      code,
      bankroll,
      history:   [{ role: "assistant", content: `Slip loaded (code: ${code}, total odds: ${parsed.totalOdds}):\n\n${slipText}` }],
      gameCount: parsed.games.length,
    });

    await safeSend(ctx, analyzing.message_id, report, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("🛡️ Make Safer", "slip_make_safer"),
         Markup.button.callback("✂️ Split",       "slip_split")],
        [Markup.button.callback("❌ End Session", "slip_end_session")],
      ]).reply_markup,
    });

  } catch (err) {
    safeSend(ctx, msg.message_id, `⚠️ Error: ${err.message}`);
  }
}

async function handleSlipMessage(ctx, userMessage) {
  const chatId  = ctx.chat.id;
  const session = getSession(chatId);
  if (!session) return ctx.reply("No active session. Send a booking code first.");

  const typing = await ctx.reply("🤔 Working on it...");

  try {
    const historyText = session.history
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const response = await ask(SLIP_SYSTEM, `${historyText}\n\nUser: ${userMessage}`, 1000);

    const newHistory = [
      ...session.history,
      { role: "user",      content: userMessage },
      { role: "assistant", content: response },
    ].slice(-20);

    setSession(chatId, { ...session, history: newHistory });

    await safeSend(ctx, typing.message_id, response, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("🛡️ Safer", "slip_make_safer"),
         Markup.button.callback("✂️ Split",  "slip_split")],
        [Markup.button.callback("❌ End Session", "slip_end_session")],
      ]).reply_markup,
    });

  } catch (err) {
    safeSend(ctx, typing.message_id, `⚠️ ${err.message}`);
  }
}

async function handleSlipAction(ctx) {
  await ctx.answerCbQuery();
  const action = ctx.match[1];
  const chatId = ctx.chat.id;

  if (action === "end_session") {
    clearSession(chatId);
    return ctx.reply("✅ Session ended.");
  }

  const session = getSession(chatId);
  if (!session) return ctx.reply("No active session.");

  const prompts = {
    make_safer: "Make this slip safer — remove or replace the riskiest legs",
    split:      "Split this slip into 2-3 smaller tickets grouped by confidence",
  };

  if (prompts[action]) return handleSlipMessage(ctx, prompts[action]);
}

module.exports = { promptCode, byCode, waitingForCode, handleSlipMessage, handleSlipAction };
