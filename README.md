
# Discord Debate Bot

A Discord bot that allows users to challenge each other to debates and tracks reputation scores using an ELO-like system.

## Features

- **Challenge System**: Users can challenge each other to debates on any topic
- **Reputation Tracking**: ELO-like system that adjusts scores based on opponent strength
- **Active Debate Management**: Track ongoing debates with time limits
- **Leaderboard**: View top debaters by reputation
- **Stats Tracking**: Individual win/loss records and statistics

## Commands

- `/challenge @user topic [duration]` - Challenge another user to a debate
- `/reputation [@user]` - Check reputation and stats
- `/leaderboard` - Show the reputation leaderboard
- `/debates` - List your active debates
- `/enddebate debate_id @winner` - End a debate and declare winner
- `/debatehelp` - Get help with commands

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables:
   - `DISCORD_TOKEN` - Your bot's Discord token
   - `CLIENT_ID` - Your bot's client ID

3. Run the bot:
   ```bash
   npm start
   ```

## How It Works

1. Users challenge each other with `/challenge`
2. Challenged users can accept or decline
3. Active debates have time limits (5-60 minutes)
4. Participants use `/enddebate` to conclude and declare winner
5. Reputation adjusts based on ELO system - beating stronger opponents gives more points!

## Environment Variables

Make sure to set these environment variables:
- `DISCORD_TOKEN`: Your Discord bot token
- `CLIENT_ID`: Your Discord application client ID
