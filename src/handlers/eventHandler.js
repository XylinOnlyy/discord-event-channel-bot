const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildScheduledEventStatus,
  GuildScheduledEventEntityType,
  MessageFlags,
} = require('discord.js');
const { toDiscordTimestamp } = require('../utils/time');

function formatEventStatus(status) {
  switch (status) {
    case GuildScheduledEventStatus.Active:
      return '🟢 **LIVE NOW**';
    case GuildScheduledEventStatus.Scheduled:
      return '🗓️ **Scheduled**';
    case GuildScheduledEventStatus.Completed:
      return '✅ **Completed**';
    case GuildScheduledEventStatus.Canceled:
      return '❌ **Canceled**';
    default:
      return '📌 **Unknown**';
  }
}

function formatEventLocation(event) {
  if (event.entityType === GuildScheduledEventEntityType.External) {
    return `📍 ${event.entityMetadata?.location || 'External Location'}`;
  }
  if (event.channelId) {
    const icon = event.entityType === GuildScheduledEventEntityType.StageInstance ? '🎭' : '🔊';
    return `${icon} <#${event.channelId}>`;
  }
  return '📍 Server Event';
}

async function fetchSortedEvents(guild) {
  const collection = await guild.scheduledEvents.fetch({ withUserCount: true });
  return Array.from(collection.values()).sort(
    (a, b) => (a.scheduledStartTimestamp || 0) - (b.scheduledStartTimestamp || 0)
  );
}

function buildEventsOverviewPayload(guild, events) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📅 Server Events — ${guild.name}`)
    .setThumbnail(guild.iconURL({ size: 256 }))
    .setTimestamp();

  if (events.length === 0) {
    embed.setDescription(
      'There are currently **no scheduled or active events** in this server.\n\n' +
        'Administrators can create a new server event using `/event create` or via Discord Server Settings.'
    );

    const refreshRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('event_refresh_list')
        .setLabel('Refresh Events')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [refreshRow] };
  }

  const activeCount = events.filter((e) => e.status === GuildScheduledEventStatus.Active).length;
  const scheduledCount = events.filter((e) => e.status === GuildScheduledEventStatus.Scheduled).length;

  const lines = events.slice(0, 15).map((event, idx) => {
    const badge = event.status === GuildScheduledEventStatus.Active ? '🟢 **LIVE**' : '🗓️';
    const startTs = event.scheduledStartTimestamp
      ? `${toDiscordTimestamp(event.scheduledStartTimestamp, 'f')} (${toDiscordTimestamp(event.scheduledStartTimestamp, 'R')})`
      : 'TBA';
    const loc = formatEventLocation(event);
    const interested = event.userCount ?? 0;

    return (
      `**${idx + 1}. ${event.name}** [${badge}]\n` +
      `┗ 🕒 ${startTs} • ${loc} • 👥 \`${interested}\` interested`
    );
  });

  embed
    .setDescription(
      `Found **${events.length}** event(s) (**${activeCount}** active, **${scheduledCount}** upcoming).\n` +
        `Select an event from the menu below to view its full details.\n\n` +
        lines.join('\n\n')
    )
    .setFooter({ text: 'Times are automatically displayed in your local timezone.' });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('event_select')
    .setPlaceholder('🔍 Select an event to view full information...')
    .addOptions(
      events.slice(0, 25).map((event) => {
        const dateStr = event.scheduledStartAt
          ? event.scheduledStartAt.toUTCString().slice(0, 22)
          : 'Scheduled';
        return {
          label: event.name.slice(0, 100),
          value: event.id,
          description: `${dateStr} UTC • ${event.userCount ?? 0} interested`.slice(0, 100),
          emoji: event.status === GuildScheduledEventStatus.Active ? '🟢' : '🗓️',
        };
      })
    );

  const selectRow = new ActionRowBuilder().addComponents(selectMenu);
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('event_refresh_list')
      .setLabel('Refresh List')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [selectRow, buttonRow] };
}

function buildEventDetailPayload(guild, event, allEvents) {
  const isLive = event.status === GuildScheduledEventStatus.Active;
  const embed = new EmbedBuilder()
    .setColor(isLive ? 0x57f287 : 0x5865f2)
    .setTitle(`📅 ${event.name}`)
    .setURL(event.url)
    .setDescription(event.description?.trim() || '*No description provided for this event.*')
    .addFields(
      {
        name: 'Status',
        value: formatEventStatus(event.status),
        inline: true,
      },
      {
        name: 'Location / Channel',
        value: formatEventLocation(event),
        inline: true,
      },
      {
        name: 'Interested Members',
        value: `👥 **${event.userCount ?? 0}** member(s)`,
        inline: true,
      },
      {
        name: 'Start Time (Your Local Time)',
        value: event.scheduledStartTimestamp
          ? `${toDiscordTimestamp(event.scheduledStartTimestamp, 'F')}\n(${toDiscordTimestamp(event.scheduledStartTimestamp, 'R')})`
          : 'Not specified',
        inline: true,
      },
      {
        name: 'End Time (Your Local Time)',
        value: event.scheduledEndTimestamp
          ? `${toDiscordTimestamp(event.scheduledEndTimestamp, 'F')}\n(${toDiscordTimestamp(event.scheduledEndTimestamp, 'R')})`
          : 'Not specified',
        inline: true,
      },
      {
        name: 'Coordinator',
        value: event.creatorId ? `<@${event.creatorId}>` : 'Server Staff',
        inline: true,
      }
    )
    .setFooter({ text: `Event ID: ${event.id} • Displayed in your local timezone` })
    .setTimestamp();

  const coverUrl = event.coverImageURL({ size: 1024 });
  if (coverUrl) {
    embed.setImage(coverUrl);
  }

  const components = [];

  if (allEvents.length > 0) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('event_select')
      .setPlaceholder('🔍 Switch to another event...')
      .addOptions(
        allEvents.slice(0, 25).map((ev) => ({
          label: ev.name.slice(0, 100),
          value: ev.id,
          description: `${ev.userCount ?? 0} interested`.slice(0, 100),
          emoji: ev.status === GuildScheduledEventStatus.Active ? '🟢' : '🗓️',
          default: ev.id === event.id,
        }))
      );
    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('event_back_list')
      .setLabel('Back to Event List')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`event_refresh_detail:${event.id}`)
      .setLabel('Refresh Info')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel('Open Event')
      .setURL(event.url)
      .setStyle(ButtonStyle.Link)
  );
  components.push(buttonRow);

  return { embeds: [embed], components };
}

async function handleEventInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId === 'event_select') {
    const eventId = interaction.values[0];
    const allEvents = await fetchSortedEvents(interaction.guild);
    const selected =
      allEvents.find((e) => e.id === eventId) ||
      (await interaction.guild.scheduledEvents.fetch({ guildScheduledEvent: eventId, withUserCount: true }).catch(() => null));

    if (!selected) {
      return interaction.reply({
        content: '❌ That event no longer exists or has already ended.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const payload = buildEventDetailPayload(interaction.guild, selected, allEvents);
    return interaction.update(payload);
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'event_refresh_list' || interaction.customId === 'event_back_list') {
      const events = await fetchSortedEvents(interaction.guild);
      const payload = buildEventsOverviewPayload(interaction.guild, events);
      return interaction.update(payload);
    }

    if (interaction.customId.startsWith('event_refresh_detail:')) {
      const eventId = interaction.customId.split(':')[1];
      const allEvents = await fetchSortedEvents(interaction.guild);
      const selected = allEvents.find((e) => e.id === eventId);

      if (!selected) {
        const payload = buildEventsOverviewPayload(interaction.guild, allEvents);
        return interaction.update(payload);
      }

      const payload = buildEventDetailPayload(interaction.guild, selected, allEvents);
      return interaction.update(payload);
    }
  }
}

module.exports = {
  fetchSortedEvents,
  buildEventsOverviewPayload,
  buildEventDetailPayload,
  handleEventInteraction,
};
