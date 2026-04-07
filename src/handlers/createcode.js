const { fetchSportybet, parseSlip, createBookingCode } = require("../services/sportybet");
const { safeSend } = require("../utils/helpers");

// /createcode CODE1 CODE2 ...
// Fetches all codes, extracts real event IDs, POSTs to Sportybet to create a new merged code
async function createcode(ctx) {
  const args = ctx.message.text.replace("/createcode", "").trim().split(/\s+/).filter(Boolean);

  if (!args.length) {
    return ctx.reply(
      `🎫 *Booking Code Creator*\n\n` +
      `Creates a new Sportybet booking code from one or more existing codes.\n\n` +
      `Usage: \`/createcode CODE1\` — recreate single slip\n` +
      `Usage: \`/createcode CODE1 CODE2\` — merge into new code\n\n` +
      `_Uses real Sportybet event IDs extracted from your slips._`,
      { parse_mode: "Markdown" }
    );
  }

  if (args.length > 5) return ctx.reply("❌ Maximum 5 codes at once.");

  const msg = await ctx.reply(`🎫 Fetching ${args.length} slip(s)...`);

  try {
    // Fetch all codes
    const results = await Promise.all(args.map(c => fetchSportybet(c)));
    const failed  = args.filter((_, i) => !results[i].success);

    if (failed.length === args.length) {
      return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `❌ Could not fetch any of the codes: ${failed.join(", ")}`
      );
    }

    if (failed.length > 0) {
      await ctx.reply(`⚠️ Could not fetch: ${failed.join(", ")} — continuing with the rest.`);
    }

    // Parse and collect all games with their raw IDs
    const allGames = [];
    const successResults = results.filter(r => r.success);
    const region = successResults[0]?.region || "ng";

    for (const r of successResults) {
      const parsed = parseSlip(r.data);
      if (parsed?.games?.length) {
        parsed.games.forEach(g => allGames.push(g));
      }
    }

    if (!allGames.length) {
      return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `⚠️ Could not extract games from the fetched slips.`
      );
    }

    // Check how many have valid IDs
    const withIds    = allGames.filter(g => g.eventId && g.marketId && g.outcomeId);
    const missingIds = allGames.length - withIds.length;

    if (!withIds.length) {
      return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `❌ *No event IDs found*\n\n` +
        `Sportybet didn't return event/market/outcome IDs for these games.\n\n` +
        `This can happen with:\n• Expired/settled slips\n• Live bet slips\n• Virtual sports\n\n` +
        `Try with an active pre-match slip.`
      );
    }

    // Remove duplicates by eventId+marketId+outcomeId
    const seen      = new Set();
    const uniqueGames = withIds.filter(g => {
      const key = `${g.eventId}-${g.marketId}-${g.outcomeId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `🎫 Creating booking code for ${uniqueGames.length} game(s)...\n_Sending to Sportybet API (${region.toUpperCase()})_`
    );

    const result = await createBookingCode(uniqueGames, region);

    if (result.success) {
      let successMsg = `✅ *Booking Code Created!*\n\n`;
      successMsg += `🎫 *Code: \`${result.code}\`*\n`;
      successMsg += `🌍 Region: *${result.region.toUpperCase()}*\n\n`;
      successMsg += `*Games included (${uniqueGames.length}):*\n`;
      uniqueGames.forEach((g, i) => {
        successMsg += `${i+1}. ${g.home} vs ${g.away} — ${g.pick} @ ${g.odds}\n`;
      });
      successMsg += `\n_Share this code on Sportybet to place the bet._`;

      await safeSend(ctx, msg.message_id, successMsg);
    } else {
      // POST failed — show diagnostic info
      let failMsg = `⚠️ *Could not create booking code*\n\n`;

      if (result.reason === "all_payloads_failed") {
        failMsg += `Sportybet rejected all request formats.\n\n`;
        failMsg += `*Possible reasons:*\n`;
        failMsg += `• Sportybet requires a logged-in session token\n`;
        failMsg += `• These event IDs have expired\n`;
        failMsg += `• API endpoint has changed\n\n`;
        failMsg += `*What we tried:*\n`;
        failMsg += `✓ Extracted real event IDs from your slip\n`;
        failMsg += `✓ Tried 4 different request formats\n`;
        failMsg += `✗ Server rejected all without auth token\n\n`;
        failMsg += `*Next step:* We need to capture a valid session cookie from the Sportybet app using HTTP Toolkit. Once we have that, code creation will work.\n\n`;
        failMsg += `_The merged slip is still shown above — you can manually add these games on Sportybet._`;
      } else {
        failMsg += `Reason: ${result.reason}`;
      }

      await safeSend(ctx, msg.message_id, failMsg);
    }

  } catch (err) {
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚠️ Error: ${err.message}`);
  }
}

module.exports = { createcode };
