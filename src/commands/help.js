const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('View all available server event, channel, preset, reminder, and moderation commands'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📖 Server Event, Channel & Reminder Bot — Command Reference')
      .setDescription(
        '> ⚠️ **Note:** Configure `/moderation logs` first. All administrative commands require an active Moderation Logs channel.'
      )
      .addFields(
        {
          name: '🛡️ Moderation Logs (Mandatory First Step)',
          value:
            '• `/moderation logs [channel]` — Set the audit log channel required to unlock all admin commands\n' +
            '• `/moderation status` — View current log status, active reminders, presets, and relays',
          inline: false,
        },
        {
          name: '📅 Server Events',
          value:
            '• `/check events` — View all live and upcoming server events with a dropdown selector for full event details\n' +
            '• `/event create` — Create a new Discord Scheduled Event directly\n' +
            '• `/event cancel [event_id]` — Cancel and remove a scheduled event',
          inline: false,
        },
        {
          name: '⏰ Reminder Messages & Monitoring',
          value:
            '• `/reminder message [message/link] [interval] [amount] [channel]` — Create a managed reminder with **Start**, **Start In** (auto-start form), **Edit**, and **Delete** controls, live progress monitoring (`Not Started`, `In Progress`, `Paused`, `Completed`), local completion time, and **Stop/Resume** & **Force Stop** controls\n' +
            '• `/reminder list` — View all active or scheduled reminders in the server',
          inline: false,
        },
        {
          name: '📡 Anti-Spam Send-Message Relay',
          value:
            '• `/set send-message [channel] [input_channel]` — Set up a channel so messages typed in it prompt for **Send Message** or **Delete** before being forwarded to the target channel, auto-delete after **3 minutes**, and keep a persistent **Stop** button at the bottom that purges the channel on exit',
          inline: false,
        },
        {
          name: '🗂️ Channel Presets (1–9) & Non-Destructive Lock / Unlock',
          value:
            '• `/set preset [1-9] [channels...] [except_role]` — Assign unlimited channels and exception roles to a preset\n' +
            '• `/preset list` & `/preset view [1-9]` — View or interactively edit presets\n' +
            '• `/lock preset [1-9]` & `/lock channel` — Lock channels while snapshotting and preserving all existing permissions\n' +
            '• `/unlock preset [1-9]` & `/unlock channel` — Unlock channels and restore exact pre-lock permissions',
          inline: false,
        },
        {
          name: '🔧 Channel Utilities',
          value:
            '• `/channel slowmode [seconds] [channel]` — Configure channel slowmode\n' +
            '• `/channel purge [amount] [channel]` — Bulk delete up to 100 messages',
          inline: false,
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
