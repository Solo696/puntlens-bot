const { ask } = require("../services/groq");
const { Markup } = require("telegraf");
const { getSession, setSession, clearSession } = require("../services/session");
const { safeSend } = require("../utils/helpers");

const PICKS_SYSTEM = `You are PuntLens AI, a conversational sports betting picks assistant on Telegram.
You help users build custom betting slips through natural conversation.

You maintain a list of selected games. When the user asks:
- Generate picks: find real fixtures matching their criteria
- Remove games: remove specific ones by number or name
- Add games: add new ones
- Change sport: football, basketball, tennis, etc or mixed
- Change odds: adjust to hit a target total
- Make safer/riskier: swap games accordingly
- Parallel/system bets: explain and structure them

ALWAYS respond with a brief reply then the CURRENT full slip:

---SLIP---
1. Home vs Away (Sport - League)
Pick: prediction | Odds: decimal
---END---
TOTAL ODDS: X.XX
CONFIDENCE: X%

Be concise. Mobile chat. If you cannot find real fixtures, say so and suggest alternatives.`;

async function startPicks(ctx) {
  const chatId = ctx.chat.id;
  const existing = getSession(chatId);

  if (existing?.type === "picks") {
    return ctx.reply(
      `🔮 You have an active picks session (${existing.gameCount || 0} games).\n\nKeep chatting or start fresh:`,
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("🔄 New Session", "picks_new_session"),
           Markup.button.callback("❌ End", "picks_end_session")],
        ]).reply_markup,
      }
    );
  }

  setSession(chatId, { type: "picks", history: [], gameCount: 0 });

  await ctx.reply(
    `🔮 *AI Picks — Chat Mode*\n\n` +
    `Tell me what you want in plain English:\n\n` +
    `• _"5 games around 10 odds today"_\n` +
    `• _"50 odds safest basketball games"_\n` +
    `• _"500 odds football only"_\n` +
    `• _"Remove game 3, add an over 2.5"_\n` +
    `• _"Make it safer"_\n` +
    `• _"10 over 1.5 games this week"_\n` +
    `• _"Mix football and basketball"_\n` +
    `• _"Replace game 2 with something lower odds"_\n\n` +
    `What would you like? 👇`,
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("❌ End Session", "picks_end_session")],
      ]).reply_markup,
    }
  );
}

async function handlePicksMessage(ctx, userMessage) {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  if (!session) return ctx.reply("No active session. Tap 🔮 AI Picks to start.");

  const typing = await ctx.reply("🤔 Working on it...");

  try {
    const historyText = session.history
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const fullPrompt = historyText
      ? `${historyText}\n\nUser: ${userMessage}`
      : userMessage;

    const response = await ask(PICKS_SYSTEM, fullPrompt, 1500);

    const newHistory = [
      ...session.history,
      { role: "user", content: userMessage },
      { role: "assistant", content: response },
    ].slice(-20);

    const gameCount = (response.match(/^\d+\./gm) || []).length;
    setSession(chatId, { type: "picks", history: newHistory, gameCount });

    await safeSend(ctx, typing.message_id, response, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Regenerate", "picks_regenerate"),
         Markup.button.callback("❌ End", "picks_end_session")],
      ]).reply_markup,
    });

  } catch (err) {
    safeSend(ctx, typing.message_id, `⚠️ Error: ${err.message}`);
  }
}

async function handlePicksAction(ctx) {
  await ctx.answerCbQuery();
  const action = ctx.match[1]; // what comes after "picks_"
  const chatId = ctx.chat.id;

  if (action === "end_session") {
    clearSession(chatId);
    return ctx.reply("✅ Picks session ended.");
  }

  if (action === "new_session") {
    clearSession(chatId);
    return startPicks(ctx);
  }

  if (action === "regenerate") {
    const session = getSession(chatId);
    if (!session?.history?.length) return ctx.reply("Nothing to regenerate.");
    // Replay last user message
    const lastUser = [...session.history].reverse().find(m => m.role === "user");
    if (lastUser) {
      // Remove last exchange before regenerating
      const trimmed = session.history.slice(0, -2);
      setSession(chatId, { ...session, history: trimmed });
      return handlePicksMessage(ctx, lastUser.content);
    }
  }
}

module.exports = { startPicks, handlePicksMessage, handlePicksAction };
