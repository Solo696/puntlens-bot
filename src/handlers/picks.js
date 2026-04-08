const { generatePicks } = require("../services/groq");
const { Markup } = require("telegraf");

async function generate(ctx) {
  const args = ctx.message.text.replace("/picks", "").trim().split(/\s+/).filter(Boolean);

  if (!args.length) {
    return ctx.reply(
      `🔮 *AI Picks — Choose date:*`,
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("📅 Today",       "picks_today_5_10"),
           Markup.button.callback("📅 Tomorrow",    "picks_tomorrow_5_10")],
          [Markup.button.callback("📆 Next 2 Days", "picks_2days_5_10"),
           Markup.button.callback("📆 This Week",   "picks_week_5_10")],
          [Markup.button.callback("🟢 Safe ~3x",    "picks_today_4_3"),
           Markup.button.callback("🔴 Risky ~20x",  "picks_today_5_20")],
          [Markup.button.callback("💥 Longshot ~50x","picks_today_6_50")],
        ]).reply_markup,
      }
    );
  }

  const [dateArg = "today", numGames = "5", targetOdds = "10", ...rest] = args;
  await runPicks(ctx, dateArg, numGames, targetOdds, rest.join(" ") || "any");
}

async function handleAction(ctx) {
  await ctx.answerCbQuery();
  const [dateArg, numGames, targetOdds] = ctx.match[1].split("_");
  await runPicks(ctx, dateArg, numGames, targetOdds, "any");
}

async function runPicks(ctx, dateArg, numGames, targetOdds, league) {
  const dateDesc   = buildDateDesc(dateArg);
  const leagueDesc = league === "any"
    ? "any major football/soccer league (Premier League, La Liga, Serie A, Bundesliga, Champions League, African leagues)"
    : league;

  const msg = await ctx.reply(
    `🔍 Building ${numGames} picks for ${dateDesc}...\n_Takes ~10 sec_`,
    { parse_mode: "Markdown" }
  );

  try {
    const picks = await generatePicks(dateDesc, numGames, targetOdds, leagueDesc);
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `🔮 *AI Picks — ${numGames} Games*\n_${dateDesc} · ~${targetOdds}x odds_\n\n${picks}\n\n⚠️ _For entertainment. Bet responsibly._`,
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("🔄 Regenerate", `picks_${dateArg}_${numGames}_${targetOdds}`)],
          [Markup.button.callback("📈 More games",  `picks_${dateArg}_${Math.min(10, +numGames+2)}_${targetOdds}`),
           Markup.button.callback("💥 Higher odds", `picks_${dateArg}_${numGames}_${Math.min(100, +targetOdds*2)}`)],
        ]).reply_markup,
      }
    );
  } catch (err) {
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚠️ Failed: ${err.message}`);
  }
}

function buildDateDesc(arg) {
  const today = new Date();
  const fmt   = (d) => d.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short", year:"numeric" });
  const add   = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

  switch (arg?.toLowerCase()) {
    case "today":    return `today (${fmt(today)})`;
    case "tomorrow": return `tomorrow (${fmt(add(1))})`;
    case "2days":    return `between today and ${fmt(add(2))}`;
    case "week":     return `between today and ${fmt(add(7))}`;
    default:
      if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
        const d = new Date(arg);
        if (!isNaN(d)) return `on ${fmt(d)}`;
      }
      return `today (${fmt(today)})`;
  }
}

module.exports = { generate, handleAction };
