const { ask } = require("../services/groq");
const { getMatchContext } = require("../services/footballapi");
const {
  calculateProbability, confidenceLevel, detectValueEdge,
  detectOverlaps, calculateDiversification, diversificationLabel,
  suggestStake, analyzeGame,
} = require("../services/intelligence");
const { getSession } = require("../services/session");
const { getBankroll } = require("./extras");
const { safeSend } = require("../utils/helpers");
const { Markup } = require("telegraf");

const RISK_PROFILES = {
  low:    { oddsTarget: "3-8",    minProb: 65, label: "🟢 Low Risk",    desc: "High probability picks, safer odds" },
  medium: { oddsTarget: "8-25",   minProb: 50, label: "🟡 Medium Risk", desc: "Balanced odds and probability" },
  high:   { oddsTarget: "25-100", minProb: 40, label: "🔴 High Risk",   desc: "Higher odds, lower probability, bigger returns" },
};

async function smart(ctx) {
  const arg     = ctx.message?.text?.replace("/smart", "").trim().toLowerCase() || "";
  const profile = RISK_PROFILES[arg] || null;

  if (!profile) {
    return ctx.reply(
      `🧩 *Smart Ticket Generator*\n\nAI builds an intelligent ticket with probability, value detection, and form data.\n\nChoose a risk level:`,
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("🟢 Low Risk",    "smart_low")],
          [Markup.button.callback("🟡 Medium Risk", "smart_medium")],
          [Markup.button.callback("🔴 High Risk",   "smart_high")],
        ]).reply_markup,
      }
    );
  }

  await runSmartGeneration(ctx, arg);
}

async function handleSmartAction(ctx) {
  await ctx.answerCbQuery();
  await runSmartGeneration(ctx, ctx.match[1]);
}

async function runSmartGeneration(ctx, risk) {
  const profile  = RISK_PROFILES[risk] || RISK_PROFILES.medium;
  const chatId   = ctx.chat.id;
  const bankroll = getBankroll(chatId);

  const msg = await ctx.reply(
    `🧩 Generating ${profile.label} ticket...\n_Fetching fixtures + form data_`,
    { parse_mode: "Markdown" }
  );

  try {
    // Step 1: AI generates structured candidates
    const aiResponse = await ask(
      `You are a sports betting analyst. Generate exactly 6 candidate football games for a ${risk} risk slip.
Target total odds: ${profile.oddsTarget}x. Each game should have ~${profile.minProb}%+ win probability.

Output ONLY 6 lines in this EXACT format:
GAME|Home Team|Away Team|League|Pick|Odds|Reason1|Reason2|Risk

Example:
GAME|Arsenal|Chelsea|Premier League|Home Win|1.85|Strong home form (WWWDW)|High attack output (2.1 avg goals)|Away team missing key striker

Rules:
- Pick can be: Home Win, Away Win, Draw, Over 2.5, Under 2.5, BTTS Yes, BTTS No, Over 1.5, DNB Home, DNB Away
- Odds must be decimal (e.g. 1.85)
- Reason1, Reason2: short supporting reasons
- Risk: one short risk factor
- No extra text, just the 6 GAME| lines`,
      `Generate 6 ${risk} risk games for today/tomorrow. Odds range: ${profile.oddsTarget}.`,
      800
    );

    const lines      = aiResponse.split("\n").filter(l => l.startsWith("GAME|"));
    const candidates = lines.map(l => {
      const p = l.split("|");
      return {
        home:    p[1]?.trim(),
        away:    p[2]?.trim(),
        league:  p[3]?.trim() || "Unknown",
        pick:    p[4]?.trim(),
        odds:    p[5]?.trim(),
        reason1: p[6]?.trim() || "",
        reason2: p[7]?.trim() || "",
        riskFactor: p[8]?.trim() || "",
        sport:   "Football",
      };
    }).filter(g => g.home && g.away && g.pick && g.odds);

    if (!candidates.length) {
      return safeSend(ctx, msg.message_id, "⚠️ Could not generate candidates. Please try again.");
    }

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `🧩 Enriching ${candidates.length} games with form data...`
    );

    // Step 2: Enrich with form data
    const enriched = await Promise.all(candidates.map(async (g) => {
      try {
        const context = await getMatchContext(g.home, g.away);
        const result  = await analyzeGame(g, context);
        // Merge AI reasons with form data
        return {
          ...result,
          reason1:    g.reason1,
          reason2:    g.reason2,
          riskFactor: g.riskFactor,
        };
      } catch {
        return { ...g, probability: null, confidence: null, value: null, formContext: null };
      }
    }));

    // Step 3: Filter by risk profile, sort by value edge
    const ranked = enriched
      .filter(g => {
        const o = parseFloat(g.odds);
        if (isNaN(o)) return false;
        if (g.probability && g.probability < profile.minProb) return false;
        return true;
      })
      .sort((a, b) => (b.value?.edge || 0) - (a.value?.edge || 0));

    const selected = (ranked.length >= 3 ? ranked : enriched).slice(0, 5);

    // Step 4: Intelligence checks
    // BUG FIX: detectOverlaps expects array of tickets (array of arrays)
    // For single ticket, check within itself
    const singleTicketOverlaps = [];
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        const { classifyOverlap } = require("../services/intelligence");
        const type = classifyOverlap(selected[i], selected[j]);
        if (type) singleTicketOverlaps.push({ type, game: `${selected[i].home} vs ${selected[i].away}`, pick1: selected[i].pick, pick2: selected[j].pick });
      }
    }

    const divScore  = calculateDiversification(selected);
    const divInfo   = diversificationLabel(divScore);
    const stakeInfo = bankroll ? suggestStake(bankroll, selected, singleTicketOverlaps.length) : null;
    const totalOdds = selected
      .filter(g => !isNaN(parseFloat(g.odds)))
      .reduce((acc, g) => acc * parseFloat(g.odds), 1)
      .toFixed(2);

    // Step 5: Build output
    let response = `🧩 *${profile.label} Ticket*\n_${profile.desc}_\n${"─".repeat(28)}\n\n`;

    selected.forEach((g, i) => {
      const prob   = g.probability ? `${g.probability}%` : "N/A";
      const conf   = g.confidence  ? ` · ${g.confidence}` : "";
      const valTag = g.value?.label ? ` 💎 ${g.value.label} VALUE (+${g.value.edge}%)` : "";
      const form   = g.formContext  ? `\n   📈 ${g.formContext.homeForm} vs ${g.formContext.awayForm} · H2H: ${g.formContext.h2hRecord}` : "";

      response += `*${i+1}. ${g.home} vs ${g.away}*\n`;
      response += `   🏆 ${g.league}${form}\n`;
      response += `   🎯 *${g.pick}* @ *${g.odds}*\n`;
      response += `   🧠 Prob: *${prob}*${conf}${valTag}\n`;
      if (g.reason1) response += `   ✅ ${g.reason1}\n`;
      if (g.reason2) response += `   ✅ ${g.reason2}\n`;
      if (g.riskFactor) response += `   ⚠️ Risk: ${g.riskFactor}\n`;
      response += "\n";
    });

    response += `${"─".repeat(28)}\n`;
    response += `📊 *Total Odds: ${totalOdds}*\n`;
    response += `🎯 Diversification: *${divScore}/100* — ${divInfo.label}\n`;
    if (divInfo.advice) response += `_${divInfo.advice}_\n`;

    if (singleTicketOverlaps.length) {
      response += `\n⚠️ *${singleTicketOverlaps.length} overlap(s):*\n`;
      singleTicketOverlaps.forEach(o => response += `  • ${o.type}: ${o.game}\n`);
    }

    if (stakeInfo) {
      response += `\n💰 Stake: *$${stakeInfo.stakeAmount}* (${stakeInfo.stakePercent}% of $${bankroll})\n`;
      response += `💵 Potential return: *$${stakeInfo.potentialReturn}*\n`;
      if (stakeInfo.exposureWarning) response += `⚠️ High exposure — consider reducing stake.\n`;
      if (stakeInfo.note)            response += `_${stakeInfo.note}_\n`;
    } else {
      response += `\n_Set bankroll with 🏦 Bankroll for stake suggestions._\n`;
    }

    response += `\n⚠️ _For entertainment. Bet responsibly._`;

    await safeSend(ctx, msg.message_id, response, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("🟢 Low", "smart_low"),
         Markup.button.callback("🟡 Medium", "smart_medium"),
         Markup.button.callback("🔴 High", "smart_high")],
        [Markup.button.callback("🔄 Regenerate", `smart_${risk}`)],
      ]).reply_markup,
    });

  } catch (err) {
    safeSend(ctx, msg.message_id, `⚠️ Error: ${err.message}`);
  }
}

module.exports = { smart, handleSmartAction };
