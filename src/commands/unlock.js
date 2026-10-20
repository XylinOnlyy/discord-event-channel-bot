const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { requireModLog, logModAction } = require('../utils/modLogger');
const {
  executePresetLockOrUnlock,
  unlockChannelNonDestructive,
} = require('../handlers/presetManager');

const PRESET_CHOICES = Array.from({ length: 9 }, (_, i) => ({
  name: `Preset ${i + 1}`,
  value: i + 1,
}));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock channels using a configured Preset (1-9) or unlock a single channel and restore permissions')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub
        .setName('preset')
        .setDescription('Unlock all channels in a preset and restore their exact pre-lock permissions')
        .addIntegerOption((opt) =>
          opt
            .setName('preset')
            .setDescription('Preset number (1 to 9) to unlock')
            .setRequired(true)
            .addChoices(...PRESET_CHOICES)
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Optional reason for unlocking the preset channels')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Unlock a single channel and restore its exact pre-lock permissions')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel to unlock (defaults to current channel)')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.GuildVoice
            )
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Optional reason for unlocking the channel')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!(await requireModLog(interaction))) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'preset') {
      const presetNumber = interaction.options.getInteger('preset', true);
      const reason = interaction.options.getString('reason');
      return executePresetLockOrUnlock(interaction, presetNumber, false, reason);
    }

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const reason = interaction.options.getString('reason');

      try {
        await unlockChannelNonDestructive(channel, [], interaction.user.tag, null);

        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle('🔓 Channel Unlocked')
          .setDescription(
            `<#${channel.id}> has been unlocked and restored to its exact pre-lock permissions.`
          )
          .addFields(
            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
            { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
            ...(reason ? [{ name: 'Reason', value: reason, inline: false }] : [])
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        await logModAction(interaction.guild, {
          action: 'Single Channel Unlocked',
          executor: interaction.user,
          color: 0x57f287,
          fields: [
            { name: 'Channel', value: `<#${channel.id}> (\`${channel.id}\`)`, inline: true },
            ...(reason ? [{ name: 'Reason', value: reason, inline: false }] : []),
          ],
        });
      } catch (err) {
        return interaction.reply({
          content: `❌ Failed to unlock <#${channel.id}>: ${err.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};
