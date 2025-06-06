const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');

// Bot configuration
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = process.env.PORT || 3000;

// Create Express app for web server
const app = express();

// In-memory storage (use a database in production)
const userData = new Map(); // userId -> { reputation, wins, losses, debates }
const activeDebates = new Map(); // debateId -> debate object
const pendingChallenges = new Map(); // challengeId -> challenge object

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Helper functions
function getUser(userId) {
    if (!userData.has(userId)) {
        userData.set(userId, {
            reputation: 1000,
            wins: 0,
            losses: 0,
            activeDebates: 0,
            totalDebates: 0
        });
    }
    return userData.get(userId);
}

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

function calculateRepChange(winnerRep, loserRep) {
    // ELO-like system
    const kFactor = 32;
    const expectedWin = 1 / (1 + Math.pow(10, (loserRep - winnerRep) / 400));
    return Math.round(kFactor * (1 - expectedWin));
}

// Slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('challenge')
        .setDescription('Challenge another user to a debate')
        .addUserOption(option =>
            option.setName('opponent')
                .setDescription('The user you want to challenge')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('topic')
                .setDescription('The debate topic')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('duration')
                .setDescription('Debate duration in minutes (5-60)')
                .setMinValue(5)
                .setMaxValue(60)
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('reputation')
        .setDescription('Check reputation and stats')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check (defaults to yourself)')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Show the reputation leaderboard'),

    new SlashCommandBuilder()
        .setName('debates')
        .setDescription('List your active debates'),

    new SlashCommandBuilder()
        .setName('enddebate')
        .setDescription('End an active debate and declare winner')
        .addStringOption(option =>
            option.setName('debate_id')
                .setDescription('The debate ID')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('winner')
                .setDescription('The winner of the debate')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('debatehelp')
        .setDescription('Get help with debate commands'),
];

// Register slash commands
async function registerCommands() {
    const rest = new REST().setToken(TOKEN);
    
    try {
        console.log('Started refreshing application (/) commands.');
        
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );
        
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
}

// When the client is ready
client.once(Events.ClientReady, (c) => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
});

// Handle slash commands
client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
    }
});

async function handleSlashCommand(interaction) {
    const { commandName } = interaction;

    switch (commandName) {
        case 'challenge':
            await handleChallenge(interaction);
            break;
            
        case 'reputation':
            await handleReputation(interaction);
            break;
            
        case 'leaderboard':
            await handleLeaderboard(interaction);
            break;
            
        case 'debates':
            await handleDebates(interaction);
            break;
            
        case 'enddebate':
            await handleEndDebate(interaction);
            break;
            
        case 'debatehelp':
            await handleDebateHelp(interaction);
            break;
            
        default:
            await interaction.reply('Unknown command!');
    }
}

async function handleChallenge(interaction) {
    const challenger = interaction.user;
    const opponent = interaction.options.getUser('opponent');
    const topic = interaction.options.getString('topic');
    const duration = interaction.options.getInteger('duration') || 30;

    // Validation
    if (opponent.id === challenger.id) {
        return await interaction.reply({ content: '❌ You cannot challenge yourself!', ephemeral: true });
    }

    if (opponent.bot) {
        return await interaction.reply({ content: '❌ You cannot challenge bots!', ephemeral: true });
    }

    const challengerData = getUser(challenger.id);
    const opponentData = getUser(opponent.id);

    if (challengerData.activeDebates >= 3) {
        return await interaction.reply({ content: '❌ You already have 3 active debates. Finish some first!', ephemeral: true });
    }

    if (opponentData.activeDebates >= 3) {
        return await interaction.reply({ content: '❌ Your opponent already has 3 active debates!', ephemeral: true });
    }

    // Create challenge
    const challengeId = generateId();
    const challenge = {
        id: challengeId,
        challenger: challenger.id,
        opponent: opponent.id,
        topic: topic,
        duration: duration,
        createdAt: Date.now(),
        guildId: interaction.guild.id,
        channelId: interaction.channel.id
    };

    pendingChallenges.set(challengeId, challenge);

    // Create challenge embed
    const embed = new EmbedBuilder()
        .setColor(0xFF6B35)
        .setTitle('🎯 Debate Challenge!')
        .setDescription(`**${challenger.displayName}** has challenged **${opponent.displayName}** to a debate!`)
        .addFields(
            { name: '📝 Topic', value: topic, inline: false },
            { name: '⏱️ Duration', value: `${duration} minutes`, inline: true },
            { name: '🏆 Challenger Rep', value: challengerData.reputation.toString(), inline: true },
            { name: '🏆 Opponent Rep', value: opponentData.reputation.toString(), inline: true }
        )
        .setFooter({ text: `Challenge ID: ${challengeId}` })
        .setTimestamp();

    // Create buttons
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`accept_${challengeId}`)
                .setLabel('✅ Accept Challenge')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`decline_${challengeId}`)
                .setLabel('❌ Decline Challenge')
                .setStyle(ButtonStyle.Danger)
        );

    await interaction.reply({
        content: `${opponent}, you have been challenged to a debate!`,
        embeds: [embed],
        components: [row]
    });

    // Auto-expire challenge after 5 minutes
    setTimeout(() => {
        if (pendingChallenges.has(challengeId)) {
            pendingChallenges.delete(challengeId);
        }
    }, 300000);
}

async function handleButtonInteraction(interaction) {
    const [action, challengeId] = interaction.customId.split('_');
    const challenge = pendingChallenges.get(challengeId);

    if (!challenge) {
        return await interaction.reply({ content: '❌ This challenge has expired or no longer exists!', ephemeral: true });
    }

    if (interaction.user.id !== challenge.opponent) {
        return await interaction.reply({ content: '❌ Only the challenged user can respond to this challenge!', ephemeral: true });
    }

    if (action === 'accept') {
        // Start the debate
        const debateId = generateId();
        const debate = {
            id: debateId,
            participants: [challenge.challenger, challenge.opponent],
            topic: challenge.topic,
            duration: challenge.duration,
            startTime: Date.now(),
            endTime: Date.now() + (challenge.duration * 60 * 1000),
            status: 'active',
            guildId: challenge.guildId,
            channelId: challenge.channelId
        };

        activeDebates.set(debateId, debate);
        
        // Update user data
        getUser(challenge.challenger).activeDebates++;
        getUser(challenge.opponent).activeDebates++;
        
        // Remove pending challenge
        pendingChallenges.delete(challengeId);

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('🔥 Debate Started!')
            .setDescription(`The debate between <@${challenge.challenger}> and <@${challenge.opponent}> has begun!`)
            .addFields(
                { name: '📝 Topic', value: challenge.topic, inline: false },
                { name: '⏱️ Duration', value: `${challenge.duration} minutes`, inline: true },
                { name: '🆔 Debate ID', value: debateId, inline: true }
            )
            .setFooter({ text: 'Use /enddebate to conclude when finished' })
            .setTimestamp();

        await interaction.update({
            content: '✅ Challenge accepted!',
            embeds: [embed],
            components: []
        });

        // Auto-end debate after duration
        setTimeout(() => {
            if (activeDebates.has(debateId)) {
                const debate = activeDebates.get(debateId);
                if (debate.status === 'active') {
                    debate.status = 'expired';
                    // Reduce active debate count
                    getUser(challenge.challenger).activeDebates--;
                    getUser(challenge.opponent).activeDebates--;
                }
            }
        }, challenge.duration * 60 * 1000);

    } else if (action === 'decline') {
        pendingChallenges.delete(challengeId);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Challenge Declined')
            .setDescription(`<@${challenge.opponent}> has declined the debate challenge.`)
            .setTimestamp();

        await interaction.update({
            content: '',
            embeds: [embed],
            components: []
        });
    }
}

async function handleReputation(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const userData = getUser(user.id);

    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`📊 ${user.displayName}'s Debate Stats`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
            { name: '🏆 Reputation', value: userData.reputation.toString(), inline: true },
            { name: '✅ Wins', value: userData.wins.toString(), inline: true },
            { name: '❌ Losses', value: userData.losses.toString(), inline: true },
            { name: '🎯 Active Debates', value: userData.activeDebates.toString(), inline: true },
            { name: '📈 Total Debates', value: userData.totalDebates.toString(), inline: true },
            { name: '📊 Win Rate', value: userData.totalDebates > 0 ? `${Math.round((userData.wins / userData.totalDebates) * 100)}%` : 'N/A', inline: true }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleLeaderboard(interaction) {
    const users = Array.from(userData.entries())
        .sort(([,a], [,b]) => b.reputation - a.reputation)
        .slice(0, 10);

    if (users.length === 0) {
        return await interaction.reply('📊 No users have debated yet!');
    }

    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('🏆 Debate Leaderboard')
        .setDescription(
            users.map(([userId, data], index) => 
                `**${index + 1}.** <@${userId}> - **${data.reputation}** rep (${data.wins}W/${data.losses}L)`
            ).join('\n')
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleDebates(interaction) {
    const userId = interaction.user.id;
    const userDebates = Array.from(activeDebates.values())
        .filter(debate => debate.participants.includes(userId) && debate.status === 'active');

    if (userDebates.length === 0) {
        return await interaction.reply({ content: '📝 You have no active debates.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('📝 Your Active Debates')
        .setDescription(
            userDebates.map(debate => {
                const opponent = debate.participants.find(id => id !== userId);
                const timeLeft = Math.max(0, Math.round((debate.endTime - Date.now()) / 60000));
                return `**${debate.id}** - vs <@${opponent}>\n📝 ${debate.topic}\n⏰ ${timeLeft} minutes left`;
            }).join('\n\n')
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleEndDebate(interaction) {
    const debateId = interaction.options.getString('debate_id');
    const winner = interaction.options.getUser('winner');
    const debate = activeDebates.get(debateId);

    if (!debate) {
        return await interaction.reply({ content: '❌ Debate not found!', ephemeral: true });
    }

    if (debate.status !== 'active') {
        return await interaction.reply({ content: '❌ This debate is not active!', ephemeral: true });
    }

    if (!debate.participants.includes(interaction.user.id)) {
        return await interaction.reply({ content: '❌ You are not a participant in this debate!', ephemeral: true });
    }

    if (!debate.participants.includes(winner.id)) {
        return await interaction.reply({ content: '❌ Winner must be a participant in the debate!', ephemeral: true });
    }

    // End the debate
    debate.status = 'completed';
    const loser = debate.participants.find(id => id !== winner.id);
    
    // Update stats
    const winnerData = getUser(winner.id);
    const loserData = getUser(loser);
    
    const repChange = calculateRepChange(winnerData.reputation, loserData.reputation);
    
    winnerData.reputation += repChange;
    winnerData.wins++;
    winnerData.activeDebates--;
    winnerData.totalDebates++;
    
    loserData.reputation = Math.max(100, loserData.reputation - repChange); // Min 100 rep
    loserData.losses++;
    loserData.activeDebates--;
    loserData.totalDebates++;
    
    activeDebates.delete(debateId);

    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎉 Debate Concluded!')
        .setDescription(`**Winner:** <@${winner.id}>\n**Topic:** ${debate.topic}`)
        .addFields(
            { name: '🏆 Winner Rep Change', value: `+${repChange} (${winnerData.reputation})`, inline: true },
            { name: '📉 Loser Rep Change', value: `-${repChange} (${loserData.reputation})`, inline: true }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleDebateHelp(interaction) {
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('🎯 Debate Bot Help')
        .setDescription('Here are all the available commands:')
        .addFields(
            { name: '/challenge', value: 'Challenge another user to a debate', inline: false },
            { name: '/reputation', value: 'Check reputation and debate stats', inline: false },
            { name: '/leaderboard', value: 'View the top debaters', inline: false },
            { name: '/debates', value: 'List your active debates', inline: false },
            { name: '/enddebate', value: 'End a debate and declare winner', inline: false }
        )
        .addFields(
            { name: '📋 How it works:', value: 
                '1. Challenge someone with `/challenge`\n' +
                '2. They can accept or decline\n' +
                '3. Debate for the specified duration\n' +
                '4. Use `/enddebate` to conclude\n' +
                '5. Winner gains reputation points!', inline: false }
        )
        .setFooter({ text: 'Reputation uses an ELO-like system - beating higher-rated opponents gives more points!' });

    await interaction.reply({ embeds: [embed] });
}

// Error handling
client.on(Events.Error, (error) => {
    console.error('Discord client error:', error);
});

// Login to Discord
client.login(TOKEN);

// Register commands when starting the bot
registerCommands();

// Web server to keep bot alive
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Debate Bot Status</title>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        background: #2c2f33; 
                        color: #ffffff; 
                        text-align: center; 
                        padding: 50px;
                    }
                    .status { 
                        background: #7289da; 
                        padding: 20px; 
                        border-radius: 10px; 
                        display: inline-block;
                        margin: 20px;
                    }
                    .stats {
                        background: #23272a;
                        padding: 15px;
                        border-radius: 5px;
                        margin: 10px;
                    }
                </style>
            </head>
            <body>
                <h1>🎯 Debate Bot is Online!</h1>
                <div class="status">
                    <h2>✅ Bot Status: Active</h2>
                    <p>Last ping: ${new Date().toLocaleString()}</p>
                </div>
                <div class="stats">
                    <h3>📊 Current Stats</h3>
                    <p>Active Debates: ${activeDebates.size}</p>
                    <p>Pending Challenges: ${pendingChallenges.size}</p>
                    <p>Registered Users: ${userData.size}</p>
                </div>
                <div class="stats">
                    <h3>🔗 Add Bot to Server</h3>
                    <p>Use Discord Developer Portal to generate invite link</p>
                </div>
            </body>
        </html>
    `);
});

app.get('/ping', (req, res) => {
    res.json({ 
        status: 'online', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        botReady: client.readyTimestamp ? true : false
    });
});

app.get('/stats', (req, res) => {
    res.json({
        activeDebates: activeDebates.size,
        pendingChallenges: pendingChallenges.size,
        registeredUsers: userData.size,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
    });
});

