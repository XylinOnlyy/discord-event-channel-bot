const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const { requireModLog, logModAction } = require('../utils/modLogger');
const { getPreset, setPreset } = require('../utils/database');
const { promptEnableRelay } = require('../handlers/relayManager');
const { buildPresetDashboardPayload } = require('../handlers/presetManager');

const PRESET_CHOICES = Array.from({ length: 9 }, (_, i) => ({
  name: `Preset ${i + 1}`,
  value: i + 1,
}));

function extractChannelIdsFromText(guild, rawText) {
  if (!rawText) return [];
  const matches = rawText.match(/\d{17,20}/g) || [];
  return matches.filter((id) => guild.channels.cache.has(id));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set')
    .setDescription('Configure Send-Message Relay channels and Channel Lock Presets (1-9)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub
        .setName('send-message')
        .setDescription('Set this channel (or another channel) as an anti-spam message relay to a target channel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('The target destination channel (or Channel ID) where confirmed messages will be sent')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName('input_channel')
            .setDescription('The staging channel where you type messages (defaults to this current channel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('preset')
        .setDescription('Configure Preset 1 to 9 with any number of channels and an optional exception role')
        .addIntegerOption((opt) =>
          opt
            .setName('preset')
            .setDescription('Select Preset number (1 to 9)')
            .setRequired(true)
            .addChoices(...PRESET_CHOICES)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel_1')
            .setDescription('First channel to include in this preset')
            .setRequired(false)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel_2')
            .setDescription('Second channel to include in this preset')
            .setRequired(false)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel_3')
            .setDescription('Third channel to include in this preset')
            .setRequired(false)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel_4')
            .setDescription('Fourth channel to include in this preset')
            .setRequired(false)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel_5')
            .setDescription('Fifth channel to include in this preset')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('more_channels')
            .setDescription('Paste any number of #channel mentions or channel IDs (unlimited)')
            .setRequired(false)
        )
        .addRoleOption((opt) =>
          opt
            .setName('except_role')
            .setDescription('Role exempted from channel lock (can still chat when preset is locked)')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!(await requireModLog(interaction))) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'send-message') {
      const targetChannel = interaction.options.getChannel('channel', true);
      const inputChannel = interaction.options.getChannel('input_channel') || interaction.channel;

      const inputPerms = inputChannel.permissionsFor(interaction.guild.members.me);
      const targetPerms = targetChannel.permissionsFor(interaction.guild.members.me);

      if (
        !inputPerms?.has(PermissionFlagsBits.ViewChannel) ||
        !inputPerms?.has(PermissionFlagsBits.SendMessages) ||
        !inputPerms?.has(PermissionFlagsBits.ManageMessages)
      ) {
        return interaction.reply({
          content: `❌ I need **View Channel**, **Send Messages**, and **Manage Messages** permissions in <#${inputChannel.id}> to manage and purge messages.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (
        !targetPerms?.has(PermissionFlagsBits.ViewChannel) ||
        !targetPerms?.has(PermissionFlagsBits.SendMessages)
      ) {
        return interaction.reply({
          content: `❌ I need **View Channel** and **Send Messages** permissions in the target channel <#${targetChannel.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      return promptEnableRelay(interaction, targetChannel, inputChannel);
    }

    if (sub === 'preset') {
      const presetNumber = interaction.options.getInteger('preset', true);
      const exceptRole = interaction.options.getRole('except_role');
      const moreChannelsRaw = interaction.options.getString('more_channels');

      const pickedChannels = [];
      for (let i = 1; i <= 5; i++) {
        const ch = interaction.options.getChannel(`channel_${i}`);
        if (ch && ch.type !== ChannelType.GuildCategory) {
          pickedChannels.push(ch.id);
        }
      }

      const parsedMore = extractChannelIdsFromText(interaction.guild, moreChannelsRaw);
      const combinedNewChannels = Array.from(new Set([...pickedChannels, ...parsedMore]));

      const existing = getPreset(interaction.guild.id, presetNumber);

      if (combinedNewChannels.length > 0 || exceptRole) {
        const finalChannels =
          combinedNewChannels.length > 0
            ? combinedNewChannels
            : existing?.channels || [];

        const finalRoles = exceptRole
          ? [exceptRole.id]
          : existing?.exceptRoles || [];

        setPreset(interaction.guild.id, presetNumber, {
          channels: finalChannels,
          exceptRoles: finalRoles,
          updatedBy: interaction.user.id,
        });

        await logModAction(interaction.guild, {
          action: `Preset #${presetNumber} Configured`,
          executor: interaction.user,
          color: 0x5865f2,
          fields: [
            { name: 'Preset', value: `Preset #${presetNumber}`, inline: true },
            {
              name: 'Exception Role(s)',
              value: finalRoles.length > 0 ? finalRoles.map((id) => `<@&${id}>`).join(', ') : 'None',
              inline: true,
            },
            {
              name: `Channels (${finalChannels.length})`,
              value:
                finalChannels.length > 0
                  ? finalChannels.map((id) => `<#${id}>`).join(', ').slice(0, 1024)
                  : 'None',
              inline: false,
            },
          ],
        });
      }

      const payload = buildPresetDashboardPayload(interaction.guild, presetNumber);
      return interaction.reply(payload);
    }
  },
};
