function parseDuration(input, defaultUnitMs = 60_000) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase();

  if (/^\d+$/.test(trimmed)) {
    const val = parseInt(trimmed, 10);
    return val > 0 ? val * defaultUnitMs : null;
  }

  const regex = /(\d+)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)/g;
  let totalMs = 0;
  let matched = false;
  let match;

  while ((match = regex.exec(trimmed)) !== null) {
    matched = true;
    const amount = parseInt(match[1], 10);
    const unit = match[2];

    if (unit.startsWith('d')) totalMs += amount * 86_400_000;
    else if (unit.startsWith('h')) totalMs += amount * 3_600_000;
    else if (unit.startsWith('m')) totalMs += amount * 60_000;
    else if (unit.startsWith('s')) totalMs += amount * 1_000;
  }

  return matched && totalMs > 0 ? totalMs : null;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);

  return parts.join(' ') || '0s';
}

function toDiscordTimestamp(epochMs, style = 'F') {
  const unix = Math.floor(epochMs / 1000);
  return `<t:${unix}:${style}>`;
}

function buildProgressBar(current, total, length = 12) {
  const safeTotal = Math.max(1, total);
  const ratio = Math.min(1, Math.max(0, current / safeTotal));
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  const percent = Math.round(ratio * 100);
  return `\`[${'█'.repeat(filled)}${'░'.repeat(empty)}]\` **${percent}%**`;
}

module.exports = {
  parseDuration,
  formatDuration,
  toDiscordTimestamp,
  buildProgressBar,
};
