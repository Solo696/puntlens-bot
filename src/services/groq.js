const Groq = require("groq-sdk");

let _groq = null;
function getGroq() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

async function ask(system, user, maxTokens = 1024) {
  const res = await getGroq().chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user },
    ],
  });
  return res.choices[0]?.message?.content || "No response.";
}

async function analyzeSlip(games, totalOdds) {
  return ask(
    `You are a concise sports betting analyst on Telegram. Max 300 words. Use emojis.
Analyze the slip and give:
1. Difficulty rating (Easy/Medium/Hard/Longshot) + why
2. The 1-2 weakest legs
3. Implied win probability for the full slip
4. 2 quick beginner tips
5. One-line verdict`,
    `Analyze this ${games.length}-game slip (total odds ${totalOdds}):\n\n` +
    games.map((g, i) => `${i+1}. ${g.home} vs ${g.away} — ${g.pick} @ ${g.odds}`).join("\n")
  );
}

async function generatePicks(dateDesc, numGames, targetOdds, leagueDesc) {
  return ask(
    `You are a sports betting analyst on Telegram. Be concise, mobile-friendly. Use emojis.
For each game use this format:
⚽ Team A vs Team B (League)
📅 Date & Time
🎯 Pick: [prediction]
📊 Odds: [decimal]
💡 Why: [one sentence]

End with: total combined odds + confidence %.
Only pick games you're confident are real fixtures for the given date.`,
    `Generate ${numGames} football predictions for ${dateDesc}. Target total odds ~${targetOdds}. Leagues: ${leagueDesc}.`,
    1200
  );
}

module.exports = { ask, analyzeSlip, generatePicks };
