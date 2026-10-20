const { SlashCommandBuilder } = require('discord.js');
const {
  fetchSortedEvents,
  buildEventsOverviewPayload,
} = require('../handlers/eventHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('check')
    .setDescription('Check server information and scheduled events')
    .addSubcommand((sub) =>
      sub
        .setName('events')
        .setDescription('View all scheduled and live events in the server with an interactive detail selector')
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const events = await fetchSortedEvents(interaction.guild);
    const payload = buildEventsOverviewPayload(interaction.guild, events);
    await interaction.editReply(payload);
  },
};
