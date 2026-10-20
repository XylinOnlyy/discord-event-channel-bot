const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const { requireModLog } = require('../utils/modLogger');
const { getAllPresets, getLockSnapshot } = require('../utils/database');
const { buildPresetDashboardPayload } = require('../handlers/presetManager');

const PRESET_CHOICES = Array.from({ length: 9 }, (_, i) => ({
  name: `Preset ${i + 1}`,
  value: i + 1,
}));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('preset')
    .setDescription('View and manage your server channel presets (1 to 9)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Overview all 9 channel presets and their current lock status')
    )
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('Open the interactive configuration dashboard for a specific preset (1-9)')
        .addIntegerOption((opt) =>
          opt
            .setName('preset')
            .setDescription('Preset number (1 to 9)')
            .setRequired(true)
            .addChoices(...PRESET_CHOICES)
        )
    ),

  async execute(interaction) {
    if (!(await requireModLog(interaction))) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const presetNumber = interaction.options.getInteger('preset', true);
      return interaction.reply(buildPresetDashboardPayload(interaction.guild, presetNumber));
    }

    if (sub === 'list') {
      const presets = getAllPresets(interaction.guild.id);
      const fields = [];

      for (let i = 1; i <= 9; i++) {
        const p = presets[String(i)];
        const channels = p?.channels || [];
        const roles = p?.exceptRoles || [];

        if (channels.length === 0) {
          fields.push({
            name: `Preset #${i}`,
            value: '*Not configured*',
            inline: true,
          });
        } else {
          const lockedCount = channels.filter((id) =>
            Boolean(getLockSnapshot(interaction.guild.id, id))
          ).length;

          const statusTag =
            lockedCount === channels.length
              ? '🔒 Locked'
              : lockedCount > 0
              ? `🔐 Partial (${lockedCount}/${channels.length})`
              : '🔓 Unlocked';

          fields.push({
            name: `Preset #${i} [${statusTag}]`,
            value:
              `**Channels (${channels.length}):** ${channels.slice(0, 5).map((id) => `<#${id}>`).join(', ')}${channels.length > 5 ? ` +${channels.length - 5} more` : ''}\n` +
              `**Except Role:** ${roles.length > 0 ? roles.map((r) => `<@&${r}>`).join(', ') : 'None'}`,
            inline: true,
          });
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🗂️ Server Channel Presets (1–9) — ${interaction.guild.name}`)
        .setDescription(
          'Use `/set preset` or `/preset view` to configure channels and exception roles, and `/lock preset` or `/unlock preset` to toggle locks.'
        )
        .addFields(fields)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }
  },
};
