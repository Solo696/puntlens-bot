const { fetchSportybet, parseSlip } = require("../services/sportybet");
const { ask } = require("../services/groq");

async function safer(ctx) {
  const arg = ctx.message.text.replace("/safer", "").trim();

  if (!arg) {
    return ctx.reply(
      `🛡️ *Make It Safer*\n\n` +
      `Send your booking code or paste your slip and I'll rebuild it with safer picks.\n\n` +
      `Usage:\n\`/safer ABC12345\` — from booking code\n` +
      `\`/safer [paste slip text]\` — from text`,
      { parse_mode: "Markdown" }
    );
  }

  const msg = await ctx.reply("🛡️ Rebuilding your slip with safer picks...");

  try {
    let slipText = arg;

    // If it looks like a booking code, fetch it
    if (/^[a-zA-Z0-9]{5,15}$/.test(arg)) {
      const fetched = await fetchSportybet(arg);
      if (!fetched.success) {
        return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
          `❌ Could not fetch code \`${arg.toUpperCase()}\`. Try pasting the slip text instead.`,
          { parse_mode: "Markdown" }
        );
      }
      const parsed = parseSlip(fetched.data);
      if (parsed?.games?.length) {
        slipText = parsed.games.map((g, i) =>
          `${i+1}. ${g.home} vs ${g.away} — ${g.pick} @ ${g.odds}`
        ).join("\n");
      }
    }

    const result = await ask(
      `You are a sports betting risk analyst on Telegram. Be concise. Use emojis.
Given a betting slip, your job is to:
1. Identify the 2-3 riskiest/weakest legs
2. Remove or replace them with safer alternatives
3. Show the new safer slip with estimated odds per game
4. Show before vs after: original total odds → new safer odds
5. Explain why each change makes it safer
Goal: reduce total odds to a more winnable range while keeping value.`,
      `Make this slip safer:\n\n${slipText}`
    );

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `🛡️ *Safer Version*\n\n${result}`,
      { parse_mode: "Markdown" }
    );

  } catch (err) {
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚠️ Error: ${err.message}`);
  }
}

module.exports = { safer };
