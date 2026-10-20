const crypto = require('crypto');
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
const {
  getReminder,
  getAllReminders,
  saveReminder,
  deleteReminder,
} = require('../utils/database');
const {
  parseDuration,
  formatDuration,
  toDiscordTimestamp,
  buildProgressBar,
} = require('../utils/time');
const { requireModLog, logModAction } = require('../utils/modLogger');

const activeTimers = new Map();

const MESSAGE_LINK_REGEX =
  /^https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/;

function clearReminderTimer(reminderId) {
  const existing = activeTimers.get(reminderId);
  if (existing) {
    clearTimeout(existing);
    activeTimers.delete(reminderId);
  }
}

async function resolveMessageSource(guild, rawInput) {
  const trimmed = rawInput.trim();
  const match = trimmed.match(MESSAGE_LINK_REGEX);

  if (!match) {
    return {
      isLink: false,
      content: trimmed.replace(/\\n/g, '\n'),
      sourceMessageRef: null,
      attachments: [],
    };
  }

  const [, linkGuildId, linkChannelId, linkMessageId] = match;
  if (linkGuildId !== guild.id) {
    throw new Error('The linked message must belong to a channel in this server.');
  }

  const sourceChannel =
    guild.channels.cache.get(linkChannelId) ||
    (await guild.channels.fetch(linkChannelId).catch(() => null));

  if (!sourceChannel || !sourceChannel.isTextBased()) {
    throw new Error('Could not access the channel from the provided message link.');
  }

  const sourceMsg = await sourceChannel.messages.fetch(linkMessageId).catch(() => null);
  if (!sourceMsg) {
    throw new Error('Could not find the message from the provided link. Make sure the bot can view that channel.');
  }

  const attachmentUrls = Array.from(sourceMsg.attachments.values()).map((a) => a.url);
  const contentText = sourceMsg.content || '';

  if (!contentText && attachmentUrls.length === 0 && sourceMsg.embeds.length === 0) {
    throw new Error('The linked message has no sendable content or attachments.');
  }

  return {
    isLink: true,
    content: contentText,
    sourceMessageRef: {
      guildId: linkGuildId,
      channelId: linkChannelId,
      messageId: linkMessageId,
      url: sourceMsg.url,
    },
    attachments: attachmentUrls,
  };
}

function getStatusMeta(status) {
  switch (status) {
    case 'not_started':
      return { badge: '⏳ **Not Started**', color: 0x5865f2 };
    case 'scheduled':
      return { badge: '🕒 **Scheduled (Auto-Start)**', color: 0xfee75c };
    case 'running':
      return { badge: '🟢 **In Progress**', color: 0x57f287 };
    case 'paused':
      return { badge: '⏸️ **Stopped (Paused)**', color: 0xe67e22 };
    case 'completed':
      return { badge: '✅ **Completed**', color: 0x2ecc71 };
    case 'force_stopped':
      return { badge: '🛑 **Force Stopped**', color: 0xed4245 };
    default:
      return { badge: '📌 **Unknown**', color: 0x95a5a6 };
  }
}

function buildReminderEmbed(reminder) {
  const { badge, color } = getStatusMeta(reminder.status);
  const progressBar = buildProgressBar(reminder.sentCount, reminder.totalAmount);
  const remaining = Math.max(0, reminder.totalAmount - reminder.sentCount);

  let completionValue = '—';
  if (reminder.status === 'not_started') {
    const totalSpanMs = Math.max(0, (reminder.totalAmount - 1) * reminder.intervalMs);
    const previewEnd = Date.now() + totalSpanMs;
    completionValue =
      `~${formatDuration(totalSpanMs)} after start\n` +
      `(If started now: ${toDiscordTimestamp(previewEnd, 'F')})`;
  } else if (reminder.status === 'scheduled' || reminder.status === 'running') {
    if (reminder.estimatedEndAt) {
      completionValue =
        `${toDiscordTimestamp(reminder.estimatedEndAt, 'F')}\n` +
        `(${toDiscordTimestamp(reminder.estimatedEndAt, 'R')})`;
    }
  } else if (reminder.status === 'paused') {
    const leftMs = Math.max(0, remaining * reminder.intervalMs);
    completionValue = `⏸️ Paused (${formatDuration(leftMs)} remaining after resume)`;
  } else if (reminder.status === 'completed' && reminder.completedAt) {
    completionValue =
      `${toDiscordTimestamp(reminder.completedAt, 'F')}\n` +
      `(${toDiscordTimestamp(reminder.completedAt, 'R')})`;
  } else if (reminder.status === 'force_stopped' && reminder.completedAt) {
    completionValue =
      `Terminated at ${toDiscordTimestamp(reminder.completedAt, 'F')}\n` +
      `(${toDiscordTimestamp(reminder.completedAt, 'R')})`;
  }

  let nextDeliveryValue = '—';
  if (reminder.status === 'not_started') {
    nextDeliveryValue = 'Waiting for **Start** or **Start In**';
  } else if (reminder.status === 'scheduled' && reminder.scheduledStartAt) {
    nextDeliveryValue =
      `Auto-starts ${toDiscordTimestamp(reminder.scheduledStartAt, 'F')}\n` +
      `(${toDiscordTimestamp(reminder.scheduledStartAt, 'R')})`;
  } else if (reminder.status === 'running' && reminder.nextSendAt) {
    nextDeliveryValue =
      `${toDiscordTimestamp(reminder.nextSendAt, 'T')} ` +
      `(${toDiscordTimestamp(reminder.nextSendAt, 'R')})`;
  } else if (reminder.status === 'paused') {
    nextDeliveryValue = '⏸️ Paused — Click **Resume** to continue';
  } else if (reminder.status === 'completed') {
    nextDeliveryValue = '✅ All scheduled messages delivered';
  } else if (reminder.status === 'force_stopped') {
    nextDeliveryValue = '🛑 Cancelled by operator';
  }

  const previewText = reminder.resolvedContent
    ? reminder.resolvedContent.length > 500
      ? `${reminder.resolvedContent.slice(0, 497)}...`
      : reminder.resolvedContent
    : '*(Attachment / Embed from linked message)*';

  const sourceLine = reminder.sourceMessageRef
    ? `🔗 [Linked Message](${reminder.sourceMessageRef.url})\n`
    : '';

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`⏰ Reminder Monitor — #${reminder.id}`)
    .setDescription(
      `**Message Content:**\n${sourceLine}>>> ${previewText}`
    )
    .addFields(
      {
        name: 'Status',
        value: badge,
        inline: true,
      },
      {
        name: 'Target Channel',
        value: `<#${reminder.targetChannelId}> (\`${reminder.targetChannelId}\`)`,
        inline: true,
      },
      {
        name: 'Operator',
        value: `<@${reminder.userId}>`,
        inline: true,
      },
      {
        name: 'Progress Monitoring',
        value: `**${reminder.sentCount} / ${reminder.totalAmount}** sent (${remaining} left)\n${progressBar}`,
        inline: true,
      },
      {
        name: 'Interval',
        value: `Every **${formatDuration(reminder.intervalMs)}**`,
        inline: true,
      },
      {
        name: 'Next Delivery',
        value: nextDeliveryValue,
        inline: true,
      },
      {
        name: 'Completion Time (Your Local Time)',
        value: completionValue,
        inline: false,
      }
    )
    .setFooter({
      text: `Reminder ID: ${reminder.id} • Completion time adapts to each viewer's timezone`,
    })
    .setTimestamp();
}

function buildReminderComponents(reminder) {
  if (reminder.status === 'not_started' || reminder.status === 'scheduled') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rem_start:${reminder.id}`)
          .setLabel('Start')
          .setEmoji('▶️')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`rem_start_in:${reminder.id}`)
          .setLabel('Start In')
          .setEmoji('⏱️')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`rem_edit:${reminder.id}`)
          .setLabel('Edit Message')
          .setEmoji('✏️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`rem_delete:${reminder.id}`)
          .setLabel('Delete')
          .setEmoji('🗑️')
          .setStyle(ButtonStyle.Danger)
      ),
    ];
  }

  if (reminder.status === 'running') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rem_pause:${reminder.id}`)
          .setLabel('Stop')
          .setEmoji('⏸️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`rem_forcestop:${reminder.id}`)
          .setLabel('Force Stop')
          .setEmoji('🛑')
          .setStyle(ButtonStyle.Danger)
      ),
    ];
  }

  if (reminder.status === 'paused') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rem_resume:${reminder.id}`)
          .setLabel('Resume')
          .setEmoji('▶️')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`rem_forcestop:${reminder.id}`)
          .setLabel('Force Stop')
          .setEmoji('🛑')
          .setStyle(ButtonStyle.Danger)
      ),
    ];
  }

  return [];
}

async function updateMonitorMessage(client, reminder) {
  try {
    const guild =
      client.guilds.cache.get(reminder.guildId) ||
      (await client.guilds.fetch(reminder.guildId).catch(() => null));
    if (!guild) return;

    const channel =
      guild.channels.cache.get(reminder.controlChannelId) ||
      (await guild.channels.fetch(reminder.controlChannelId).catch(() => null));
    if (!channel || !channel.isTextBased() || !reminder.controlMessageId) return;

    const msg = await channel.messages.fetch(reminder.controlMessageId).catch(() => null);
    if (!msg) return;

    await msg.edit({
      content: `<@${reminder.userId}>`,
      embeds: [buildReminderEmbed(reminder)],
      components: buildReminderComponents(reminder),
    });
  } catch (err) {
    console.error(`[ReminderManager] Failed to update monitor panel for #${reminder.id}:`, err.message);
  }
}

async function deliverReminderMessage(client, reminder) {
  const guild =
    client.guilds.cache.get(reminder.guildId) ||
    (await client.guilds.fetch(reminder.guildId).catch(() => null));
  if (!guild) throw new Error('Guild not found');

  const targetChannel =
    guild.channels.cache.get(reminder.targetChannelId) ||
    (await guild.channels.fetch(reminder.targetChannelId).catch(() => null));
  if (!targetChannel || !targetChannel.isTextBased()) {
    throw new Error('Target channel no longer exists or is not text-based');
  }

  let payload = {
    content: reminder.resolvedContent || undefined,
    files: reminder.attachments || [],
  };

  if (reminder.sourceMessageRef) {
    const srcChan =
      guild.channels.cache.get(reminder.sourceMessageRef.channelId) ||
      (await guild.channels.fetch(reminder.sourceMessageRef.channelId).catch(() => null));
    if (srcChan && srcChan.isTextBased()) {
      const srcMsg = await srcChan.messages.fetch(reminder.sourceMessageRef.messageId).catch(() => null);
      if (srcMsg) {
        payload = {
          content: srcMsg.content || undefined,
          embeds: srcMsg.embeds.map((e) => EmbedBuilder.from(e)),
          files: Array.from(srcMsg.attachments.values()).map((a) => a.url),
        };
      }
    }
  }

  await targetChannel.send(payload);
}

function scheduleNextStep(client, reminderId) {
  clearReminderTimer(reminderId);
  const reminder = getReminder(reminderId);
  if (!reminder) return;

  if (reminder.status === 'scheduled') {
    const delayMs = Math.max(0, (reminder.scheduledStartAt || Date.now()) - Date.now());
    const timer = setTimeout(async () => {
      const fresh = getReminder(reminderId);
      if (!fresh || fresh.status !== 'scheduled') return;
      await beginReminderExecution(client, fresh.id);
    }, delayMs);
    activeTimers.set(reminderId, timer);
    return;
  }

  if (reminder.status === 'running') {
    const delayMs = Math.max(0, (reminder.nextSendAt || Date.now()) - Date.now());
    const timer = setTimeout(async () => {
      await executeReminderTick(client, reminderId);
    }, delayMs);
    activeTimers.set(reminderId, timer);
  }
}

async function beginReminderExecution(client, reminderId) {
  const reminder = getReminder(reminderId);
  if (!reminder) return;

  reminder.status = 'running';
  reminder.startedAt = Date.now();
  reminder.scheduledStartAt = null;
  saveReminder(reminder);

  await executeReminderTick(client, reminderId);
}

async function executeReminderTick(client, reminderId) {
  clearReminderTimer(reminderId);
  const reminder = getReminder(reminderId);
  if (!reminder || reminder.status !== 'running') return;

  try {
    await deliverReminderMessage(client, reminder);
    reminder.sentCount += 1;
    reminder.lastSentAt = Date.now();

    if (reminder.sentCount >= reminder.totalAmount) {
      reminder.status = 'completed';
      reminder.nextSendAt = null;
      reminder.completedAt = Date.now();
      reminder.estimatedEndAt = reminder.completedAt;
      saveReminder(reminder);
      await updateMonitorMessage(client, reminder);
      return;
    }

    const remainingSends = reminder.totalAmount - reminder.sentCount;
    const now = Date.now();
    reminder.nextSendAt = now + reminder.intervalMs;
    reminder.estimatedEndAt = now + remainingSends * reminder.intervalMs;
    saveReminder(reminder);

    await updateMonitorMessage(client, reminder);
    scheduleNextStep(client, reminder.id);
  } catch (err) {
    console.error(`[ReminderManager] Delivery failed for #${reminder.id}:`, err.message);
    reminder.status = 'paused';
    reminder.nextSendAt = null;
    saveReminder(reminder);
    await updateMonitorMessage(client, reminder);
  }
}

async function createReminderSession(interaction, { rawMessage, intervalMs, amount, targetChannel }) {
  const resolved = await resolveMessageSource(interaction.guild, rawMessage);
  const id = crypto.randomBytes(3).toString('hex').toUpperCase();

  const reminder = {
    id,
    guildId: interaction.guild.id,
    controlChannelId: interaction.channel.id,
    controlMessageId: null,
    targetChannelId: targetChannel.id,
    userId: interaction.user.id,
    rawInput: rawMessage,
    resolvedContent: resolved.content,
    sourceMessageRef: resolved.sourceMessageRef,
    attachments: resolved.attachments,
    intervalMs,
    totalAmount: amount,
    sentCount: 0,
    status: 'not_started',
    scheduledStartAt: null,
    startedAt: null,
    nextSendAt: null,
    estimatedEndAt: null,
    completedAt: null,
    createdAt: Date.now(),
  };

  saveReminder(reminder);

  const response = await interaction.reply({
    content: `<@${reminder.userId}>`,
    embeds: [buildReminderEmbed(reminder)],
    components: buildReminderComponents(reminder),
    fetchReply: true,
  });

  reminder.controlMessageId = response.id;
  saveReminder(reminder);

  await logModAction(interaction.guild, {
    action: 'Reminder Created (Pending Start)',
    executor: interaction.user,
    color: 0x5865f2,
    fields: [
      { name: 'Reminder ID', value: `\`#${reminder.id}\``, inline: true },
      { name: 'Target Channel', value: `<#${targetChannel.id}>`, inline: true },
      { name: 'Schedule', value: `${amount}x every ${formatDuration(intervalMs)}`, inline: true },
      {
        name: 'Content',
        value: (reminder.resolvedContent || 'Linked message').slice(0, 1024),
        inline: false,
      },
    ],
  });

  return reminder;
}

function canManageReminder(interaction, reminder) {
  if (interaction.user.id === reminder.userId) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  return false;
}

async function handleReminderInteraction(interaction) {
  if (interaction.isButton() && interaction.customId.startsWith('rem_')) {
    const [action, reminderId] = interaction.customId.split(':');
    const reminder = getReminder(reminderId);

    if (!reminder) {
      return interaction.reply({
        content: '❌ This reminder session no longer exists.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!canManageReminder(interaction, reminder)) {
      return interaction.reply({
        content: `❌ Only <@${reminder.userId}> or a server administrator can control this reminder.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!(await requireModLog(interaction))) return;

    if (action === 'rem_start') {
      if (reminder.status !== 'not_started' && reminder.status !== 'scheduled') {
        return interaction.reply({
          content: '⚠️ This reminder has already been started.',
          flags: MessageFlags.Ephemeral,
        });
      }

      clearReminderTimer(reminder.id);
      const now = Date.now();
      reminder.status = 'running';
      reminder.startedAt = now;
      reminder.scheduledStartAt = null;
      reminder.estimatedEndAt = now + Math.max(0, reminder.totalAmount - 1) * reminder.intervalMs;
      saveReminder(reminder);

      await interaction.update({
        content: `<@${reminder.userId}>`,
        embeds: [buildReminderEmbed(reminder)],
        components: buildReminderComponents(reminder),
      });

      await logModAction(interaction.guild, {
        action: 'Reminder Started',
        executor: interaction.user,
        color: 0x57f287,
        fields: [
          { name: 'Reminder ID', value: `\`#${reminder.id}\``, inline: true },
          { name: 'Target Channel', value: `<#${reminder.targetChannelId}>`, inline: true },
          { name: 'Total Sends', value: `${reminder.totalAmount}x every ${formatDuration(reminder.intervalMs)}`, inline: true },
        ],
      });

      await executeReminderTick(interaction.client, reminder.id);
      return;
    }

    if (action === 'rem_start_in') {
      if (reminder.status !== 'not_started' && reminder.status !== 'scheduled') {
        return interaction.reply({
          content: '⚠️ This reminder has already been started.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const modal = new ModalBuilder()
        .setCustomId(`rem_modal_start_in:${reminder.id}`)
        .setTitle(`Auto-Start Reminder #${reminder.id}`);

      const delayInput = new TextInputBuilder()
        .setCustomId('delay_minutes')
        .setLabel('Start in how many minutes? (e.g. 5, 15, 60)')
        .setPlaceholder('Enter minutes (e.g. 10) or duration (e.g. 30m, 2h)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20);

      modal.addComponents(new ActionRowBuilder().addComponents(delayInput));
      return interaction.showModal(modal);
    }

    if (action === 'rem_edit') {
      if (reminder.status !== 'not_started' && reminder.status !== 'scheduled') {
        return interaction.reply({
          content: '⚠️ Message content can only be edited before the reminder starts.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const modal = new ModalBuilder()
        .setCustomId(`rem_modal_edit:${reminder.id}`)
        .setTitle(`Edit Reminder #${reminder.id} Message`);

      const msgInput = new TextInputBuilder()
        .setCustomId('new_message')
        .setLabel('Reminder Message or Discord Message Link')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(reminder.rawInput.slice(0, 2000))
        .setRequired(true)
        .setMaxLength(2000);

      modal.addComponents(new ActionRowBuilder().addComponents(msgInput));
      return interaction.showModal(modal);
    }

    if (action === 'rem_delete') {
      clearReminderTimer(reminder.id);
      deleteReminder(reminder.id);

      await logModAction(interaction.guild, {
        action: 'Reminder Deleted',
        executor: interaction.user,
        color: 0xed4245,
        fields: [
          { name: 'Reminder ID', value: `\`#${reminder.id}\``, inline: true },
          { name: 'Target Channel', value: `<#${reminder.targetChannelId}>`, inline: true },
        ],
      });

      await interaction.message.delete().catch(async () => {
        await interaction.update({
          content: `🗑️ Reminder **#${reminder.id}** has been deleted by <@${interaction.user.id}>.`,
          embeds: [],
          components: [],
        });
      });
      return;
    }

    if (action === 'rem_pause') {
      if (reminder.status !== 'running') {
        return interaction.reply({
          content: '⚠️ This reminder is not currently running.',
          flags: MessageFlags.Ephemeral,
        });
      }

      clearReminderTimer(reminder.id);
      reminder.status = 'paused';
      reminder.nextSendAt = null;
      saveReminder(reminder);

      await interaction.update({
        content: `<@${reminder.userId}>`,
        embeds: [buildReminderEmbed(reminder)],
        components: buildReminderComponents(reminder),
      });

      await logModAction(interaction.guild, {
        action: 'Reminder Stopped (Paused)',
        executor: interaction.user,
        color: 0xe67e22,
        fields: [
          { name: 'Reminder ID', value: `\`#${reminder.id}\``, inline: true },
          { name: 'Progress', value: `${reminder.sentCount} / ${reminder.totalAmount}`, inline: true },
        ],
      });
      return;
    }

    if (action === 'rem_resume') {
      if (reminder.status !== 'paused') {
        return interaction.reply({
          content: '⚠️ This reminder is not paused.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const remaining = Math.max(0, reminder.totalAmount - reminder.sentCount);
      if (remaining <= 0) {
        reminder.status = 'completed';
        reminder.completedAt = Date.now();
        saveReminder(reminder);
        return interaction.update({
          content: `<@${reminder.userId}>`,
          embeds: [buildReminderEmbed(reminder)],
          components: buildReminderComponents(reminder),
        });
      }

      const now = Date.now();
      reminder.status = 'running';
      reminder.nextSendAt = now + reminder.intervalMs;
      reminder.estimatedEndAt = now + remaining * reminder.intervalMs;
      saveReminder(reminder);

      await interaction.update({
        content: `<@${reminder.userId}>`,
        embeds: [buildReminderEmbed(reminder)],
        components: buildReminderComponents(reminder),
      });

      scheduleNextStep(interaction.client, reminder.id);

      await logModAction(interaction.guild, {
        action: 'Reminder Resumed',
        executor: interaction.user,
        color: 0x57f287,
        fields: [
          { name: 'Reminder ID', value: `\`#${reminder.id}\``, inline: true },
          { name: 'Remaining Sends', value: `${remaining} message(s)`, inline: true },
        ],
      });
      return;
    }

    if (action === 'rem_forcestop') {
      clearReminderTimer(reminder.id);
      reminder.status = 'force_stopped';
      reminder.nextSendAt = null;
      reminder.completedAt = Date.now();
      saveReminder(reminder);

      await interaction.update({
        content: `<@${reminder.userId}>`,
        embeds: [buildReminderEmbed(reminder)],
        components: buildReminderComponents(reminder),
      });

      await logModAction(interaction.guild, {
        action: 'Reminder Force Stopped',
        executor: interaction.user,
        color: 0xed4245,
        fields: [
          { name: 'Reminder ID', value: `\`#${reminder.id}\``, inline: true },
          { name: 'Target Channel', value: `<#${reminder.targetChannelId}>`, inline: true },
          { name: 'Progress Before Stop', value: `${reminder.sentCount} / ${reminder.totalAmount}`, inline: true },
        ],
      });
      return;
    }
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('rem_modal_')) {
    const [modalType, reminderId] = interaction.customId.split(':');
    const reminder = getReminder(reminderId);

    if (!reminder) {
      return interaction.reply({
        content: '❌ This reminder session no longer exists.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!(await requireModLog(interaction))) return;

    if (modalType === 'rem_modal_start_in') {
      const rawDelay = interaction.fields.getTextInputValue('delay_minutes');
      const delayMs = parseDuration(rawDelay, 60_000);

      if (!delayMs || delayMs < 5_000 || delayMs > 30 * 86_400_000) {
        return interaction.reply({
          content: '❌ Invalid delay. Please enter a number of minutes (e.g. `10`) or duration (`5m`, `2h`) between 5 seconds and 30 days.',
          flags: MessageFlags.Ephemeral,
        });
      }

      clearReminderTimer(reminder.id);
      const startAt = Date.now() + delayMs;
      reminder.status = 'scheduled';
      reminder.scheduledStartAt = startAt;
      reminder.estimatedEndAt = startAt + Math.max(0, reminder.totalAmount - 1) * reminder.intervalMs;
      saveReminder(reminder);

      scheduleNextStep(interaction.client, reminder.id);

      await interaction.update({
        content: `<@${reminder.userId}>`,
        embeds: [buildReminderEmbed(reminder)],
        components: buildReminderComponents(reminder),
      });

      await logModAction(interaction.guild, {
        action: 'Reminder Auto-Start Scheduled (Start In)',
        executor: interaction.user,
        color: 0xfee75c,
        fields: [
          { name: 'Reminder ID', value: `\`#${reminder.id}\``, inline: true },
          { name: 'Starts At', value: `${toDiscordTimestamp(startAt, 'F')} (${toDiscordTimestamp(startAt, 'R')})`, inline: true },
          { name: 'Target Channel', value: `<#${reminder.targetChannelId}>`, inline: true },
        ],
      });
      return;
    }

    if (modalType === 'rem_modal_edit') {
      const newRaw = interaction.fields.getTextInputValue('new_message');
      try {
        const resolved = await resolveMessageSource(interaction.guild, newRaw);
        reminder.rawInput = newRaw;
        reminder.resolvedContent = resolved.content;
        reminder.sourceMessageRef = resolved.sourceMessageRef;
        reminder.attachments = resolved.attachments;
        saveReminder(reminder);

        await interaction.update({
          content: `<@${reminder.userId}>`,
          embeds: [buildReminderEmbed(reminder)],
          components: buildReminderComponents(reminder),
        });
      } catch (err) {
        return interaction.reply({
          content: `❌ ${err.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
}

function resumeRemindersOnStartup(client) {
  const all = getAllReminders();
  let resumed = 0;

  for (const reminder of all) {
    if (reminder.status === 'scheduled') {
      scheduleNextStep(client, reminder.id);
      resumed++;
    } else if (reminder.status === 'running') {
      if (!reminder.nextSendAt || reminder.nextSendAt < Date.now()) {
        reminder.nextSendAt = Date.now() + 5_000;
        const remaining = Math.max(0, reminder.totalAmount - reminder.sentCount);
        reminder.estimatedEndAt = reminder.nextSendAt + Math.max(0, remaining - 1) * reminder.intervalMs;
        saveReminder(reminder);
      }
      scheduleNextStep(client, reminder.id);
      resumed++;
    }
  }

  if (resumed > 0) {
    console.log(`⏰ Resumed ${resumed} active/scheduled reminder(s) from database.`);
  }
}

module.exports = {
  createReminderSession,
  handleReminderInteraction,
  resumeRemindersOnStartup,
  buildReminderEmbed,
  buildReminderComponents,
  clearReminderTimer,
};
