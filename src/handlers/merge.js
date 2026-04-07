const { fetchSportybet, parseSlip, formatSlip } = require("../services/sportybet");
const axios = require("axios");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "Referer": "https://www.sportybet.com/",
  "Origin": "https://www.sportybet.com",
};

// Attempt to create a booking code on Sportybet
async function createBookingCode(games, region = "ng") {
  // Build selections array using the raw event data we fetched
  const selections = games.map((g) => ({
    eventId:   g.eventId,
    marketId:  g.marketId,
    outcomeId: g.outcomeId,
    odds:      g.oddsRaw,
    specifier: g.specifier || "",
  })).filter(s => s.eventId && s.marketId && s.outcomeId);

  if (!selections.length) return { success: false, reason: "no_event_ids" };

  try {
    const res = await axios.post(
      `https://www.sportybet.com/api/${region}/orders/share`,
      { selections },
      { headers: HEADERS, timeout: 10000 }
    );

    const code =
      res.data?.data?.shareCode ||
      res.data?.data?.bookingCode ||
      res.data?.shareCode ||
      res.data?.bookingCode ||
      res.data?.code ||
      res.data?.data?.code;

    if (code) return { success: true, code, region };
    return { success: false, reason: "no_code_in_response", raw: res.data };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

// /merge CODE1 CODE2 [CODE3...]
async function merge(ctx) {
  const args = ctx.message.text.replace("/merge", "").trim().split(/\s+/).filter(Boolean);

  if (args.length < 2) {
    return ctx.reply(
      `🔀 *Merge Booking Codes*\n\n` +
      `Combine multiple slips into one.\n\n` +
      `Usage: \`/merge CODE1 CODE2 [CODE3...]\`\n` +
      `Example: \`/merge ABC123 XYZ456\`\n\n` +
      `Up to 5 codes at once.`,
      { parse_mode: "Markdown" }
    );
  }

  if (args.length > 5) {
    return ctx.reply("❌ Maximum 5 codes at once.");
  }

  const msg = await ctx.reply(`🔀 Fetching ${args.length} slips...`);

  try {
    // Fetch all codes in parallel
    const results = await Promise.all(args.map(c => fetchSportybet(c)));
    const failed  = args.filter((_, i) => !results[i].success);

    if (failed.length === args.length) {
      return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `❌ Could not fetch any of the codes.\n\nFailed: ${failed.join(", ")}`
      );
    }

    if (failed.length > 0) {
      await ctx.reply(`⚠️ Could not fetch: ${failed.join(", ")} — continuing with the rest.`);
    }

    // Parse and collect all games
    const allGames = [];
    const successResults = results.filter(r => r.success);

    for (const r of successResults) {
      const parsed = parseSlip(r.data);
      if (parsed?.games?.length) {
        // Attach raw API fields for booking code creation
        const raw = r.data?.data || r.data;
        const selections = raw?.outcomes || raw?.selections || raw?.betGames || raw?.events || [];

        parsed.games.forEach((g, i) => {
          const s = selections[i] || {};
          const market = s.markets?.[0] || {};
          const outcome = market?.outcomes?.[0] || market?.selections?.[0] || {};
          allGames.push({
            ...g,
            eventId:   s.eventId || s.gameId,
            marketId:  market?.id || s.marketId,
            outcomeId: outcome?.id || outcome?.outcomeId,
            oddsRaw:   outcome?.odds || g.odds,
            specifier: market?.specifier || "",
            region:    r.region,
          });
        });
      }
    }

    if (!allGames.length) {
      return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `⚠️ Fetched codes but couldn't extract games.`
      );
    }

    // Remove duplicate events
    const seen = new Set();
    const uniqueGames = allGames.filter(g => {
      const key = `${g.home}-${g.away}-${g.pick}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const totalOdds = uniqueGames
      .filter(g => g.odds !== "?")
      .reduce((acc, g) => acc * parseFloat(g.odds), 1)
      .toFixed(2);

    // Show merged slip
    let mergedMsg = `🔀 *Merged Slip* (${uniqueGames.length} games)\n`;
    mergedMsg += `From: ${args.filter((_, i) => results[i].success).map(c => `\`${c.toUpperCase()}\``).join(" + ")}\n`;
    mergedMsg += `${"─".repeat(28)}\n\n`;

    uniqueGames.forEach((g, i) => {
      const sport  = g.sport ? ` · ${g.sport}` : "";
      const league = g.league ? `\n   🏆 ${g.league}` : "";
      mergedMsg += `⏳ *${i+1}. ${g.home} vs ${g.away}*${sport}${league}\n`;
      mergedMsg += `   🎯 *${g.pick}* @ *${g.odds}*\n\n`;
    });

    mergedMsg += `${"─".repeat(28)}\n`;
    mergedMsg += `⚽ *${uniqueGames.length} games* | 📊 *Total odds: ${totalOdds}*`;

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      mergedMsg, { parse_mode: "Markdown" }
    );

    // Attempt to create a new booking code
    const creating = await ctx.reply("🎫 Attempting to create a merged booking code...");
    const region   = successResults[0]?.region || "ng";
    const created  = await createBookingCode(uniqueGames, region);

    if (created.success) {
      await ctx.telegram.editMessageText(ctx.chat.id, creating.message_id, null,
        `✅ *Merged Booking Code Created!*\n\n` +
        `🎫 Code: \`${created.code}\`\n` +
        `🌍 Region: ${created.region.toUpperCase()}\n\n` +
        `Share or load this code on Sportybet to place the merged bet.`,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.telegram.editMessageText(ctx.chat.id, creating.message_id, null,
        `⚠️ *Could not auto-create booking code*\n\n` +
        `Reason: ${created.reason === "no_event_ids"
          ? "Missing event IDs from API response — Sportybet may require authentication to create codes."
          : created.reason}\n\n` +
        `The merged slip above shows all games and odds. You can manually add them on Sportybet.`
      );
    }

  } catch (err) {
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚠️ Error: ${err.message}`);
  }
}

module.exports = { merge };
