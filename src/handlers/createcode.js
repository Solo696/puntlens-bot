const { fetchSportybet, parseSlip, createBookingCode } = require("../services/sportybet");
const { safeSend } = require("../utils/helpers");

async function createcode(ctx) {
  const args = ctx.message.text.replace("/createcode", "").trim().split(/\s+/).filter(Boolean);

  if (!args.length) {
    return ctx.reply(
      `🎫 *Booking Code Creator*\n\n` +
      `Creates a new Sportybet booking code from existing slip(s).\n\n` +
      `\`/createcode CODE\` — recreate a single slip\n` +
      `\`/createcode CODE1 CODE2\` — merge into one new code\n\n` +
      `_Uses real event IDs extracted from your slips._`,
      { parse_mode: "Markdown" }
    );
  }

  if (args.length > 5) return ctx.reply("❌ Maximum 5 codes at once.");

  const msg = await ctx.reply(`🎫 Fetching ${args.length} slip(s)...`);

  try {
    const results = await Promise.all(args.map(c => fetchSportybet(c)));
    const failed  = args.filter((_, i) => !results[i].success);

    if (failed.length === args.length) {
      return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `❌ Could not fetch any codes: ${failed.join(", ")}`
      );
    }

    if (failed.length > 0) {
      await ctx.reply(`⚠️ Could not fetch: ${failed.join(", ")} — continuing with rest.`);
    }

    // Collect all games with IDs
    const allGames = [];
    const region   = results.find(r => r.success)?.region || "ng";

    for (const r of results.filter(r => r.success)) {
      const parsed = parseSlip(r.data);
      if (parsed?.games?.length) parsed.games.forEach(g => allGames.push(g));
    }

    if (!allGames.length) {
      return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `⚠️ Could not extract games.`
      );
    }

    // Deduplicate
    const seen      = new Set();
    const unique    = allGames.filter(g => {
      const key = `${g.eventId}-${g.marketId}-${g.outcomeId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const withIds    = unique.filter(g => g.eventId && g.marketId && g.outcomeId && String(g.marketId) !== "undefined");
    const missingIds = unique.length - withIds.length;

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `🎫 Creating code for *${withIds.length} game(s)*${missingIds > 0 ? ` (${missingIds} skipped — no IDs)` : ""}...\n_Trying Sportybet API (${region.toUpperCase()})_`,
      { parse_mode: "Markdown" }
    );

    if (!withIds.length) {
      return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `❌ *No usable event IDs found*\n\n` +
        `This happens with:\n• Already settled/expired slips\n• Live bet slips\n• Virtual sports\n\n` +
        `Try with an *active pre-match slip* that hasn't started yet.`
      );
    }

    const result = await createBookingCode(withIds, region);

    if (result.success) {
      let m = `✅ *Booking Code Created!*\n\n🎫 Code: \`${result.code}\`\n🌍 Region: ${result.region.toUpperCase()}\n\n`;
      m += `*Games (${withIds.length}):*\n`;
      withIds.forEach((g, i) => {
        m += `${i+1}. ${g.home} vs ${g.away} — ${g.pick} @ ${g.odds}\n`;
      });
      m += `\n_Share this code on Sportybet to place the bet._`;
      await safeSend(ctx, msg.message_id, m);

    } else if (result.reason === "auth_required") {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `🔐 *Auth Required (HTTP ${result.status})*\n\n` +
        `Sportybet requires a login session token to create booking codes.\n\n` +
        `*To get the token:*\n` +
        `1. Install *HTTP Toolkit* on PC (free)\n` +
        `2. Connect phone as proxy\n` +
        `3. Open Sportybet app → create any slip → tap Book\n` +
        `4. HTTP Toolkit shows the exact request with auth headers\n` +
        `5. Share the \`Authorization\` or \`Cookie\` header with me\n\n` +
        `Once we have the token, code creation will work permanently.`
      );
    } else {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `⚠️ *Could not create code*\n\nReason: ${result.reason}\n\nSportybet may require authentication. Check Render logs for details.`
      );
    }

  } catch (err) {
    console.error("[createcode] Error:", err.message);
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `⚠️ Error: ${err.message}`
    );
  }
}

module.exports = { createcode };
