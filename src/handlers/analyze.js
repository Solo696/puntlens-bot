const { fetchSportybet, parseSlip, formatSlip } = require("../services/sportybet");
const { analyzeSlip } = require("../services/groq");

const waitingForCode = new Set();

async function promptCode(ctx) {
  waitingForCode.add(ctx.chat.id);
  await ctx.reply(
    `📋 *Send me your Sportybet booking code*\n\nJust type or paste the code (e.g. \`ABC12345\`)`,
    { parse_mode: "Markdown" }
  );
}

async function byCode(ctx, rawCode) {
  const code = (rawCode || ctx.message.text.replace("/analyze", "").trim()).toUpperCase();

  if (!code) return promptCode(ctx);

  waitingForCode.delete(ctx.chat.id);
  const msg = await ctx.reply(`🔍 Fetching \`${code}\`...`, { parse_mode: "Markdown" });

  try {
    const fetched = await fetchSportybet(code);

    if (!fetched.success) {
      return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `❌ Could not fetch code \`${code}\`\n\n` +
        `Possible reasons:\n• Code expired\n• Wrong code\n• Unsupported region\n\n` +
        `Supported: Sportybet NG, GH, KE, TZ, UG, ZA`,
        { parse_mode: "Markdown" }
      );
    }

    const parsed = parseSlip(fetched.data);
    if (!parsed?.games?.length) {
      return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `⚠️ Fetched the slip but couldn't read the games. Format may have changed.`
      );
    }

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      formatSlip(parsed, code, fetched.region),
      { parse_mode: "Markdown" }
    );

    const analyzing = await ctx.reply("🤖 Analyzing...");
    const analysis = await analyzeSlip(parsed.games, parsed.totalOdds);
    await ctx.telegram.editMessageText(ctx.chat.id, analyzing.message_id, null,
      `🧠 *AI Analysis*\n\n${analysis}`,
      { parse_mode: "Markdown" }
    );

  } catch (err) {
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚠️ Error: ${err.message}`);
  }
}

module.exports = { promptCode, byCode, waitingForCode };
