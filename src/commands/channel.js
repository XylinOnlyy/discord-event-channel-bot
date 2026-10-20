const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { requireModLog, logModAction } = require('../utils/modLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Additional channel management utilities (slowmode and bulk message purge)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub
        .setName('slowmode')
        .setDescription('Set or disable slowmode in a channel')
        .addIntegerOption((opt) =>
          opt
            .setName('seconds')
            .setDescription('Slowmode delay in seconds (0 to disable, up to 21600)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(21600)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Target channel (defaults to current channel)')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildForum,
              ChannelType.PublicThread,
              ChannelType.PrivateThread
            )
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('purge')
        .setDescription('Bulk delete recent messages in a channel (1 to 100)')
        .addIntegerOption((opt) =>
          opt
            .setName('amount')
            .setDescription('Number of messages to delete (1 to 100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Target channel (defaults to current channel)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!(await requireModLog(interaction))) return;

    const sub = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    if (sub === 'slowmode') {
      const seconds = interaction.options.getInteger('seconds', true);

      try {
        await channel.setRateLimitPerUser(
          seconds,
          `Slowmode updated by ${interaction.user.tag}`
        );

        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('⏱️ Channel Slowmode Updated')
          .setDescription(
            seconds === 0
              ? `Slowmode has been **disabled** in <#${channel.id}>.`
              : `Slowmode in <#${channel.id}> has been set to **${seconds} second(s)**.`
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        await logModAction(interaction.guild, {
          action: 'Channel Slowmode Updated',
          executor: interaction.user,
          color: 0x5865f2,
          fields: [
            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
            { name: 'Delay', value: seconds === 0 ? 'Disabled (0s)' : `${seconds}s`, inline: true },
          ],
        });
      } catch (err) {
        return interaction.reply({
          content: `❌ Failed to update slowmode: ${err.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (sub === 'purge') {
      const amount = interaction.options.getInteger('amount', true);

      try {
        const deleted = await channel.bulkDelete(amount, true);

        await interaction.reply({
          content: `🧹 Successfully deleted **${deleted.size}** message(s) in <#${channel.id}>.`,
          flags: MessageFlags.Ephemeral,
        });

        await logModAction(interaction.guild, {
          action: 'Channel Messages Purged',
          executor: interaction.user,
          color: 0xe67e22,
          fields: [
            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
            { name: 'Messages Deleted', value: `${deleted.size}`, inline: true },
          ],
        });
      } catch (err) {
        return interaction.reply({
          content: `❌ Failed to purge messages: ${err.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};
