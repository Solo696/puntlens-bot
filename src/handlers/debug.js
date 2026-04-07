const axios = require("axios");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36",
  "Accept": "application/json",
  "Referer": "https://www.sportybet.com/",
  "Origin": "https://www.sportybet.com",
};

async function debugSlip(ctx) {
  const code = ctx.message.text.replace("/debug", "").trim().toUpperCase();
  if (!code) return ctx.reply("Usage: `/debug ABC12345`", { parse_mode: "Markdown" });

  const msg = await ctx.reply(`🔍 Fetching raw data for \`${code}\`...`, { parse_mode: "Markdown" });

  for (const region of ["ng", "gh", "ke", "tz", "ug", "za"]) {
    try {
      const res = await axios.get(
        `https://www.sportybet.com/api/${region}/orders/share/${code}`,
        { headers: HEADERS, timeout: 8000 }
      );

      const data       = res.data?.data || res.data;
      const selections = data?.outcomes || data?.selections || data?.betGames || data?.events || [];
      if (!selections.length) continue;

      const first   = selections[0];
      const markets = first.markets || [];

      // Send top-level fields
      const topKeys = Object.keys(first).filter(k => k !== "markets" && k !== "eventSource");
      const topDump = topKeys.map(k => {
        const v = first[k];
        const d = typeof v === "object" ? JSON.stringify(v).slice(0, 120) : String(v);
        return `${k}: ${d}`;
      }).join("\n");

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `📦 Region: ${region.toUpperCase()} | Games: ${selections.length}\n\n${topDump}`
      );

      // Send markets array in full as separate messages
      if (markets.length > 0) {
        for (let i = 0; i < Math.min(markets.length, 3); i++) {
          const m    = markets[i];
          const dump = JSON.stringify(m, null, 2);
          // Split if too long
          const chunks = [];
          for (let j = 0; j < dump.length; j += 3500) {
            chunks.push(dump.slice(j, j + 3500));
          }
          for (const chunk of chunks) {
            await ctx.reply(`📋 Market[${i}]:\n${chunk}`);
          }
        }
      } else {
        await ctx.reply("⚠️ No markets array found in this game object.");
      }

      // Also show total slip metadata
      const meta = {
        totalOdds:    data?.totalOdds || data?.odds,
        stake:        data?.stake || data?.amount,
        potentialWin: data?.potentialWin || data?.possibleWin,
        currency:     data?.currency || data?.currencyCode,
        shareCode:    data?.shareCode || data?.bookingCode || data?.code,
      };
      await ctx.reply(`📊 Slip metadata:\n${JSON.stringify(meta, null, 2)}`);

      return;
    } catch { continue; }
  }

  ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Could not fetch that code.");
}

module.exports = { debugSlip };
