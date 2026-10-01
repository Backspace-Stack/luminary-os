// ============================================================
// DiscordBridge — Lumen over Discord DMs (Chat, Code & Deep Research).
//
// Deliberately minimal and locked down:
//   • Starts ONLY when a bot token is configured (Settings →
//     Integrations, same store as Tavily). No token ⇒ the backend
//     boots exactly as before and this class does nothing. A saved
//     token is picked up within a minute — no restart needed.
//   • Outbound gateway connection only — no listening port; BIND_HOST
//     is untouched.
//   • Every incoming message AND every interaction (slash command,
//     button click) hits the allowlist FIRST: unless the actor's
//     Discord user id equals discord_allowed_user_id, it is dropped
//     and logged before anything else touches it. Nothing reaches a
//     model, and no one but the allowlisted user can approve an action.
//   • Native slash commands /chat /code /research switch which agent
//     answers subsequent DMs — the same per-conversation agentId the
//     dashboard uses. Chat has no tools; Code/Research can pause for
//     approval.
//   • A paused confirmation is presented as one embed per pending call
//     with real Approve/Deny buttons. Approve resumes through the
//     EXISTING confirmedToolCallIds mechanism; Deny revokes the paused turn and
//     prevents later approval with the same token. No parallel
//     confirmation system, no new backend endpoint.
//   • Replies are sent whole when generation finishes; anything over
//     Discord's 2000-char limit is split on clean line breaks.
//   • Failures reply honestly (real error text) — never silence,
//     never a fabricated answer.
//
// SECURITY: the bot token is resolved live from SecretsService and is
// never logged. Allowlist mismatches log only the LAST 4 digits of the
// actor id — enough to debug a mismatch, no more.
// ============================================================

import {
  Client, GatewayIntentBits, Partials, Events,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type Message, type Interaction, type ChatInputCommandInteraction, type ButtonInteraction,
} from 'discord.js';
import { secretsService } from '../../services/SecretsService';
import { chatService, type GenerateParams } from '../../services/ChatService';
import type { PendingConfirmation } from '../../core/types/IAgent';
import { JsonStore } from '../../core/persistence/JsonStore';
import { apiAuthEnabled } from '../../middleware/authToken';
import { denyPendingConfirmations } from '../../agents/BaseAgent';
import { Logger } from '../../core/logger/Logger';

const logger = Logger.scope('DiscordBridge');

/** Discord's hard per-message length limit. */
export const DISCORD_MESSAGE_LIMIT = 2000;
/** How often to refresh the typing indicator while generating. */
const TYPING_INTERVAL_MS = 8_000;
/** How often to check whether a token was configured after boot. */
const TOKEN_POLL_MS = 60_000;

/** customId namespace for this bridge's buttons: `lum:<approve|deny>:<confirmationId>`. */
const BTN_PREFIX = 'lum';

/** Slash command → the agent it pins the DM to. One source of truth. */
const MODE_BY_COMMAND: Record<string, { agentId: string; label: string }> = {
  chat: { agentId: 'conversation-agent', label: 'Chat' },
  code: { agentId: 'coding-agent', label: 'Code' },
  research: { agentId: 'research-agent', label: 'Deep Research' },
};
const DEFAULT_AGENT_ID = 'conversation-agent';

/** Native application commands registered with Discord (not text parsing). */
const SLASH_COMMANDS = [
  { name: 'chat', description: 'Switch this DM to Chat mode — conversational, no tools.', dmPermission: true },
  { name: 'code', description: 'Switch this DM to Code mode — agent with tools and approvals.', dmPermission: true },
  { name: 'research', description: 'Switch this DM to Deep Research mode.', dmPermission: true },
];

/** Outcome of one generation turn: final text, and/or a pause needing approval. */
interface PendingInfo { agentName: string; items: PendingConfirmation[]; }
interface GenResult { text: string; pending?: PendingInfo; }

/**
 * Split a reply into Discord-sized chunks, preferring clean line
 * breaks. Pure and exported so it can be verified in isolation.
 */
export function splitDiscordMessage(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= limit) return [trimmed];

  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut <= 0) cut = limit; // no clean break in range — hard cut
    const chunk = rest.slice(0, cut).trimEnd();
    if (chunk) chunks.push(chunk);
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** A message payload the bridge may send — plain text, or an embed+buttons card. */
type DiscordSendable = string | { content?: string; embeds?: unknown[]; components?: unknown[] };

/** The only channel surface the bridge uses — easy to stub in tests. */
interface DmChannelLike {
  sendTyping(): Promise<void>;
  send(payload: DiscordSendable): Promise<unknown>;
}

/** Structural view of an incoming message (adapter over discord.js). */
export interface IncomingDm {
  authorId: string;
  authorIsBot: boolean;
  isDm: boolean;
  content: string;
  channel: DmChannelLike;
}

export class DiscordBridge {
  private client: Client | null = null;
  private started = false;
  private pollTimer: NodeJS.Timeout | null = null;
  /** A token that failed to log in — don't retry until it changes. */
  private lastFailedToken: string | null = null;
  /** Remembers the bridge's persistent web-visible conversation and the
   *  DM's current mode (which agent answers). agentId mirrors the
   *  dashboard's per-conversation agentId concept. */
  private convStore = new JsonStore<{ conversationId: string | null; agentId?: string }>(
    'discord-bridge.json',
    { conversationId: null, agentId: DEFAULT_AGENT_ID },
  );

  /**
   * Called once at kernel boot. Never throws: with no token configured
   * it logs one line and arms a slow poll so a token saved later in
   * Settings brings the bridge up without a restart.
   */
  async start(): Promise<void> {
    await this.tryStart();
    if (!this.started) {
      this.pollTimer = setInterval(() => { void this.tryStart(); }, TOKEN_POLL_MS);
    }
  }

  private async tryStart(): Promise<void> {
    if (this.started) return;
    const token = secretsService.resolve('discord_bot_token');
    if (!token) {
      if (!this.pollTimer) {
        logger.info('Discord bridge idle — no bot token configured (Settings → Integrations → Discord Bot Token).');
      }
      return;
    }
    if (token === this.lastFailedToken) return; // same bad token — wait for it to change

    if (!apiAuthEnabled()) {
      logger.warn('Discord bridge is enabled but API_AUTH_TOKEN is not set — the local HTTP API stays unauthenticated. Set API_AUTH_TOKEN in backend/.env if this machine is reachable by others.');
    }
    if (!secretsService.resolve('discord_allowed_user_id')) {
      logger.warn('Discord bridge: no Allowed User ID configured — every DM will be dropped until one is saved in Settings → Integrations.');
    }

    const client = new Client({
      // DirectMessages + MessageContent only — no Guilds intent, so
      // server messages never even arrive. MessageContent is a
      // privileged intent: enable it for the bot in the Discord
      // Developer Portal or DMs arrive with empty content.
      intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
      partials: [Partials.Channel], // DM channels arrive partial
    });

    client.once(Events.ClientReady, (c) => {
      logger.info(`Discord bridge connected as ${c.user.tag}`);
      // Register native application commands (global). New global commands
      // can take a little while to appear in the client — a Discord-side
      // propagation delay, not an error. Best-effort: a failure here never
      // stops messages from working.
      c.application.commands.set(SLASH_COMMANDS)
        .then(() => logger.info('Registered Discord slash commands: /chat, /code, /research'))
        .catch((err) => logger.warn('Failed to register Discord slash commands', { error: String(err) }));
    });
    client.on(Events.Error, (err) => {
      logger.warn('Discord client error', { error: String(err) });
    });
    client.on(Events.MessageCreate, (message) => {
      void this.handleIncoming(this.adapt(message)).catch((err) => {
        logger.error('Discord message handling failed', { error: String(err) });
      });
    });
    client.on(Events.InteractionCreate, (interaction) => {
      void this.handleInteraction(interaction).catch((err) => {
        logger.error('Discord interaction handling failed', { error: String(err) });
      });
    });

    try {
      await client.login(token); // token itself is never logged
      this.client = client;
      this.started = true;
      this.lastFailedToken = null;
      if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    } catch (err) {
      this.lastFailedToken = token;
      client.destroy().catch(() => { /* best-effort */ });
      logger.error('Discord login failed — check the bot token in Settings → Integrations.', { error: String(err) });
    }
  }

  /** Narrow a discord.js Message to the structural shape the gate uses. */
  private adapt(message: Message): IncomingDm {
    return {
      authorId: message.author.id,
      authorIsBot: message.author.bot,
      isDm: message.channel.isDMBased(),
      content: message.content ?? '',
      channel: {
        sendTyping: () => (message.channel as unknown as DmChannelLike).sendTyping(),
        send: (payload: DiscordSendable) => (message.channel as unknown as DmChannelLike).send(payload),
      },
    };
  }

  // ── Allowlist gate — ONE check, reused by messages AND interactions ──

  /** The single configured allowed Discord user id, or undefined if none. */
  private allowedUserId(): string | undefined {
    return secretsService.resolve('discord_allowed_user_id')?.trim() || undefined;
  }

  /** True only for the one allowlisted user. Used for every message and
   *  every interaction (slash command, button click) alike. */
  private isAllowed(userId: string): boolean {
    const allowed = this.allowedUserId();
    return !!allowed && userId === allowed;
  }

  /**
   * The full path of one incoming message. ORDER MATTERS: the
   * allowlist gate runs before the message body is used for anything.
   * (The bot-author check above it only prevents reacting to our own
   * outbound replies — it reads no user content.)
   */
  private async handleIncoming(dm: IncomingDm): Promise<void> {
    if (dm.authorIsBot) return; // our own replies / other bots — no log spam

    // ── Gate #1: allowlist, before ANYTHING touches the message ──
    if (!this.isAllowed(dm.authorId)) {
      logger.warn(`Dropped Discord message from non-allowed sender (id …${dm.authorId.slice(-4)})`);
      return; // silent to the sender — no reply, never reaches a model
    }

    // ── Gate #2: DMs only ──
    if (!dm.isDm) return;

    const content = dm.content.trim();
    if (!content) return; // attachment/sticker-only message — nothing to answer

    const stopTyping = this.startTypingLoop(dm.channel);
    try {
      // Pinned to the DM's current mode (agent). Chat has no tools;
      // Code/Research may pause → delivered as approval buttons.
      const result = await this.runGeneration({
        conversationId: this.conversationId(),
        mode: 'send',
        content,
        targetAgentId: this.currentAgentId(),
      });
      await this.deliverResult(dm.channel, result);
    } catch (err) {
      // Honest failure — real reason, no fabrication, never silence.
      const reason = err instanceof Error ? err.message : String(err);
      await dm.channel.send(`I couldn't generate a reply: ${reason}`).catch(() => {
        logger.error('Failed to deliver the error reply to Discord', { error: reason });
      });
    } finally {
      stopTyping();
    }
  }

  /**
   * Run one turn through ChatService.generate() — the exact path the web
   * chat uses (identity + memory + persistence + the SAME tool loop and
   * pause/resume/TTL mechanism). Returns the final text and/or a pause
   * that needs approval. Works for both a fresh 'send' and a 'resume'.
   */
  private async runGeneration(params: GenerateParams): Promise<GenResult> {
    let text = '';
    let pending: PendingInfo | undefined;
    await chatService.generate(params, {
      onMeta: () => { /* reply is sent whole — no live editing */ },
      onToken: () => { /* ignored: typing indicator covers liveness */ },
      onDone: (message) => { text = message.content; },
      onPending: (info) => { pending = { agentName: info.agentName, items: info.pendingConfirmations }; },
    });
    return { text, pending };
  }

  /**
   * Deliver a turn's outcome to a DM channel: an approval card per pending
   * call (with real Approve/Deny buttons), or the reply text split to
   * Discord's length limit.
   */
  private async deliverResult(channel: DmChannelLike, result: GenResult): Promise<void> {
    if (result.pending) {
      await this.sendApprovalCards(channel, result.pending);
      return;
    }
    const chunks = splitDiscordMessage(result.text);
    if (chunks.length === 0) {
      await channel.send('The model finished without producing any reply text.');
      return;
    }
    for (const chunk of chunks) await channel.send(chunk);
  }

  /** One embed + Approve/Deny button row per pending confirmation. The
   *  confirmation id rides in each button's customId so the handler can
   *  resume the exact paused turn. */
  private async sendApprovalCards(channel: DmChannelLike, pending: PendingInfo): Promise<void> {
    for (const item of pending.items) {
      const argsText = this.truncateForField(JSON.stringify(item.args ?? {}, null, 2));
      const embed = new EmbedBuilder()
        .setTitle('Approval required')
        .setColor(0xE8B25A)
        .setDescription(`**${pending.agentName}** wants to run \`${item.plugin}/${item.action}\``)
        .addFields({ name: 'Arguments', value: '```json\n' + argsText + '\n```' });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${BTN_PREFIX}:approve:${item.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${BTN_PREFIX}:deny:${item.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
      );
      await channel.send({ embeds: [embed], components: [row] });
    }
  }

  /** Keep an args block inside Discord's 1024-char embed-field limit. */
  private truncateForField(s: string, max = 900): string {
    return s.length <= max ? s : s.slice(0, max) + '\n…[truncated]';
  }

  // ── Interactions: slash commands + approval buttons ─────────────

  /** Route an interaction to the slash-command or button handler. Both
   *  begin by verifying the ACTOR is the allowlisted user. */
  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) { await this.handleSlashCommand(interaction); return; }
    if (interaction.isButton()) { await this.handleButton(interaction); return; }
  }

  /** /chat, /code, /research — switch which agent answers this DM. */
  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // ── Same allowlist gate as messages: verify the INVOKER's id ──
    if (!this.isAllowed(interaction.user.id)) {
      logger.warn(`Rejected Discord slash command from non-allowed user (id …${interaction.user.id.slice(-4)})`);
      await interaction.reply({ content: 'You are not authorized to use this bot.', ephemeral: true }).catch(() => {});
      return;
    }
    const mode = MODE_BY_COMMAND[interaction.commandName];
    if (!mode) {
      await interaction.reply({ content: 'Unknown command.', ephemeral: true }).catch(() => {});
      return;
    }
    this.setAgentId(mode.agentId);
    logger.info(`Discord mode switched to ${mode.label} (${mode.agentId})`);
    await interaction.reply({
      content: `Switched to **${mode.label}** mode. Messages in this DM now go to ${mode.label}.`,
      ephemeral: true,
    }).catch(() => {});
  }

  /**
   * Approve/Deny buttons on a paused confirmation.
   * CRITICAL: the button CLICKER's id is verified against the allowlist —
   * seeing the embed is NOT enough. Only the allowlisted user can approve.
   * Approve resumes through the existing confirmedToolCallIds mechanism;
   * Deny just dismisses (the paused turn expires via its own TTL).
   */
  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    // ── The clicker-identity check — the security crux of this feature ──
    if (!this.isAllowed(interaction.user.id)) {
      logger.warn(`Rejected Discord button click from non-allowed user (id …${interaction.user.id.slice(-4)})`);
      await interaction.reply({
        content: 'You are not authorized to approve or deny this action.',
        ephemeral: true,
      }).catch(() => {});
      return;
    }

    const parts = interaction.customId.split(':'); // lum:<approve|deny>:<confirmationId>
    if (parts[0] !== BTN_PREFIX || parts.length < 3) return; // not ours — ignore
    const action = parts[1];
    const confirmationId = parts.slice(2).join(':');
    const keptEmbeds = interaction.message.embeds;

    if (action === 'deny') {
      denyPendingConfirmations(this.conversationId(), [confirmationId]);
      await interaction.update({
        content: '🚫 Denied — nothing was run. The pending turn has been revoked.',
        embeds: keptEmbeds,
        components: [],
      }).catch(() => {});
      logger.info('Discord approval denied by user; pending turn revoked.');
      return;
    }
    if (action !== 'approve') return;

    // Ack within Discord's 3s window and strip the buttons so the action
    // can't be double-approved, THEN run the (possibly slow) resume.
    await interaction.update({ content: '✅ Approved — running…', embeds: keptEmbeds, components: [] }).catch(() => {});

    const channel = this.channelFromInteraction(interaction);
    const stopTyping = channel ? this.startTypingLoop(channel) : () => {};
    try {
      const result = await this.runGeneration({
        conversationId: this.conversationId(),
        mode: 'resume',
        confirmedToolCallIds: [confirmationId],
        targetAgentId: this.currentAgentId(),
      });
      if (channel) await this.deliverResult(channel, result);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (channel) await channel.send(`I couldn't complete the approved action: ${reason}`).catch(() => {});
      logger.error('Discord approval resume failed', { error: reason });
    } finally {
      stopTyping();
    }
  }

  /** Wrap an interaction's DM channel in the structural send surface. We
   *  send follow-ups through the channel (not interaction.followUp) so a
   *  slow resume can't outlive the 15-min interaction token. */
  private channelFromInteraction(interaction: ButtonInteraction): DmChannelLike | null {
    const ch = interaction.channel as unknown as (Partial<DmChannelLike> & { sendTyping?: () => Promise<void> }) | null;
    if (!ch || typeof ch.send !== 'function') return null;
    return {
      sendTyping: () => ch.sendTyping?.() ?? Promise.resolve(),
      send: (payload: DiscordSendable) => ch.send!(payload),
    };
  }

  // ── Per-DM mode + persistent conversation ───────────────────────

  /** The agent currently answering this DM (persisted; default Chat). */
  private currentAgentId(): string {
    return this.convStore.load().agentId || DEFAULT_AGENT_ID;
  }

  /** Persist the selected agent without disturbing the conversation id. */
  private setAgentId(agentId: string): void {
    const cur = this.convStore.load();
    this.convStore.save({ ...cur, agentId });
  }

  /** The bridge's persistent conversation, revalidated every call. */
  private conversationId(): string {
    const saved = this.convStore.load();
    if (saved.conversationId) {
      try { chatService.get(saved.conversationId); return saved.conversationId; } catch { /* deleted in the UI — recreate */ }
    }
    const conv = chatService.create('Discord');
    this.convStore.save({ ...saved, conversationId: conv.id });
    logger.info('Discord bridge conversation created (visible in the web chat list).');
    return conv.id;
  }

  /** Keep the typing indicator alive while a slow local model works. */
  private startTypingLoop(channel: DmChannelLike): () => void {
    const kick = () => { void channel.sendTyping().catch(() => { /* typing is best-effort */ }); };
    kick();
    const timer = setInterval(kick, TYPING_INTERVAL_MS);
    return () => clearInterval(timer);
  }

  /** Kernel shutdown: stop polling and disconnect cleanly. */
  async stop(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.client) {
      await this.client.destroy().catch(() => { /* best-effort at exit */ });
      this.client = null;
    }
    this.started = false;
  }
}

export const discordBridge = new DiscordBridge();
