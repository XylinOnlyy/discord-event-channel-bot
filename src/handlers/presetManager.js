const {
  EmbedBuilder,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  OverwriteType,
  MessageFlags,
} = require('discord.js');
const {
  getPreset,
  setPreset,
  deletePreset,
  getLockSnapshot,
  setLockSnapshot,
  removeLockSnapshot,
} = require('../utils/database');
const { requireModLog, logModAction } = require('../utils/modLogger');
const { toDiscordTimestamp } = require('../utils/time');

const LOCK_PERMS = [
  { key: 'SendMessages', flag: PermissionFlagsBits.SendMessages },
  { key: 'SendMessagesInThreads', flag: PermissionFlagsBits.SendMessagesInThreads },
  { key: 'CreatePublicThreads', flag: PermissionFlagsBits.CreatePublicThreads },
  { key: 'CreatePrivateThreads', flag: PermissionFlagsBits.CreatePrivateThreads },
];

function extractPermissionState(overwrite) {
  const state = {};
  for (const { key, flag } of LOCK_PERMS) {
    if (!overwrite) {
      state[key] = null;
    } else if (overwrite.allow.has(flag)) {
      state[key] = true;
    } else if (overwrite.deny.has(flag)) {
      state[key] = false;
    } else {
      state[key] = null;
    }
  }
  return state;
}

async function lockChannelNonDestructive(channel, exceptRoleIds = [], executorTag = 'Admin', presetNumber = null) {
  const guild = channel.guild;
  const everyoneId = guild.roles.everyone.id;
  const exceptSet = new Set(exceptRoleIds);

  const existingSnapshot = getLockSnapshot(guild.id, channel.id);
  if (!existingSnapshot) {
    const trackedIds = new Set([everyoneId, ...exceptRoleIds]);

    for (const [id, overwrite] of channel.permissionOverwrites.cache.entries()) {
      if (overwrite.type === OverwriteType.Role) {
        const hasRelevantBit = LOCK_PERMS.some(
          ({ flag }) => overwrite.allow.has(flag) || overwrite.deny.has(flag)
        );
        if (hasRelevantBit) {
          trackedIds.add(id);
        }
      }
    }

    const overwritesRecord = [];
    for (const id of trackedIds) {
      const currentOw = channel.permissionOverwrites.cache.get(id);
      overwritesRecord.push({
        id,
        existed: Boolean(currentOw),
        state: extractPermissionState(currentOw),
      });
    }

    setLockSnapshot(guild.id, channel.id, {
      lockedAt: Date.now(),
      lockedBy: executorTag,
      presetNumber,
      exceptRoles: Array.from(exceptSet),
      overwrites: overwritesRecord,
    });
  }

  const reason = `Channel locked${presetNumber ? ` (Preset ${presetNumber})` : ''} by ${executorTag}`;

  await channel.permissionOverwrites.edit(
    everyoneId,
    {
      SendMessages: false,
      SendMessagesInThreads: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
    },
    { reason }
  );

  for (const [id, overwrite] of channel.permissionOverwrites.cache.entries()) {
    if (id === everyoneId || exceptSet.has(id)) continue;
    if (overwrite.type !== OverwriteType.Role) continue;

    const role = guild.roles.cache.get(id);
    if (role?.managed) continue;

    if (
      overwrite.allow.has(PermissionFlagsBits.SendMessages) ||
      overwrite.allow.has(PermissionFlagsBits.SendMessagesInThreads)
    ) {
      await channel.permissionOverwrites.edit(
        id,
        {
          SendMessages: false,
          SendMessagesInThreads: false,
        },
        { reason }
      );
    }
  }

  for (const roleId of exceptSet) {
    if (roleId === everyoneId) continue;
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;

    await channel.permissionOverwrites.edit(
      roleId,
      {
        SendMessages: true,
        SendMessagesInThreads: true,
      },
      { reason }
    );
  }
}

async function unlockChannelNonDestructive(channel, exceptRoleIds = [], executorTag = 'Admin', presetNumber = null) {
  const guild = channel.guild;
  const everyoneId = guild.roles.everyone.id;
  const snapshot = getLockSnapshot(guild.id, channel.id);
  const reason = `Channel unlocked${presetNumber ? ` (Preset ${presetNumber})` : ''} by ${executorTag}`;

  if (snapshot && Array.isArray(snapshot.overwrites)) {
    for (const entry of snapshot.overwrites) {
      const targetExists =
        entry.id === everyoneId ||
        guild.roles.cache.has(entry.id) ||
        (await guild.roles.fetch(entry.id).catch(() => null));

      if (!targetExists) continue;

      await channel.permissionOverwrites.edit(entry.id, entry.state, { reason }).catch(() => {});

      if (!entry.existed && entry.id !== everyoneId) {
        const updatedOw = channel.permissionOverwrites.cache.get(entry.id);
        if (updatedOw && updatedOw.allow.bitfield === 0n && updatedOw.deny.bitfield === 0n) {
          await channel.permissionOverwrites.delete(entry.id, reason).catch(() => {});
        }
      }
    }

    removeLockSnapshot(guild.id, channel.id);
    return;
  }

  await channel.permissionOverwrites.edit(
    everyoneId,
    {
      SendMessages: null,
      SendMessagesInThreads: null,
      CreatePublicThreads: null,
      CreatePrivateThreads: null,
    },
    { reason }
  );

  for (const roleId of exceptRoleIds) {
    if (roleId === everyoneId) continue;
    const currentOw = channel.permissionOverwrites.cache.get(roleId);
    if (!currentOw) continue;

    await channel.permissionOverwrites.edit(
      roleId,
      {
        SendMessages: null,
        SendMessagesInThreads: null,
      },
      { reason }
    ).catch(() => {});
  }
}

function buildPresetDashboardPayload(guild, presetNumber) {
  const preset = getPreset(guild.id, presetNumber);
  const channels = preset?.channels || [];
  const exceptRoles = preset?.exceptRoles || [];

  const channelLines =
    channels.length > 0
      ? channels.map((id, i) => {
          const isLocked = Boolean(getLockSnapshot(guild.id, id));
          const statusIcon = isLocked ? '🔒' : '🔓';
          return `${i + 1}. ${statusIcon} <#${id}> (\`${id}\`)`;
        }).join('\n')
      : '*No channels assigned yet. Select channels below or pass them in `/set preset`.*';

  const roleLines =
    exceptRoles.length > 0
      ? exceptRoles.map((id) => `<@&${id}>`).join(', ')
      : '*None (All non-admin members will be restricted when locked)*';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🗂️ Channel Preset #${presetNumber}`)
    .setDescription(
      'Use the dropdown menus below to add or update channels and exception roles for this preset at any time.'
    )
    .addFields(
      {
        name: `Assigned Channels (${channels.length})`,
        value: channelLines.slice(0, 1024),
        inline: false,
      },
      {
        name: `Exception Roles (${exceptRoles.length})`,
        value: roleLines.slice(0, 1024),
        inline: false,
      },
      ...(preset?.updatedAt
        ? [
            {
              name: 'Last Updated',
              value: `${toDiscordTimestamp(preset.updatedAt, 'F')} by <@${preset.updatedBy}>`,
              inline: false,
            },
          ]
        : [])
    )
    .setFooter({
      text: `Lock/Unlock via /lock preset ${presetNumber} or /unlock preset ${presetNumber}`,
    })
    .setTimestamp();

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`preset_add_channels:${presetNumber}`)
    .setPlaceholder('➕ Add channels to this preset (Select up to 25)...')
    .setChannelTypes(
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.GuildForum,
      ChannelType.GuildVoice,
      ChannelType.GuildStageVoice
    )
    .setMinValues(1)
    .setMaxValues(25);

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`preset_set_roles:${presetNumber}`)
    .setPlaceholder('🛡️ Set exception role(s) allowed to chat while locked...')
    .setMinValues(1)
    .setMaxValues(10);

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`preset_lock:${presetNumber}`)
      .setLabel(`Lock Preset #${presetNumber}`)
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(channels.length === 0),
    new ButtonBuilder()
      .setCustomId(`preset_unlock:${presetNumber}`)
      .setLabel(`Unlock Preset #${presetNumber}`)
      .setEmoji('🔓')
      .setStyle(ButtonStyle.Success)
      .setDisabled(channels.length === 0),
    new ButtonBuilder()
      .setCustomId(`preset_clear_channels:${presetNumber}`)
      .setLabel('Clear Channels')
      .setEmoji('🧹')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(channels.length === 0),
    new ButtonBuilder()
      .setCustomId(`preset_delete:${presetNumber}`)
      .setLabel('Delete Preset')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!preset)
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(channelSelect),
      new ActionRowBuilder().addComponents(roleSelect),
      buttonRow,
    ],
  };
}

async function executePresetLockOrUnlock(interaction, presetNumber, isLock, reason = null) {
  const preset = getPreset(interaction.guild.id, presetNumber);
  if (!preset || !preset.channels || preset.channels.length === 0) {
    return interaction.reply({
      content: `❌ **Preset #${presetNumber}** has no channels configured. Set it first using \`/set preset preset:${presetNumber}\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  const succeeded = [];
  const failed = [];

  for (const channelId of preset.channels) {
    const channel =
      interaction.guild.channels.cache.get(channelId) ||
      (await interaction.guild.channels.fetch(channelId).catch(() => null));

    if (!channel) {
      failed.push(`<#${channelId}> (\`${channelId}\` — Channel not found)`);
      continue;
    }

    try {
      if (isLock) {
        await lockChannelNonDestructive(
          channel,
          preset.exceptRoles || [],
          interaction.user.tag,
          presetNumber
        );
      } else {
        await unlockChannelNonDestructive(
          channel,
          preset.exceptRoles || [],
          interaction.user.tag,
          presetNumber
        );
      }
      succeeded.push(`<#${channel.id}>`);
    } catch (err) {
      failed.push(`<#${channel.id}> (${err.message})`);
    }
  }

  const exceptRolesText =
    preset.exceptRoles && preset.exceptRoles.length > 0
      ? preset.exceptRoles.map((r) => `<@&${r}>`).join(', ')
      : 'None';

  const embed = new EmbedBuilder()
    .setColor(isLock ? 0xed4245 : 0x57f287)
    .setTitle(
      isLock
        ? `🔒 Locked Channels — Preset #${presetNumber}`
        : `🔓 Unlocked Channels — Preset #${presetNumber}`
    )
    .setDescription(
      isLock
        ? `Members can no longer send messages in the Preset #${presetNumber} channels. Existing channel permissions have been safely snapshotted and preserved.`
        : `Channels in Preset #${presetNumber} have been unlocked and restored to their exact pre-lock permissions.`
    )
    .addFields(
      {
        name: `${isLock ? 'Locked' : 'Unlocked'} Channels (${succeeded.length})`,
        value: succeeded.length > 0 ? succeeded.join(', ').slice(0, 1024) : 'None',
        inline: false,
      },
      {
        name: 'Exempted Roles',
        value: exceptRolesText,
        inline: true,
      },
      {
        name: 'Executed By',
        value: `<@${interaction.user.id}>`,
        inline: true,
      }
    )
    .setTimestamp();

  if (reason) {
    embed.addFields({ name: 'Reason', value: reason, inline: false });
  }

  if (failed.length > 0) {
    embed.addFields({
      name: `⚠️ Failed / Skipped (${failed.length})`,
      value: failed.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });

  await logModAction(interaction.guild, {
    action: isLock ? `Preset #${presetNumber} Locked` : `Preset #${presetNumber} Unlocked`,
    executor: interaction.user,
    color: isLock ? 0xed4245 : 0x57f287,
    fields: [
      { name: 'Preset', value: `Preset #${presetNumber}`, inline: true },
      { name: 'Exempted Roles', value: exceptRolesText, inline: true },
      {
        name: `Affected Channels (${succeeded.length})`,
        value: succeeded.length > 0 ? succeeded.join(', ').slice(0, 1024) : 'None',
        inline: false,
      },
      ...(reason ? [{ name: 'Reason', value: reason, inline: false }] : []),
    ],
  });
}

async function handlePresetInteraction(interaction) {
  if (!interaction.customId.startsWith('preset_')) return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({
      content: '❌ You need the **Manage Channels** permission to configure or lock/unlock presets.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!(await requireModLog(interaction))) return;

  const [action, rawNum] = interaction.customId.split(':');
  const presetNumber = parseInt(rawNum, 10);

  if (interaction.isChannelSelectMenu() && action === 'preset_add_channels') {
    const existing = getPreset(interaction.guild.id, presetNumber);
    const mergedChannels = Array.from(
      new Set([...(existing?.channels || []), ...interaction.values])
    );
    const exceptRoles = existing?.exceptRoles || [];

    setPreset(interaction.guild.id, presetNumber, {
      channels: mergedChannels,
      exceptRoles,
      updatedBy: interaction.user.id,
    });

    await interaction.update(buildPresetDashboardPayload(interaction.guild, presetNumber));

    await logModAction(interaction.guild, {
      action: `Preset #${presetNumber} Channels Updated`,
      executor: interaction.user,
      color: 0x5865f2,
      fields: [
        {
          name: `Channels (${mergedChannels.length})`,
          value: mergedChannels.map((id) => `<#${id}>`).join(', ').slice(0, 1024),
          inline: false,
        },
      ],
    });
    return;
  }

  if (interaction.isRoleSelectMenu() && action === 'preset_set_roles') {
    const existing = getPreset(interaction.guild.id, presetNumber);
    const channels = existing?.channels || [];

    setPreset(interaction.guild.id, presetNumber, {
      channels,
      exceptRoles: interaction.values,
      updatedBy: interaction.user.id,
    });

    await interaction.update(buildPresetDashboardPayload(interaction.guild, presetNumber));

    await logModAction(interaction.guild, {
      action: `Preset #${presetNumber} Exception Roles Updated`,
      executor: interaction.user,
      color: 0x5865f2,
      fields: [
        {
          name: 'Exception Roles',
          value: interaction.values.map((id) => `<@&${id}>`).join(', ').slice(0, 1024),
          inline: false,
        },
      ],
    });
    return;
  }

  if (interaction.isButton()) {
    if (action === 'preset_clear_channels') {
      const existing = getPreset(interaction.guild.id, presetNumber);
      setPreset(interaction.guild.id, presetNumber, {
        channels: [],
        exceptRoles: existing?.exceptRoles || [],
        updatedBy: interaction.user.id,
      });

      await interaction.update(buildPresetDashboardPayload(interaction.guild, presetNumber));
      return;
    }

    if (action === 'preset_delete') {
      deletePreset(interaction.guild.id, presetNumber);
      await interaction.update(buildPresetDashboardPayload(interaction.guild, presetNumber));

      await logModAction(interaction.guild, {
        action: `Preset #${presetNumber} Deleted`,
        executor: interaction.user,
        color: 0xed4245,
        fields: [{ name: 'Preset', value: `Preset #${presetNumber}`, inline: true }],
      });
      return;
    }

    if (action === 'preset_lock') {
      return executePresetLockOrUnlock(interaction, presetNumber, true);
    }

    if (action === 'preset_unlock') {
      return executePresetLockOrUnlock(interaction, presetNumber, false);
    }
  }
}

module.exports = {
  lockChannelNonDestructive,
  unlockChannelNonDestructive,
  buildPresetDashboardPayload,
  executePresetLockOrUnlock,
  handlePresetInteraction,
};
