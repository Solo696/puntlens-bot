// Safe Telegram send — falls back to plain text if Markdown fails
async function safeSend(ctx, msgId, text, extra = {}) {
  const safe = text.length > 4000 ? text.slice(0, 3900) + "\n\n...truncated" : text;
  try {
    if (msgId) {
      return await ctx.telegram.editMessageText(ctx.chat.id, msgId, null, safe, { parse_mode: "Markdown", ...extra });
    }
    return await ctx.reply(safe, { parse_mode: "Markdown", ...extra });
  } catch {
    const plain = safe.replace(/[*_`[\]()~>#+=|{}.!\\]/g, "");
    try {
      if (msgId) return await ctx.telegram.editMessageText(ctx.chat.id, msgId, null, plain, extra);
      return await ctx.reply(plain, extra);
    } catch (err) { console.error("safeSend error:", err.message); }
  }
}

module.exports = { safeSend };
