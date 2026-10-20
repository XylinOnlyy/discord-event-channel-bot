# Discord Event, Channel & Reminder Bot

A Discord server management bot built with **Node.js** and **discord.js v14** for managing server scheduled events, interactive reminders, anti-spam message relay channels, non-destructive channel preset locks, and mandatory moderation logs.

## Features & Slash Commands

### 1. Mandatory Moderation Logs
- **`/moderation logs [channel]`** — Sets the server's Moderation Logs channel. **Required before any administrative command can be executed.** Logs full details of who executed every command or button action.
- **`/moderation status`** — Displays the current log configuration, active reminders, configured presets, and active send-message relay channels.

### 2. Server Scheduled Events
- **`/check events`** — Displays all live and upcoming Discord Scheduled Events in the server. Includes a dropdown selector below the embed to inspect complete details for any event (description, cover banner, voice/stage/external location, subscriber count, and start/end times in each viewer's local timezone).
- **`/event create`** — Create a new Discord Scheduled Event directly via slash command.
- **`/event cancel [event_id]`** — Cancel and delete a scheduled event.

### 3. Controlled Reminder System & Live Monitor
- **`/reminder message [message] [interval] [amount] [channel]`**
  - Accepts plain text or a **Discord message link** (`https://discord.com/channels/...`).
  - Does **not** start immediately—displays a pre-start control panel with:
    - **▶️ Start**: Begins sending immediately.
    - **⏱️ Start In**: Opens a modal form asking how many minutes from now to automatically start.
    - **✏️ Edit Message**: Edit the message content before starting.
    - **🗑️ Delete**: Cancel and delete the reminder.
  - **Live Status Monitoring**:
    - Tracks status (`⏳ Not Started`, `🕒 Scheduled`, `🟢 In Progress`, `⏸️ Stopped (Paused)`, `✅ Completed`, `🛑 Force Stopped`).
    - Displays sent progress (`X / Y` + visual progress bar), target channel, operator mention (`<@user>`), and completion time formatted dynamically in each viewer's local timezone.
    - Provides **⏸️ Stop / ▶️ Resume** and **🛑 Force Stop** buttons while active.
- **`/reminder list`** — Lists all active, scheduled, and paused reminders in the server.

### 4. Anti-Spam Send-Message Relay
- **`/set send-message [channel] [input_channel]`**
  - Displays a confirmation warning that all messages in the input channel will be purged and advises against using it in busy channels.
  - Once confirmed, purges the input channel and keeps a persistent **🛑 Stop & Clear Channel** controller at the very bottom of the channel.
  - Any message typed in the input channel prompts for **📤 Send Message** or **🗑️ Delete** confirmation before being sent to the target channel, and automatically deletes the draft and confirmation after **3 minutes**.
  - Clicking **🛑 Stop & Clear Channel** ends the session and deletes all messages in the input channel.

### 5. Channel Presets (1–9) & Non-Destructive Lock / Unlock
- **`/set preset [preset 1-9] [channel_1..5] [more_channels] [except_role]`** — Assign unlimited channels (via command options, pasted `#channel` mentions/IDs, or the interactive multi-channel/role dropdown menus) and exception roles to Presets 1 through 9.
- **`/preset list`** & **`/preset view [1-9]`** — View or interactively edit any preset.
- **`/lock preset [1-9]`** & **`/lock channel`** — Snapshots existing channel permissions before locking so regular members cannot chat, while exempted roles still can.
- **`/unlock preset [1-9]`** & **`/unlock channel`** — Unlocks the channels and restores their exact pre-lock permission states without corrupting custom channel overwrites.

### 6. Extra Channel Utilities
- **`/channel slowmode [seconds] [channel]`** — Set or disable channel slowmode.
- **`/channel purge [amount] [channel]`** — Bulk delete up to 100 messages.
- **`/help`** — View the full command reference.

---

## Setup Instructions

1. **Discord Developer Portal**:
   - Enable **Message Content Intent** under **Bot → Privileged Gateway Intents** (required for `/set send-message` relay).
   - Invite the bot with `bot` and `applications.commands` scopes and permissions: `Manage Channels`, `Manage Messages`, `Manage Events`, `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`.

2. **Configure Environment**:
   ```bash
   cp .env.example .env
   ```
   Fill in `DISCORD_TOKEN` (and optionally `CLIENT_ID` and `GUILD_ID`).

3. **Install & Run**:
   ```bash
   npm install
   npm start
   ```
