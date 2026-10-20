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
  lockChannelNonDestructive,
} = require('../handlers/presetManager');

const PRESET_CHOICES = Array.from({ length: 9 }, (_, i) => ({
  name: `Preset ${i + 1}`,
  value: i + 1,
}));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock channels using a configured Preset (1-9) or lock a single channel without breaking permissions')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub
        .setName('preset')
        .setDescription('Lock all channels in a preset without altering existing permission structures')
        .addIntegerOption((opt) =>
          opt
            .setName('preset')
            .setDescription('Preset number (1 to 9) to lock')
            .setRequired(true)
            .addChoices(...PRESET_CHOICES)
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Optional reason for locking the preset channels')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Lock a single channel without altering existing permission structures')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel to lock (defaults to current channel)')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.GuildVoice
            )
            .setRequired(false)
        )
        .addRoleOption((opt) =>
          opt
            .setName('except_role')
            .setDescription('Optional role exempted from this lock')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Optional reason for locking the channel')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!(await requireModLog(interaction))) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'preset') {
      const presetNumber = interaction.options.getInteger('preset', true);
      const reason = interaction.options.getString('reason');
      return executePresetLockOrUnlock(interaction, presetNumber, true, reason);
    }

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const exceptRole = interaction.options.getRole('except_role');
      const reason = interaction.options.getString('reason');
      const exceptRoles = exceptRole ? [exceptRole.id] : [];

      try {
        await lockChannelNonDestructive(channel, exceptRoles, interaction.user.tag, null);

        const embed = new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle('🔒 Channel Locked')
          .setDescription(
            `<#${channel.id}> has been locked. Existing permissions were snapshotted and will be restored upon unlocking.`
          )
          .addFields(
            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
            {
              name: 'Exempted Role',
              value: exceptRole ? `<@&${exceptRole.id}>` : 'None',
              inline: true,
            },
            { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
            ...(reason ? [{ name: 'Reason', value: reason, inline: false }] : [])
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        await logModAction(interaction.guild, {
          action: 'Single Channel Locked',
          executor: interaction.user,
          color: 0xed4245,
          fields: [
            { name: 'Channel', value: `<#${channel.id}> (\`${channel.id}\`)`, inline: true },
            {
              name: 'Exempted Role',
              value: exceptRole ? `<@&${exceptRole.id}>` : 'None',
              inline: true,
            },
            ...(reason ? [{ name: 'Reason', value: reason, inline: false }] : []),
          ],
        });
      } catch (err) {
        return interaction.reply({
          content: `❌ Failed to lock <#${channel.id}>: ${err.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};
