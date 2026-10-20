const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { requireModLog } = require('../utils/modLogger');
const { parseDuration, formatDuration, toDiscordTimestamp } = require('../utils/time');
const { getGuildReminders } = require('../utils/database');
const { createReminderSession } = require('../handlers/reminderManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('Schedule and monitor automated channel reminder messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) =>
      sub
        .setName('message')
        .setDescription('Create a controlled reminder message with Start / Start In / Stop / Force Stop monitoring')
        .addStringOption((opt) =>
          opt
            .setName('message')
            .setDescription('Message text to send OR a Discord message link from this server')
            .setRequired(true)
            .setMaxLength(2000)
        )
        .addStringOption((opt) =>
          opt
            .setName('interval')
            .setDescription('Interval between each message (e.g. 30s, 5m, 1h, or 10 for 10 minutes)')
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('amount')
            .setDescription('Total number of times the reminder message will be sent')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(500)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Target channel (or paste Channel ID) where the reminder will be sent')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread
            )
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('View all active, scheduled, and paused reminders in this server')
    ),

  async execute(interaction) {
    if (!(await requireModLog(interaction))) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'message') {
      const rawMessage = interaction.options.getString('message', true);
      const intervalStr = interaction.options.getString('interval', true);
      const amount = interaction.options.getInteger('amount', true);
      const targetChannel = interaction.options.getChannel('channel', true);

      const intervalMs = parseDuration(intervalStr, 60_000);
      if (!intervalMs || intervalMs < 5_000 || intervalMs > 30 * 86_400_000) {
        return interaction.reply({
          content:
            '❌ Invalid `interval`. Please provide a valid duration between `5s` and `30d` (e.g. `30s`, `5m`, `1h`, or `15` for 15 minutes).',
          flags: MessageFlags.Ephemeral,
        });
      }

      const botPerms = targetChannel.permissionsFor(interaction.guild.members.me);
      if (
        !botPerms ||
        !botPerms.has(PermissionFlagsBits.ViewChannel) ||
        !botPerms.has(PermissionFlagsBits.SendMessages)
      ) {
        return interaction.reply({
          content: `❌ I do not have permission to view and send messages in <#${targetChannel.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      try {
        await createReminderSession(interaction, {
          rawMessage,
          intervalMs,
          amount,
          targetChannel,
        });
      } catch (err) {
        return interaction.reply({
          content: `❌ Could not create reminder: ${err.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (sub === 'list') {
      const reminders = getGuildReminders(interaction.guild.id).filter((r) =>
        ['not_started', 'scheduled', 'running', 'paused'].includes(r.status)
      );

      if (reminders.length === 0) {
        return interaction.reply({
          content: '📭 There are currently no active, scheduled, or pending reminders in this server.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const lines = reminders.slice(0, 15).map((r) => {
        const panelLink =
          r.controlChannelId && r.controlMessageId
            ? `[Control Panel](https://discord.com/channels/${r.guildId}/${r.controlChannelId}/${r.controlMessageId})`
            : `<#${r.controlChannelId}>`;
        const endInfo = r.estimatedEndAt ? ` • Ends ${toDiscordTimestamp(r.estimatedEndAt, 'R')}` : '';
        return (
          `• **#${r.id}** [${r.status.toUpperCase()}] → <#${r.targetChannelId}>\n` +
          `  ┗ \`${r.sentCount}/${r.totalAmount}\` every **${formatDuration(r.intervalMs)}** • By <@${r.userId}>${endInfo} • ${panelLink}`
        );
      });

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`⏰ Active Server Reminders (${reminders.length})`)
        .setDescription(lines.join('\n\n'))
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
