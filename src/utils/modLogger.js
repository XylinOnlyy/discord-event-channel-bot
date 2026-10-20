const { EmbedBuilder, MessageFlags } = require('discord.js');
const { getModLogChannel } = require('./database');
const { toDiscordTimestamp } = require('./time');

async function resolveModLogChannel(guild) {
  if (!guild) return null;
  const channelId = getModLogChannel(guild.id);
  if (!channelId) return null;

  const channel =
    guild.channels.cache.get(channelId) ||
    (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel || !channel.isTextBased()) return null;
  return channel;
}

async function requireModLog(interaction) {
  const logChannel = await resolveModLogChannel(interaction.guild);
  if (logChannel) return true;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('⚠️ Moderation Logs Required')
    .setDescription(
      'Administrative commands cannot be executed until a valid **Moderation Logs** channel is configured for this server.\n\n' +
        'Please configure it first using:\n' +
        '`/moderation logs channel:#your-log-channel`'
    )
    .setTimestamp();

  const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }
  return false;
}

async function logModAction(guild, { action, executor, color = 0x5865f2, description = null, fields = [] }) {
  try {
    const logChannel = await resolveModLogChannel(guild);
    if (!logChannel) return false;

    const now = Date.now();
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`🛡️ ${action}`)
      .setAuthor({
        name: `${executor.tag} (${executor.id})`,
        iconURL: executor.displayAvatarURL({ size: 128 }),
      })
      .addFields(
        {
          name: 'Executed By',
          value: `<@${executor.id}> (\`${executor.tag}\`)`,
          inline: true,
        },
        {
          name: 'Time',
          value: `${toDiscordTimestamp(now, 'F')} (${toDiscordTimestamp(now, 'R')})`,
          inline: true,
        },
        ...fields
      )
      .setFooter({ text: `Executor ID: ${executor.id}` })
      .setTimestamp(now);

    if (description) {
      embed.setDescription(description);
    }

    await logChannel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error('[ModLogger] Failed to send moderation log:', err.message);
    return false;
  }
}

module.exports = {
  resolveModLogChannel,
  requireModLog,
  logModAction,
};
