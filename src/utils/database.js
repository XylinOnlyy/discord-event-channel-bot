const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

const DEFAULT_DB = {
  settings: {},
  presets: {},
  lockSnapshots: {},
  reminders: {},
  relays: {},
};

let cache = null;

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf8');
  }
}

function readDb() {
  if (cache) return cache;
  ensureDb();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = {
      settings: parsed.settings || {},
      presets: parsed.presets || {},
      lockSnapshots: parsed.lockSnapshots || {},
      reminders: parsed.reminders || {},
      relays: parsed.relays || {},
    };
    return cache;
  } catch (err) {
    console.error('[Database] Corrupted database file, initializing clean state:', err.message);
    cache = JSON.parse(JSON.stringify(DEFAULT_DB));
    return cache;
  }
}

function writeDb(data) {
  ensureDb();
  cache = data;
  const tempFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempFile, DB_FILE);
}

function getModLogChannel(guildId) {
  const db = readDb();
  return db.settings[guildId]?.modLogChannelId || null;
}

function setModLogChannel(guildId, channelId) {
  const db = readDb();
  if (!db.settings[guildId]) db.settings[guildId] = {};
  db.settings[guildId].modLogChannelId = channelId;
  writeDb(db);
}

function getPreset(guildId, presetNumber) {
  const db = readDb();
  return db.presets[guildId]?.[String(presetNumber)] || null;
}

function getAllPresets(guildId) {
  const db = readDb();
  return db.presets[guildId] || {};
}

function setPreset(guildId, presetNumber, { channels, exceptRoles, updatedBy }) {
  const db = readDb();
  if (!db.presets[guildId]) db.presets[guildId] = {};
  db.presets[guildId][String(presetNumber)] = {
    channels: Array.from(new Set(channels)),
    exceptRoles: Array.from(new Set(exceptRoles || [])),
    updatedAt: Date.now(),
    updatedBy,
  };
  writeDb(db);
  return db.presets[guildId][String(presetNumber)];
}

function deletePreset(guildId, presetNumber) {
  const db = readDb();
  if (!db.presets[guildId]?.[String(presetNumber)]) return false;
  delete db.presets[guildId][String(presetNumber)];
  writeDb(db);
  return true;
}

function getLockSnapshot(guildId, channelId) {
  const db = readDb();
  return db.lockSnapshots[guildId]?.[channelId] || null;
}

function setLockSnapshot(guildId, channelId, snapshot) {
  const db = readDb();
  if (!db.lockSnapshots[guildId]) db.lockSnapshots[guildId] = {};
  db.lockSnapshots[guildId][channelId] = snapshot;
  writeDb(db);
}

function removeLockSnapshot(guildId, channelId) {
  const db = readDb();
  if (db.lockSnapshots[guildId]?.[channelId]) {
    delete db.lockSnapshots[guildId][channelId];
    writeDb(db);
  }
}

function getReminder(reminderId) {
  const db = readDb();
  return db.reminders[reminderId] || null;
}

function getGuildReminders(guildId) {
  const db = readDb();
  return Object.values(db.reminders).filter((r) => r.guildId === guildId);
}

function getAllReminders() {
  const db = readDb();
  return Object.values(db.reminders);
}

function saveReminder(reminder) {
  const db = readDb();
  db.reminders[reminder.id] = reminder;
  writeDb(db);
  return reminder;
}

function deleteReminder(reminderId) {
  const db = readDb();
  if (db.reminders[reminderId]) {
    delete db.reminders[reminderId];
    writeDb(db);
    return true;
  }
  return false;
}

function getRelay(inputChannelId) {
  const db = readDb();
  return db.relays[inputChannelId] || null;
}

function getGuildRelays(guildId) {
  const db = readDb();
  return Object.values(db.relays).filter((r) => r.guildId === guildId);
}

function setRelay(inputChannelId, relayData) {
  const db = readDb();
  db.relays[inputChannelId] = relayData;
  writeDb(db);
  return relayData;
}

function removeRelay(inputChannelId) {
  const db = readDb();
  if (db.relays[inputChannelId]) {
    delete db.relays[inputChannelId];
    writeDb(db);
    return true;
  }
  return false;
}

module.exports = {
  getModLogChannel,
  setModLogChannel,
  getPreset,
  getAllPresets,
  setPreset,
  deletePreset,
  getLockSnapshot,
  setLockSnapshot,
  removeLockSnapshot,
  getReminder,
  getGuildReminders,
  getAllReminders,
  saveReminder,
  deleteReminder,
  getRelay,
  getGuildRelays,
  setRelay,
  removeRelay,
};
