const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventEntityType,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { requireModLog, logModAction } = require('../utils/modLogger');
const { parseDuration, toDiscordTimestamp } = require('../utils/time');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create or manage server scheduled events')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new Discord Scheduled Event in this server')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Name/title of the event')
            .setRequired(true)
            .setMaxLength(100)
        )
        .addStringOption((opt) =>
          opt
            .setName('start_in')
            .setDescription('When the event starts from now (e.g. 30m, 2h, 1d)')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('duration')
            .setDescription('How long the event lasts (e.g. 1h, 2h, 90m)')
            .setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName('voice_channel')
            .setDescription('Voice or Stage channel for the event (leave empty if using external location)')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('external_location')
            .setDescription('External location or text channel name (used if no voice channel is selected)')
            .setRequired(false)
            .setMaxLength(100)
        )
        .addStringOption((opt) =>
          opt
            .setName('description')
            .setDescription('Event description and details')
            .setRequired(false)
            .setMaxLength(1000)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Cancel and delete a scheduled server event by its ID')
        .addStringOption((opt) =>
          opt
            .setName('event_id')
            .setDescription('The ID of the scheduled event to cancel')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!(await requireModLog(interaction))) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const name = interaction.options.getString('name', true);
      const startInRaw = interaction.options.getString('start_in', true);
      const durationRaw = interaction.options.getString('duration', true);
      const voiceChannel = interaction.options.getChannel('voice_channel');
      const externalLocation = interaction.options.getString('external_location');
      const description = interaction.options.getString('description') || '';

      const startOffsetMs = parseDuration(startInRaw, 60_000);
      const durationMs = parseDuration(durationRaw, 60_000);

      if (!startOffsetMs || startOffsetMs < 60_000) {
        return interaction.reply({
          content: '❌ `start_in` must be at least 1 minute in the future (e.g. `15m`, `2h`, `1d`).',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!durationMs || durationMs < 5 * 60_000) {
        return interaction.reply({
          content: '❌ `duration` must be at least 5 minutes (e.g. `30m`, `2h`).',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!voiceChannel && !externalLocation) {
        return interaction.reply({
          content: '❌ Please provide either a `voice_channel` or an `external_location` for the event.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const startTime = Date.now() + startOffsetMs;
      const endTime = startTime + durationMs;

      let entityType = GuildScheduledEventEntityType.External;
      if (voiceChannel) {
        entityType =
          voiceChannel.type === ChannelType.GuildStageVoice
            ? GuildScheduledEventEntityType.StageInstance
            : GuildScheduledEventEntityType.Voice;
      }

      try {
        const created = await interaction.guild.scheduledEvents.create({
          name,
          scheduledStartTime: new Date(startTime),
          scheduledEndTime: new Date(endTime),
          privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
          entityType,
          description,
          channel: voiceChannel ? voiceChannel.id : undefined,
          entityMetadata: !voiceChannel ? { location: externalLocation } : undefined,
        });

        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(`📅 Scheduled Event Created — ${created.name}`)
          .setURL(created.url)
          .setDescription(description || '*No description provided.*')
          .addFields(
            {
              name: 'Starts',
              value: `${toDiscordTimestamp(startTime, 'F')} (${toDiscordTimestamp(startTime, 'R')})`,
              inline: true,
            },
            {
              name: 'Ends',
              value: `${toDiscordTimestamp(endTime, 'F')}`,
              inline: true,
            },
            {
              name: 'Location',
              value: voiceChannel ? `<#${voiceChannel.id}>` : `📍 ${externalLocation}`,
              inline: true,
            }
          )
          .setFooter({ text: `Event ID: ${created.id}` })
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        await logModAction(interaction.guild, {
          action: 'Server Event Created',
          executor: interaction.user,
          color: 0x57f287,
          fields: [
            { name: 'Event Name', value: created.name, inline: true },
            { name: 'Event ID', value: `\`${created.id}\``, inline: true },
            { name: 'Start Time', value: toDiscordTimestamp(startTime, 'F'), inline: true },
          ],
        });
      } catch (err) {
        return interaction.reply({
          content: `❌ Failed to create event: ${err.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (sub === 'cancel') {
      const eventId = interaction.options.getString('event_id', true).trim();
      const event = await interaction.guild.scheduledEvents.fetch(eventId).catch(() => null);

      if (!event) {
        return interaction.reply({
          content: `❌ Could not find a scheduled event with ID \`${eventId}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const eventName = event.name;
      await event.delete(`Canceled by ${interaction.user.tag}`);

      await interaction.reply({
        content: `🗑️ Scheduled event **${eventName}** (\`${eventId}\`) has been canceled and removed.`,
      });

      await logModAction(interaction.guild, {
        action: 'Server Event Canceled',
        executor: interaction.user,
        color: 0xed4245,
        fields: [
          { name: 'Event Name', value: eventName, inline: true },
          { name: 'Event ID', value: `\`${eventId}\``, inline: true },
        ],
      });
    }
  },
};
