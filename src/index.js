require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  Collection,
  GatewayIntentBits,
  ApplicationFlags,
  Events,
  REST,
  Routes,
  ActivityType,
  MessageFlags,
} = require('discord.js');

const { handleEventInteraction } = require('./handlers/eventHandler');
const {
  handleReminderInteraction,
  resumeRemindersOnStartup,
} = require('./handlers/reminderManager');
const {
  handleRelayMessageCreate,
  handleRelayInteraction,
} = require('./handlers/relayManager');
const { handlePresetInteraction } = require('./handlers/presetManager');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token) {
  console.error('❌ Missing DISCORD_TOKEN in .env file. Copy .env.example to .env and add your bot token.');
  process.exit(1);
}

const commandsMap = new Collection();
const commandsPayload = [];

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    commandsMap.set(command.data.name, command);
    commandsPayload.push(command.data.toJSON());
  }
}

function createConfiguredClient(intents) {
  const client = new Client({ intents });
  client.commands = commandsMap;
  client.on(Events.Error, (err) => console.error('[Client Error]:', err.message));
  client.on(Events.ShardError, () => {});

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`✅ Logged in as ${readyClient.user.tag} (${readyClient.user.id})`);
    readyClient.user.setActivity('/help | Events & Channels', { type: ActivityType.Watching });

    try {
      const rest = new REST().setToken(token);
      const appId = /^\d{17,20}$/.test(clientId?.trim() || '')
        ? clientId.trim()
        : readyClient.user.id;
      const trimmedGuildId = guildId?.trim() || '';

      if (/^\d{17,20}$/.test(trimmedGuildId)) {
        await rest.put(Routes.applicationCommands(appId), { body: [] });
        await rest.put(Routes.applicationGuildCommands(appId, trimmedGuildId), {
          body: commandsPayload,
        });
        console.log(`⚡ Synced ${commandsPayload.length} slash commands to guild ${trimmedGuildId}.`);
      } else if (readyClient.guilds.cache.size > 0) {
        await rest.put(Routes.applicationCommands(appId), { body: [] });
        for (const [gId, guild] of readyClient.guilds.cache) {
          await rest.put(Routes.applicationGuildCommands(appId, gId), {
            body: commandsPayload,
          });
          console.log(`⚡ Instantly synced ${commandsPayload.length} slash commands to server "${guild.name}" (${gId}).`);
        }
      } else {
        await rest.put(Routes.applicationCommands(appId), {
          body: commandsPayload,
        });
        console.log(`🌍 Synced ${commandsPayload.length} global slash commands.`);
      }
    } catch (err) {
      console.error('⚠️ Failed to auto-sync slash commands on startup:', err.message);
    }

    resumeRemindersOnStartup(readyClient);
  });

  client.on(Events.GuildCreate, async (guild) => {
    try {
      const rest = new REST().setToken(token);
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), {
        body: commandsPayload,
      });
      console.log(`⚡ Auto-synced ${commandsPayload.length} slash commands to newly joined server "${guild.name}" (${guild.id}).`);
    } catch (err) {
      console.error(`⚠️ Failed to sync commands to guild ${guild.id}:`, err.message);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleRelayMessageCreate(message);
    } catch (err) {
      console.error('[MessageCreate Relay Error]:', err);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.inGuild()) {
      if (interaction.isRepliable()) {
        return interaction.reply({
          content: '❌ Commands and controls can only be used inside a Discord server.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    try {
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
        return;
      }

      const customId = interaction.customId || '';

      if (customId.startsWith('event_')) {
        await handleEventInteraction(interaction);
        return;
      }

      if (customId.startsWith('rem_')) {
        await handleReminderInteraction(interaction);
        return;
      }

      if (customId.startsWith('relay_')) {
        await handleRelayInteraction(interaction);
        return;
      }

      if (customId.startsWith('preset_')) {
        await handlePresetInteraction(interaction);
        return;
      }
    } catch (error) {
      console.error('[Interaction Error]:', error);
      if (interaction.isRepliable()) {
        const errPayload = {
          content: '❌ An unexpected error occurred while processing this interaction.',
          flags: MessageFlags.Ephemeral,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errPayload).catch(() => {});
        } else {
          await interaction.reply(errPayload).catch(() => {});
        }
      }
    }
  });

  return client;
}

async function startBot() {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildScheduledEvents,
  ];

  try {
    const rest = new REST().setToken(token);
    const app = await rest.get(Routes.oauth2CurrentApplication());
    const hasMessageContentFlag = Boolean(
      (app.flags || 0) &
        (ApplicationFlags.GatewayMessageContent | ApplicationFlags.GatewayMessageContentLimited)
    );

    if (hasMessageContentFlag) {
      intents.push(GatewayIntentBits.MessageContent);
    } else {
      console.log(
        'ℹ️  Note: "Message Content Intent" is currently off in Discord Developer Portal.\n' +
          '   Connected using standard intents. For /set send-message, you can either enable "Message Content Intent"\n' +
          '   in Discord Developer Portal -> Bot -> Privileged Gateway Intents, or use the "Write Message" button.'
      );
    }
  } catch {
    // Proceed with standard intents if application flag check fails
  }

  const client = createConfiguredClient(intents);
  await client.login(token);
}

startBot().catch((err) => {
  console.error('❌ Failed to start bot:', err.message);
  process.exit(1);
});
