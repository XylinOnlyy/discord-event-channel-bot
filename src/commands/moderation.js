const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const {
  setModLogChannel,
  getModLogChannel,
  getAllPresets,
  getGuildReminders,
  getGuildRelays,
} = require('../utils/database');
const { logModAction } = require('../utils/modLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moderation')
    .setDescription('Configure mandatory moderation logs and view server management status')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('logs')
        .setDescription('Set the mandatory moderation logs channel (Required before using admin commands)')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('The text channel where all command executions and admin actions will be logged')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('View current moderation log configuration and active bot systems')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'logs') {
      const channel = interaction.options.getChannel('channel', true);
      const botPerms = channel.permissionsFor(interaction.guild.members.me);

      if (
        !botPerms ||
        !botPerms.has(PermissionFlagsBits.ViewChannel) ||
        !botPerms.has(PermissionFlagsBits.SendMessages) ||
        !botPerms.has(PermissionFlagsBits.EmbedLinks)
      ) {
        return interaction.reply({
          content: `❌ I do not have permission to view, send messages, or embed links in <#${channel.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      setModLogChannel(interaction.guild.id, channel.id);

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Moderation Logs Configured')
        .setDescription(
          `<#${channel.id}> is now set as the **Moderation Logs** channel for **${interaction.guild.name}**.\n\n` +
            `All administrative commands (reminders, presets, channel locks, and send-message relays) are now unlocked and will be audited in <#${channel.id}>.`
        )
        .addFields(
          { name: 'Log Channel', value: `<#${channel.id}> (\`${channel.id}\`)`, inline: true },
          { name: 'Configured By', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      await logModAction(interaction.guild, {
        action: 'Moderation Logs Channel Configured',
        executor: interaction.user,
        color: 0x57f287,
        fields: [
          { name: 'Log Channel', value: `<#${channel.id}> (\`${channel.id}\`)`, inline: true },
        ],
      });
      return;
    }

    if (sub === 'status') {
      const logChannelId = getModLogChannel(interaction.guild.id);
      const presets = getAllPresets(interaction.guild.id);
      const reminders = getGuildReminders(interaction.guild.id);
      const relays = getGuildRelays(interaction.guild.id);

      const activeReminders = reminders.filter((r) =>
        ['not_started', 'scheduled', 'running', 'paused'].includes(r.status)
      );
      const configuredPresetCount = Object.values(presets).filter(
        (p) => p.channels && p.channels.length > 0
      ).length;

      const embed = new EmbedBuilder()
        .setColor(logChannelId ? 0x57f287 : 0xed4245)
        .setTitle(`⚙️ Server Management Status — ${interaction.guild.name}`)
        .addFields(
          {
            name: 'Moderation Logs (Mandatory)',
            value: logChannelId
              ? `✅ Active in <#${logChannelId}> (\`${logChannelId}\`)`
              : '❌ **Not Configured** — Run `/moderation logs` to unlock admin commands',
            inline: false,
          },
          {
            name: 'Configured Presets',
            value: `**${configuredPresetCount} / 9** active preset(s)`,
            inline: true,
          },
          {
            name: 'Active Reminders',
            value: `**${activeReminders.length}** session(s)`,
            inline: true,
          },
          {
            name: 'Send-Message Relays',
            value:
              relays.length > 0
                ? relays.map((r) => `<#${r.inputChannelId}> → <#${r.targetChannelId}>`).join('\n')
                : 'None active',
            inline: true,
          }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
