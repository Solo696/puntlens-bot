# 🎯 PuntLens Bot (Personal)

Personal AI betting assistant Telegram bot. No database — runs fully from Termux.

## Features
- Send a **booking code** → fetches all games from Sportybet + AI analysis
- Send a **slip photo** → Claude Vision reads it
- `/picks` → AI generates predictions from real fixtures
- `/stake` → Kelly Criterion stake calculator
- `/log` → betting journal (saved locally as `journal.json`)
- `/stats` → P&L, ROI, win rate
- `/history` → last 10 bets

## Setup (Termux)

```bash
# 1. Extract and enter the folder
cd puntlens-bot

# 2. Install dependencies
npm install

# 3. Create your .env file
cp .env.example .env
nano .env
# Fill in your 3 keys (see below)

# 4. Run the bot
node src/index.js
```

## Environment Variables (only 3)

```
BOT_TOKEN=        ← from @BotFather on Telegram
GROQ_API_KEY=     ← from console.groq.com (you already have this)
ANTHROPIC_API_KEY= ← from console.anthropic.com
```

## Get your keys

**BOT_TOKEN:**
1. Open Telegram → search `@BotFather`
2. Send `/newbot`
3. Name it anything (e.g. `PuntLens`)
4. Copy the token

**GROQ_API_KEY:** Already have this from W3Eyes

**ANTHROPIC_API_KEY:**
1. Go to console.anthropic.com
2. API Keys → Create Key
3. Copy it

## Usage

```
# Booking code (send directly or with command)
ABC12345
/analyze ABC12345

# Send any slip screenshot as a photo

# AI Picks
/picks                        ← interactive buttons
/picks today 5 10             ← 5 games, ~10x odds
/picks tomorrow 3 5           ← 3 games, ~5x odds
/picks 2025-04-10 4 20        ← specific date
/picks week 8 50              ← this week, longshot

# Kelly Calculator
/stake 100 1.85 55            ← bankroll, odds, win%
/stake 100 1.85 55 0.5        ← half kelly
/stake 100 1.85 55 0.25       ← quarter kelly (default)

# Journal
/log Man City Win | 10 | 1.85
/log Over 2.5 Goals | 5 | 1.75 | Football
/stats
/history
```

## Keep it running in Termux

Use your existing Termux keep-alive boot script, or run:
```bash
nohup node src/index.js &
```

## Deploy to Railway (optional)

If you want it always-on without keeping Termux open:
```bash
git init && git add . && git commit -m "PuntLens bot"
# Push to GitHub, then connect repo in Railway dashboard
# Set the 3 env vars in Railway → Deploy
```
