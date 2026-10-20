const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { getRelay, setRelay, removeRelay } = require('../utils/database');
const { requireModLog, logModAction } = require('../utils/modLogger');
const { toDiscordTimestamp } = require('../utils/time');

const AUTO_DELETE_MS = 3 * 60 * 1000;

const pendingDrafts = new Map();

async function purgeAllChannelMessages(channel, excludeMessageId = null) {
  try {
    let fetched;
    let safetyCounter = 0;

    do {
      safetyCounter++;
      fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!fetched || fetched.size === 0) break;

      const toDelete = excludeMessageId
        ? fetched.filter((m) => m.id !== excludeMessageId)
        : fetched;

      if (toDelete.size === 0) break;

      const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000 + 60_000;
      const bulkable = toDelete.filter((m) => m.createdTimestamp > twoWeeksAgo);
      const older = toDelete.filter((m) => m.createdTimestamp <= twoWeeksAgo);

      if (bulkable.size > 0) {
        await channel.bulkDelete(bulkable, true).catch(() => {});
      }

      for (const [, oldMsg] of older) {
        await oldMsg.delete().catch(() => {});
      }

      if (fetched.size < 100) break;
    } while (safetyCounter < 5);
  } catch (err) {
    console.error('[RelayManager] Error while purging channel messages:', err.message);
  }
}

function buildStickyFooterPayload(relay) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('📡 Send-Message Relay Controller')
    .setDescription(
      `Messages sent in <#${relay.inputChannelId}> (or composed via the **Write Message** button below) will be staged for delivery to <#${relay.targetChannelId}>.\n\n` +
        `• **Anti-Spam Protection**: Every message requires confirmation (**Send Message** or **Delete**) before being sent.\n` +
        `• **Auto-Delete**: Drafts and confirmation prompts automatically delete after **3 minutes**.\n` +
        `• **Stop Session**: Click **Stop & Clear Channel** below when finished to deactivate this mode and delete all messages in this channel.`
    )
    .addFields(
      {
        name: 'Target Destination',
        value: `<#${relay.targetChannelId}> (\`${relay.targetChannelId}\`)`,
        inline: true,
      },
      {
        name: 'Configured By',
        value: `<@${relay.configuredBy}>`,
        inline: true,
      }
    )
    .setFooter({ text: 'This control panel automatically stays at the bottom of the channel.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`relay_compose:${relay.inputChannelId}`)
      .setLabel('Write Message')
      .setEmoji('✍️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`relay_stop:${relay.inputChannelId}`)
      .setLabel('Stop & Clear Channel')
      .setEmoji('🛑')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

async function refreshStickyBottomMessage(channel, relay) {
  try {
    if (relay.stickyMessageId) {
      const prevSticky = await channel.messages.fetch(relay.stickyMessageId).catch(() => null);
      if (prevSticky) {
        await prevSticky.delete().catch(() => {});
      }
    }

    const newSticky = await channel.send(buildStickyFooterPayload(relay));
    relay.stickyMessageId = newSticky.id;
    setRelay(channel.id, relay);
  } catch (err) {
    console.error('[RelayManager] Failed to refresh sticky footer:', err.message);
  }
}

function clearChannelDrafts(inputChannelId) {
  for (const [draftId, draft] of pendingDrafts.entries()) {
    if (draft.inputChannelId === inputChannelId) {
      if (draft.timer) clearTimeout(draft.timer);
      pendingDrafts.delete(draftId);
    }
  }
}

async function promptEnableRelay(interaction, targetChannel, inputChannel) {
  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('⚠️ Confirm Send-Message Relay Setup')
    .setDescription(
      `You are about to configure <#${inputChannel.id}> as a **Send-Message Relay Channel** pointing to <#${targetChannel.id}>.\n\n` +
        `> 🚨 **IMPORTANT WARNING**\n` +
        `> • **All existing messages in <#${inputChannel.id}> will be permanently deleted** upon confirmation.\n` +
        `> • **It is strongly NOT recommended to use this in an active or crowded channel.**\n` +
        `> • Every message in <#${inputChannel.id}> will prompt for **Send Message** or **Delete** confirmation and **auto-delete after 3 minutes**.\n` +
        `> • A **Stop** button will remain at the very bottom of <#${inputChannel.id}>. Pressing **Stop** will end the mode and **delete all messages in <#${inputChannel.id}>**.`
    )
    .addFields(
      {
        name: 'Input Channel (Will Be Cleared)',
        value: `<#${inputChannel.id}> (\`${inputChannel.id}\`)`,
        inline: true,
      },
      {
        name: 'Target Destination Channel',
        value: `<#${targetChannel.id}> (\`${targetChannel.id}\`)`,
        inline: true,
      }
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`relay_init_confirm:${inputChannel.id}:${targetChannel.id}:${interaction.user.id}`)
      .setLabel('Confirm & Clear Channel')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`relay_init_cancel:${interaction.user.id}`)
      .setLabel('Cancel')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({ embeds: [embed], components: [row] });
}

function buildDraftConfirmationPayload(draft) {
  const previewText = draft.content
    ? draft.content.length > 1000
      ? `${draft.content.slice(0, 997)}...`
      : draft.content
    : draft.attachmentUrls.length > 0
    ? '*(Attachment only)*'
    : '⚠️ *(Message text hidden because **Message Content Intent** is disabled in Discord Developer Portal — click **Edit Text** below or enable Message Content Intent)*';

  const confirmEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📨 Confirm Message Delivery')
    .setDescription(
      `Would you like the bot to send your message to <#${draft.targetChannelId}>?\n\n` +
        `**Message Preview:**\n>>> ${previewText}`
    )
    .addFields(
      {
        name: 'Author',
        value: `<@${draft.authorId}>`,
        inline: true,
      },
      {
        name: 'Destination',
        value: `<#${draft.targetChannelId}>`,
        inline: true,
      },
      {
        name: 'Auto-Delete Timer (3m)',
        value: `Deletes ${toDiscordTimestamp(draft.expiresAt, 'R')}`,
        inline: true,
      }
    )
    .setTimestamp();

  if (draft.attachmentUrls.length > 0) {
    confirmEmbed.addFields({
      name: 'Attachments',
      value: `${draft.attachmentUrls.length} file(s) attached`,
      inline: false,
    });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`relay_msg_send:${draft.draftId}`)
      .setLabel('Send Message')
      .setEmoji('📤')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!draft.content && draft.attachmentUrls.length === 0),
    new ButtonBuilder()
      .setCustomId(`relay_msg_edit:${draft.draftId}`)
      .setLabel('Edit Text')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`relay_msg_delete:${draft.draftId}`)
      .setLabel('Delete')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
  );

  return {
    content: `<@${draft.authorId}>`,
    embeds: [confirmEmbed],
    components: [row],
  };
}

async function handleRelayMessageCreate(message) {
  if (!message.guild || message.author.bot) return;

  const relay = getRelay(message.channel.id);
  if (!relay) return;

  const expiresAt = Date.now() + AUTO_DELETE_MS;
  const attachmentUrls = Array.from(message.attachments.values()).map((a) => a.url);
  const contentText = (message.content || '').replace(new RegExp(`^<@!?${message.client.user.id}>\\s*`), '');

  const draft = {
    draftId: message.id,
    userMessageId: message.id,
    confirmMessageId: null,
    inputChannelId: message.channel.id,
    targetChannelId: relay.targetChannelId,
    authorId: message.author.id,
    content: contentText,
    attachmentUrls,
    expiresAt,
    sent: false,
    timer: null,
  };

  const confirmMsg = await message.channel.send(buildDraftConfirmationPayload(draft));
  draft.confirmMessageId = confirmMsg.id;

  await refreshStickyBottomMessage(message.channel, relay);

  draft.timer = setTimeout(async () => {
    pendingDrafts.delete(draft.draftId);
    await message.delete().catch(() => {});
    await confirmMsg.delete().catch(() => {});
  }, AUTO_DELETE_MS);

  pendingDrafts.set(draft.draftId, draft);
}

async function handleRelayInteraction(interaction) {
  if (interaction.isModalSubmit() && interaction.customId.startsWith('relay_modal_')) {
    const [, mode, targetId] = interaction.customId.split(':');
    const text = interaction.fields.getTextInputValue('message_content').trim();

    if (mode === 'compose') {
      const relay = getRelay(targetId);
      if (!relay) {
        return interaction.reply({
          content: '❌ Send-Message Relay Mode is no longer active in this channel.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const expiresAt = Date.now() + AUTO_DELETE_MS;
      const draftId = `modal_${Date.now()}`;
      const draft = {
        draftId,
        userMessageId: null,
        confirmMessageId: null,
        inputChannelId: interaction.channel.id,
        targetChannelId: relay.targetChannelId,
        authorId: interaction.user.id,
        content: text,
        attachmentUrls: [],
        expiresAt,
        sent: false,
        timer: null,
      };

      const confirmMsg = await interaction.reply({
        ...buildDraftConfirmationPayload(draft),
        fetchReply: true,
      });
      draft.confirmMessageId = confirmMsg.id;

      await refreshStickyBottomMessage(interaction.channel, relay);

      draft.timer = setTimeout(async () => {
        pendingDrafts.delete(draftId);
        await confirmMsg.delete().catch(() => {});
      }, AUTO_DELETE_MS);

      pendingDrafts.set(draftId, draft);
      return;
    }

    if (mode === 'edit') {
      const draft = pendingDrafts.get(targetId);
      if (!draft) {
        return interaction.reply({
          content: '⚠️ This draft has already expired.',
          flags: MessageFlags.Ephemeral,
        });
      }

      draft.content = text;
      return interaction.update(buildDraftConfirmationPayload(draft));
    }
  }

  if (!interaction.isButton() || !interaction.customId.startsWith('relay_')) return;

  const parts = interaction.customId.split(':');
  const action = parts[0];

  if (action === 'relay_compose') {
    const inputChannelId = parts[1];
    const modal = new ModalBuilder()
      .setCustomId(`relay_modal_:compose:${inputChannelId}`)
      .setTitle('Compose Relay Message');

    const input = new TextInputBuilder()
      .setCustomId('message_content')
      .setLabel('Message to send to target channel')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Type your message here...')
      .setRequired(true)
      .setMaxLength(2000);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (action === 'relay_msg_edit') {
    const draftId = parts[1];
    const draft = pendingDrafts.get(draftId);
    if (!draft) {
      return interaction.reply({
        content: '⚠️ This draft has already expired.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (
      interaction.user.id !== draft.authorId &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)
    ) {
      return interaction.reply({
        content: `❌ Only <@${draft.authorId}> can edit this draft.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`relay_modal_:edit:${draftId}`)
      .setTitle('Edit Relay Message');

    const input = new TextInputBuilder()
      .setCustomId('message_content')
      .setLabel('Message Content')
      .setStyle(TextInputStyle.Paragraph)
      .setValue((draft.content || '').slice(0, 2000))
      .setRequired(true)
      .setMaxLength(2000);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (action === 'relay_init_cancel') {
    const allowedUserId = parts[1];
    if (interaction.user.id !== allowedUserId && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        content: '❌ Only the command executor can cancel this prompt.',
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.update({
      content: '✖️ Send-Message Relay setup has been cancelled. No messages were deleted.',
      embeds: [],
      components: [],
    });
  }

  if (action === 'relay_init_confirm') {
    const [, inputChannelId, targetChannelId, allowedUserId] = parts;
    if (interaction.user.id !== allowedUserId && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        content: '❌ Only the command executor or a channel manager can confirm this setup.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!(await requireModLog(interaction))) return;

    const inputChannel =
      interaction.guild.channels.cache.get(inputChannelId) ||
      (await interaction.guild.channels.fetch(inputChannelId).catch(() => null));
    const targetChannel =
      interaction.guild.channels.cache.get(targetChannelId) ||
      (await interaction.guild.channels.fetch(targetChannelId).catch(() => null));

    if (!inputChannel || !targetChannel) {
      return interaction.update({
        content: '❌ Either the input channel or target channel no longer exists.',
        embeds: [],
        components: [],
      });
    }

    await interaction.update({
      content: `🧹 Clearing all messages in <#${inputChannel.id}> and activating Send-Message Relay Mode...`,
      embeds: [],
      components: [],
    });

    clearChannelDrafts(inputChannel.id);
    await purgeAllChannelMessages(inputChannel);

    const relayData = {
      guildId: interaction.guild.id,
      inputChannelId: inputChannel.id,
      targetChannelId: targetChannel.id,
      stickyMessageId: null,
      configuredBy: interaction.user.id,
      createdAt: Date.now(),
    };

    const stickyMsg = await inputChannel.send(buildStickyFooterPayload(relayData));
    relayData.stickyMessageId = stickyMsg.id;
    setRelay(inputChannel.id, relayData);

    await logModAction(interaction.guild, {
      action: 'Send-Message Relay Mode Enabled & Channel Purged',
      executor: interaction.user,
      color: 0x57f287,
      fields: [
        { name: 'Input Channel', value: `<#${inputChannel.id}> (\`${inputChannel.id}\`)`, inline: true },
        { name: 'Target Channel', value: `<#${targetChannel.id}> (\`${targetChannel.id}\`)`, inline: true },
      ],
    });
    return;
  }

  if (action === 'relay_msg_send') {
    const draftId = parts[1];
    const draft = pendingDrafts.get(draftId);

    if (!draft) {
      await interaction.message.delete().catch(() => {});
      return interaction.reply({
        content: '⚠️ This message draft has already expired or been processed.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (
      interaction.user.id !== draft.authorId &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)
    ) {
      return interaction.reply({
        content: `❌ Only <@${draft.authorId}> or a moderator can confirm sending this message.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (draft.sent) {
      return interaction.reply({
        content: '⚠️ This message has already been sent.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!(await requireModLog(interaction))) return;

    const targetChannel =
      interaction.guild.channels.cache.get(draft.targetChannelId) ||
      (await interaction.guild.channels.fetch(draft.targetChannelId).catch(() => null));

    if (!targetChannel || !targetChannel.isTextBased()) {
      return interaction.reply({
        content: '❌ Target destination channel no longer exists or is inaccessible.',
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const sentMsg = await targetChannel.send({
        content: draft.content || undefined,
        files: draft.attachmentUrls,
      });

      draft.sent = true;

      const sentEmbed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Message Delivered')
        .setDescription(
          `Your message has been sent to <#${targetChannel.id}> ([Jump to Message](${sentMsg.url})).\n\n` +
            `This confirmation and your draft message will automatically delete ${toDiscordTimestamp(draft.expiresAt, 'R')}.`
        )
        .setTimestamp();

      const deleteNowRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`relay_msg_delete:${draftId}`)
          .setLabel('Delete Now')
          .setEmoji('🗑️')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.update({
        content: `<@${draft.authorId}>`,
        embeds: [sentEmbed],
        components: [deleteNowRow],
      });

      await logModAction(interaction.guild, {
        action: 'Relay Message Sent',
        executor: interaction.user,
        color: 0x57f287,
        fields: [
          { name: 'Input Channel', value: `<#${draft.inputChannelId}>`, inline: true },
          { name: 'Target Channel', value: `<#${draft.targetChannelId}>`, inline: true },
          {
            name: 'Content',
            value: (draft.content || '*(Attachments only)*').slice(0, 1024),
            inline: false,
          },
        ],
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ Failed to send message to <#${targetChannel.id}>: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (action === 'relay_msg_delete') {
    const draftId = parts[1];
    const draft = pendingDrafts.get(draftId);

    if (
      draft &&
      interaction.user.id !== draft.authorId &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)
    ) {
      return interaction.reply({
        content: `❌ Only <@${draft.authorId}> or a moderator can delete this draft.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (draft) {
      if (draft.timer) clearTimeout(draft.timer);
      pendingDrafts.delete(draftId);
      if (draft.userMessageId) {
        const userMsg = await interaction.channel.messages.fetch(draft.userMessageId).catch(() => null);
        if (userMsg) await userMsg.delete().catch(() => {});
      }
    }

    await interaction.message.delete().catch(async () => {
      await interaction.update({
        content: '🗑️ Draft deleted.',
        embeds: [],
        components: [],
      });
    });
    return;
  }

  if (action === 'relay_stop') {
    const inputChannelId = parts[1];
    const relay = getRelay(inputChannelId);

    if (
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) &&
      interaction.user.id !== relay?.configuredBy
    ) {
      return interaction.reply({
        content: '❌ You need the **Manage Channels** or **Manage Messages** permission to stop Send-Message Relay Mode.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!(await requireModLog(interaction))) return;

    clearChannelDrafts(inputChannelId);
    removeRelay(inputChannelId);

    await interaction.update({
      content: '🛑 Stopping Send-Message Relay Mode and deleting all messages in this channel...',
      embeds: [],
      components: [],
    });

    await purgeAllChannelMessages(interaction.channel);

    await logModAction(interaction.guild, {
      action: 'Send-Message Relay Mode Stopped & Channel Purged',
      executor: interaction.user,
      color: 0xed4245,
      fields: [
        { name: 'Cleared Channel', value: `<#${interaction.channel.id}> (\`${interaction.channel.id}\`)`, inline: true },
        ...(relay ? [{ name: 'Previous Target Channel', value: `<#${relay.targetChannelId}>`, inline: true }] : []),
      ],
    });
  }
}

module.exports = {
  promptEnableRelay,
  handleRelayMessageCreate,
  handleRelayInteraction,
  purgeAllChannelMessages,
};
