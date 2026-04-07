require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const express = require("express");

const { promptCode, byCode, waitingForCode, handleSlipMessage, handleSlipAction } = require("./handlers/analyze");
const picksHandler   = require("./handlers/picks");
const stakeHandler   = require("./handlers/stake");
const journalHandler = require("./handlers/journal");
const photoHandler   = require("./handlers/photo");
const { safer }      = require("./handlers/safer");
const { split }      = require("./handlers/split");
const { compare, explain, value, bankroll, streak, tip, odds } = require("./handlers/extras");
const { debugSlip }  = require("./handlers/debug");
const { merge }       = require("./handlers/merge");
const { createcode }  = require("./handlers/createcode");
const { smart, handleSmartAction } = require("./handlers/smart");
const { getSession, clearSession } = require("./services/session");
const { getQuota }   = require("./services/footballapi");

// Keep-alive server
const app = express();
app.get("/", (_, res) => res.send("PuntLens Bot is running ✅"));
app.listen(process.env.PORT || 3000, () => console.log("✅ Keep-alive server running"));

const bot = new Telegraf(process.env.BOT_TOKEN);

// ── Persistent reply keyboard ─────────────────────────────────────────────────
const mainMenu = Markup.keyboard([
  ["🔍 Analyze Code",  "🔮 AI Picks"],
  ["🧩 Smart Ticket",  "💎 Value Scan"],
  ["🔀 Merge Codes",   "✂️ Split Ticket"],
  ["🛡️ Safer Slip",   "📖 Explain Slip"],
  ["⚖️ Compare Slips", "💰 Stake Calc"],
  ["🔄 Odds Convert",  "🏦 Bankroll"],
  ["📓 Log Bet",       "📊 My Stats"],
  ["📋 History",       "🔥 Streak"],
  ["💡 Betting Tip",   "🧹 Clear"],
]).resize();

// ── /start ────────────────────────────────────────────────────────────────────
bot.start((ctx) => ctx.reply(
  `🎯 *Welcome to PuntLens!*\n\nYour personal AI betting intelligence system.\nTap any button to get started 👇`,
  { parse_mode: "Markdown", ...mainMenu }
));

bot.command("menu", (ctx) => ctx.reply("Tap a button 👇", mainMenu));

// ── /clear ────────────────────────────────────────────────────────────────────
bot.command("clear", (ctx) => {
  clearSession(ctx.chat.id);
  waitingForCode.delete(ctx.chat.id);
  ctx.reply("🧹 Cleared. Fresh start!", mainMenu);
});

// ── /apistatus ────────────────────────────────────────────────────────────────
bot.command("apistatus", async (ctx) => {
  const quota = await getQuota();
  if (!quota) {
    return ctx.reply(
      `📡 *API-Football Status*\n\n⚠️ Not configured or unreachable.\n\nAdd \`FOOTBALL_API_KEY\` to your Render env vars.\nSign up free: dashboard.api-football.com`,
      { parse_mode: "Markdown" }
    );
  }
  const used      = quota.current || 0;
  const limit     = quota.limit_day || 100;
  const remaining = limit - used;
  const bar       = "█".repeat(Math.round((used/limit)*10)) + "░".repeat(10 - Math.round((used/limit)*10));
  ctx.reply(
    `📡 *API-Football Quota*\n\n${bar}\n*${used}/${limit}* requests used today\n*${remaining}* remaining\n\n${remaining < 20 ? "⚠️ Running low — use sparingly." : "✅ Good to go."}`,
    { parse_mode: "Markdown" }
  );
});

// ── /help ─────────────────────────────────────────────────────────────────────
bot.help((ctx) => ctx.reply(
  `🎯 *PuntLens — Betting Intelligence*\n\n` +
  `*ANALYSIS*\n` +
  `🔍 Analyze Code — load slip + intelligence + value detection\n` +
  `💎 Value Scan — scan slip for value bets\n` +
  `📷 Send photo — read slip image\n\n` +
  `*SMART TOOLS*\n` +
  `🧩 Smart Ticket — AI risk-profiled ticket with form data\n` +
  `🔮 AI Picks — conversational picks builder\n` +
  `🔀 Merge Codes — combine multiple slips\n\n` +
  `*SLIP TOOLS*\n` +
  `🛡️ Safer | ✂️ Split | ⚖️ Compare | 📖 Explain\n\n` +
  `*CALCULATORS*\n` +
  `💰 Stake Calc | 🔄 Odds Convert | 🏦 Bankroll\n\n` +
  `*JOURNAL*\n` +
  `📓 Log Bet | 📊 Stats | 📋 History | 🔥 Streak\n\n` +
  `*OTHER*\n` +
  `💡 Tip | 🧹 Clear | /apistatus\n\n` +
  `*Chat mode:* After loading a slip or starting Picks/Smart, chat freely:\n` +
  `_"Remove game 3"_ · _"Make safer"_ · _"50 odds basketball"_`,
  { parse_mode: "Markdown", ...mainMenu }
));

// ── All commands ──────────────────────────────────────────────────────────────
bot.command("analyze",   (ctx) => byCode(ctx));
bot.command("smart",     smart);
bot.command("value",     value);
bot.command("safer",     safer);
bot.command("split",     split);
bot.command("compare",   compare);
bot.command("explain",   explain);
bot.command("picks",     picksHandler.startPicks);
bot.command("merge",      merge);
bot.command("createcode", createcode);
bot.command("stake",     stakeHandler.calculate);
bot.command("bankroll",  bankroll);
bot.command("odds",      odds);
bot.command("log",       journalHandler.logBet);
bot.command("stats",     journalHandler.getStats);
bot.command("history",   journalHandler.getHistory);
bot.command("streak",    streak);
bot.command("tip",       tip);
bot.command("debug",     debugSlip);

// ── Photo ─────────────────────────────────────────────────────────────────────
bot.on("photo", photoHandler.analyzePhoto);

// ── Inline callbacks ──────────────────────────────────────────────────────────
bot.action(/^result_(won|lost|void)_(.+)$/, journalHandler.updateResult);
bot.action(/^picks_(.+)$/,                  picksHandler.handlePicksAction);
bot.action(/^slip_(.+)$/,                   handleSlipAction);
bot.action(/^smart_(.+)$/,                  handleSmartAction);

// ── Text handler ──────────────────────────────────────────────────────────────
bot.on("text", async (ctx) => {
  const text   = ctx.message.text.trim();
  const chatId = ctx.chat.id;

  switch (text) {
    case "🔍 Analyze Code":
      waitingForCode.delete(chatId);
      return promptCode(ctx);
    case "🔮 AI Picks":
      waitingForCode.delete(chatId);
      return picksHandler.startPicks(ctx);
    case "🧩 Smart Ticket":
      waitingForCode.delete(chatId);
      return smart(ctx);
    case "💎 Value Scan":
      waitingForCode.delete(chatId);
      return ctx.reply("Send your booking code:\n`/value ABC12345`", { parse_mode: "Markdown" });
    case "🔀 Merge Codes":
      waitingForCode.delete(chatId);
      return ctx.reply("Send codes to merge:\n`/merge CODE1 CODE2`\n\nTo create a new booking code:\n`/createcode CODE1 CODE2`", { parse_mode: "Markdown" });
    case "🛡️ Safer Slip":
      waitingForCode.delete(chatId);
      return ctx.reply("Send your booking code:\n`/safer ABC12345`", { parse_mode: "Markdown" });
    case "✂️ Split Ticket":
      waitingForCode.delete(chatId);
      return ctx.reply("Send your booking code:\n`/split ABC12345`", { parse_mode: "Markdown" });
    case "⚖️ Compare Slips":
      waitingForCode.delete(chatId);
      return ctx.reply("Send two codes:\n`/compare CODE1 CODE2`", { parse_mode: "Markdown" });
    case "📖 Explain Slip":
      waitingForCode.delete(chatId);
      return ctx.reply("Send your booking code:\n`/explain ABC12345`", { parse_mode: "Markdown" });
    case "💰 Stake Calc":    return stakeHandler.calculate(ctx);
    case "🔄 Odds Convert":  return odds(ctx);
    case "🏦 Bankroll":      return bankroll(ctx);
    case "📓 Log Bet":       return journalHandler.logBet(ctx);
    case "📊 My Stats":      return journalHandler.getStats(ctx);
    case "📋 History":       return journalHandler.getHistory(ctx);
    case "🔥 Streak":        return streak(ctx);
    case "💡 Betting Tip":   return tip(ctx);
    case "🧹 Clear":
      clearSession(chatId);
      waitingForCode.delete(chatId);
      return ctx.reply("🧹 Cleared. Fresh start!", mainMenu);
  }

  if (text.startsWith("/")) return;

  // Route to active session
  const session = getSession(chatId);
  if (session?.type === "analyze") return handleSlipMessage(ctx, text);
  if (session?.type === "picks")   return picksHandler.handlePicksMessage(ctx, text);

  // Waiting for booking code
  if (waitingForCode.has(chatId)) return byCode(ctx, text);

  // Auto-detect booking code
  if (/^[a-zA-Z0-9]{5,15}$/.test(text)) return byCode(ctx, text);

  ctx.reply("Tap a button below or use /help.", mainMenu);
});

// ── Launch ────────────────────────────────────────────────────────────────────
bot.launch().then(() => console.log("🤖 PuntLens Bot running..."));
process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
