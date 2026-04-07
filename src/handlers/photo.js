const axios = require("axios");

async function analyzePhoto(ctx) {
  const msg = await ctx.reply("📷 Reading your slip...");

  try {
    // Get largest photo
    const photo  = ctx.message.photo.reduce((a, b) => b.file_size > a.file_size ? b : a);
    const file   = await ctx.telegram.getFile(photo.file_id);
    const imgUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const imgRes = await axios.get(imgUrl, { responseType: "arraybuffer" });
    const base64 = Buffer.from(imgRes.data).toString("base64");

    // Claude Vision
    const res = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 900,
        system: `You are a betting slip analyzer on Telegram. Be concise, mobile-friendly. Max 300 words. Use emojis.
From the slip image:
1. List every game: Team A vs Team B → Pick → Odds
2. Total combined odds + payout per $10 staked
3. Difficulty: Easy / Medium / Hard / Longshot
4. Implied win probability %
5. 2 quick tips + one-line verdict
If not a betting slip or too blurry, say so clearly.`,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
            { type: "text",  text: "Analyze this betting slip." }
          ]
        }]
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        }
      }
    );

    const analysis = res.data?.content?.map((b) => b.text || "").join("") || "No response.";
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `🧠 *Slip Analysis*\n\n${analysis}`,
      { parse_mode: "Markdown" }
    );

  } catch (err) {
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `⚠️ Couldn't read the image. Make sure it's a clear slip screenshot.\n\nError: ${err.message}`
    );
  }
}

module.exports = { analyzePhoto };
