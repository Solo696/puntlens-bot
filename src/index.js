require("dotenv").config();
const { Telegraf } = require("telegraf");
const express = require("express");

const { promptCode, byCode, waitingForCode } = require("./handlers/analyze");
const picksHandler   = require("./handlers/picks");
const stakeHandler   = require("./handlers/stake");
const journalHandler = require("./handlers/journal");
const photoHandler   = require("./handlers/photo");
const { safer }      = require("./handlers/safer");
const { split }      = require("./handlers/split");
const { compare, explain, bankroll, streak, tip, odds } = require("./handlers/extras");

// Keep-alive server
const app = express();
app.get("/", (_, res) => res.send("PuntLens Bot is running ✅"));
app.listen(process.env.PORT || 3000, () => console.log("✅ Keep-alive server running"));

const bot = new Telegraf(process.env.BOT_TOKEN);

// ── /start ────────────────────────────────────────────────────────────────────
bot.start((ctx) => ctx.reply(
  `🎯 *PuntLens — Personal Betting Assistant*\n\n` +
  `*SLIP ANALYSIS*\n` +
  `\`/analyze\` — fetch & analyze booking code\n` +
  `📷 Send a photo — read slip image\n\n` +
  `*SLIP TOOLS*\n` +
  `\`/safer\` — rebuild slip with safer picks\n` +
  `\`/split\` — break big accumulator into smaller tickets\n` +
  `\`/compare\` — compare two slips side by side\n` +
  `\`/explain\` — explain every market in plain English\n\n` +
  `*AI PICKS*\n` +
  `\`/picks\` — generate predictions from real fixtures\n\n` +
  `*CALCULATORS*\n` +
  `\`/stake\` — Kelly criterion stake calculator\n` +
  `\`/odds\` — convert odds between formats\n` +
  `\`/bankroll\` — set your bankroll\n\n` +
  `*JOURNAL*\n` +
  `\`/log\` — log a bet\n` +
  `\`/stats\` — P&L, ROI, win rate\n` +
  `\`/history\` — last 10 bets\n` +
  `\`/streak\` — your current win/loss streak\n\n` +
  `*OTHER*\n` +
  `\`/tip\` — random betting strategy tip\n` +
  `\`/help\` — full command list`,
  { parse_mode: "Markdown" }
));

// ── /help ─────────────────────────────────────────────────────────────────────
bot.help((ctx) => ctx.reply(
  `🎯 *PuntLens Commands*\n\n` +
  `*SLIP ANALYSIS*\n` +
  `\`/analyze\` — prompts for booking code\n` +
  `\`/analyze ABC12345\` — direct code\n` +
  `Send a photo of any slip\n\n` +
  `*SLIP TOOLS*\n` +
  `\`/safer ABC12345\` — safer version of slip\n` +
  `\`/split ABC12345\` — split into smaller tickets\n` +
  `\`/compare CODE1 CODE2\` — compare two slips\n` +
  `\`/explain ABC12345\` — explain markets in plain English\n\n` +
  `*AI PICKS*\n` +
  `\`/picks\` — interactive menu\n` +
  `\`/picks today 5 10\` — 5 games ~10x odds\n` +
  `\`/picks tomorrow 3 5\`\n` +
  `\`/picks 2025-04-10 4 20\` — specific date\n` +
  `\`/picks week 6 50\` — this week longshot\n\n` +
  `*CALCULATORS*\n` +
  `\`/stake 100 1.85 55\` — kelly calculator\n` +
  `\`/stake 100 1.85 55 0.25\` — quarter kelly\n` +
  `\`/odds 1.85 decimal\` — convert odds\n` +
  `\`/odds +150 american\`\n` +
  `\`/bankroll 100\` — set your bankroll\n\n` +
  `*JOURNAL*\n` +
  `\`/log Description | Stake | Odds\`\n` +
  `\`/stats\` — P&L, ROI, win rate\n` +
  `\`/history\` — last 10 bets\n` +
  `\`/streak\` — current win/loss streak\n\n` +
  `*OTHER*\n` +
  `\`/tip\` — random betting tip`,
  { parse_mode: "Markdown" }
));

// ── Commands ──────────────────────────────────────────────────────────────────
bot.command("analyze",  (ctx) => byCode(ctx));
bot.command("safer",    safer);
bot.command("split",    split);
bot.command("compare",  compare);
bot.command("explain",  explain);
bot.command("picks",    picksHandler.generate);
bot.command("stake",    stakeHandler.calculate);
bot.command("bankroll", bankroll);
bot.command("odds",     odds);
bot.command("log",      journalHandler.logBet);
bot.command("stats",    journalHandler.getStats);
bot.command("history",  journalHandler.getHistory);
bot.command("streak",   streak);
bot.command("tip",      tip);

// ── Photo ─────────────────────────────────────────────────────────────────────
bot.on("photo", photoHandler.analyzePhoto);

// ── Inline callbacks ──────────────────────────────────────────────────────────
bot.action(/^result_(won|lost|void)_(.+)$/, journalHandler.updateResult);
bot.action(/^picks_(.+)$/,                  picksHandler.handleAction);

// ── Plain text — booking code or prompt response ──────────────────────────────
bot.on("text", (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  // If waiting for a code after /analyze prompt
  if (waitingForCode.has(ctx.chat.id)) {
    return byCode(ctx, text);
  }

  // Auto-detect booking code (5-15 alphanumeric chars)
  if (/^[a-zA-Z0-9]{5,15}$/.test(text)) {
    return byCode(ctx, text);
  }

  ctx.reply(
    `Use /analyze to analyze a slip, or /help to see all commands.`
  );
});

const { createcode } = require("./handlers/createcode");
bot.command("createcode", createcode);

// ── Launch ────────────────────────────────────────────────────────────────────
bot.launch().then(() => console.log("🤖 PuntLens Bot running..."));
process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
const { createcode }  = require("./handlers/createcode");
bot.command("createcode", createcode);
