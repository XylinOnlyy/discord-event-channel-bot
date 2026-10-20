require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  console.error('❌ Please set both DISCORD_TOKEN and CLIENT_ID in your .env file.');
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
  }
}

const rest = new REST().setToken(token);

(async () => {
  try {
    console.log(`🔄 Deploying ${commands.length} application (/) commands...`);
    const trimmedGuildId = guildId?.trim() || '';

    if (/^\d{17,20}$/.test(trimmedGuildId)) {
      await rest.put(Routes.applicationGuildCommands(clientId.trim(), trimmedGuildId), {
        body: commands,
      });
      console.log(`✅ Successfully deployed ${commands.length} guild commands to ${trimmedGuildId}.`);
    } else {
      await rest.put(Routes.applicationCommands(clientId.trim()), {
        body: commands,
      });
      console.log(`✅ Successfully deployed ${commands.length} global commands.`);
    }
  } catch (error) {
    console.error('❌ Command deployment failed:', error);
    process.exit(1);
  }
})();
