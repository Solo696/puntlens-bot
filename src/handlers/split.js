const { fetchSportybet, parseSlip } = require("../services/sportybet");
const { ask } = require("../services/groq");

async function split(ctx) {
  const arg = ctx.message.text.replace("/split", "").trim();

  if (!arg) {
    return ctx.reply(
      `✂️ *Split Ticket*\n\n` +
      `I'll break your big accumulator into 2-3 smaller, safer tickets.\n\n` +
      `Usage:\n\`/split ABC12345\` — from booking code\n` +
      `\`/split [paste slip text]\` — from text`,
      { parse_mode: "Markdown" }
    );
  }

  const msg = await ctx.reply("✂️ Splitting your ticket into smaller slips...");

  try {
    let slipText = arg;

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
      `You are a sports betting analyst on Telegram. Be concise. Use emojis.
Given a big accumulator slip, split it into 2-3 smaller tickets:
- Group games by confidence level (high/medium/lower)
- Each mini-slip should have 2-4 games
- Show each mini-slip clearly labeled (Ticket 1, Ticket 2, etc.)
- Show odds for each mini-slip
- Explain the strategy: why splitting increases overall win chances
- Suggest stake distribution across the tickets`,
      `Split this accumulator into smaller tickets:\n\n${slipText}`
    );

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `✂️ *Split Tickets*\n\n${result}`,
      { parse_mode: "Markdown" }
    );

  } catch (err) {
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚠️ Error: ${err.message}`);
  }
}

module.exports = { split };
