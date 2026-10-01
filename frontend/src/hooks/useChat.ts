// ============================================================
// useChat — Real streaming chat sessions against local Ollama.
//
// Owns the conversation list, the active conversation's
// messages, and the streaming lifecycle (send / stop /
// regenerate / continue). All state is persisted server-side,
// so sessions survive app restarts. Failures surface as honest
// error messages — never fabricated responses.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { chatApi } from '@/services/api';
import type { ToolActivity } from '@/services/api';
import { getPrefs } from '@/lib/prefs';
import type { ChatMessage, ConversationSummary, PendingConfirmation } from '@/types';

export interface StreamMeta {
  agentId: string;
  agentName: string;
  model: string;
  messageId: string;
}

/** A tool-capable agent's turn paused, awaiting Approve/Cancel. */
export interface PendingTurn {
  agentId: string;
  agentName: string;
  model?: string;
  items: PendingConfirmation[];
}

/** One REAL tool invocation observed in the event stream (Agent view table). */
export interface ToolLogRow {
  id: string;
  plugin: string;
  action: string;
  args?: Record<string, unknown>;
  status: 'running' | 'ok' | 'failed';
  summary?: string;
  startedAt: string;
  endedAt?: string;
}

export const DEFAULT_AGENT_ID = 'conversation-agent';

export function useChat() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId]           = useState<string | null>(null);
  const [messages, setMessages]           = useState<ChatMessage[]>([]);
  const [agentId, setAgentIdState]        = useState<string>(DEFAULT_AGENT_ID);
  const [pending, setPending]             = useState<PendingTurn | null>(null);
  const [loading, setLoading]             = useState(true);
  const [streaming, setStreaming]         = useState(false);
  const [streamMeta, setStreamMeta]       = useState<StreamMeta | null>(null);
  const [toolActivity, setToolActivity]   = useState<ToolActivity | null>(null);
  const [thinking, setThinking]           = useState<string>('');
  const [error, setError]                 = useState<string | null>(null);
  // Composer draft lives here (not in Chat.tsx) so a half-typed message
  // survives page switches and the Dashboard↔Professional layout swap,
  // both of which unmount the Chat component.
  const [draft, setDraft]                 = useState<string>('');
  // Running log of REAL tool calls streamed during generations of the
  // ACTIVE conversation (tool_call_started / tool_call_result events).
  // Ephemeral session state — cleared when switching conversations,
  // never persisted, never seeded with placeholder rows.
  const [toolLog, setToolLog]             = useState<ToolLogRow[]>([]);

  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const agentIdRef = useRef<string>(DEFAULT_AGENT_ID);
  agentIdRef.current = agentId;
  const abortRef = useRef<AbortController | null>(null);
  const generationIdRef = useRef<string | null>(null);

  // ── Loading ─────────────────────────────────────────────────

  const refreshList = useCallback(async () => {
    const list = await chatApi.listConversations();
    setConversations(list);
    return list;
  }, []);

  const openConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setError(null);
    setPending(null);
    setToolLog([]);   // the tool log belongs to one conversation's session
    try {
      const conv = await chatApi.getConversation(id);
      // Guard against stale loads after quick switching
      if (activeIdRef.current === id) {
        setMessages(conv.messages);
        setAgentIdState(conv.agentId || DEFAULT_AGENT_ID);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation');
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await refreshList();
        if (list.length > 0) await openConversation(list[0].id);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load conversations');
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshList, openConversation]);

  // ── Conversation management ─────────────────────────────────

  /**
   * A genuinely clean slate — Claude-style landing state. Purely local:
   * NOTHING is created or persisted server-side until the first message
   * is sent (send() lazily creates the conversation then). The previous
   * behaviour (reuse-an-empty-conversation, else create-and-persist
   * immediately) is what made "New Chat" land inside an existing listed
   * conversation — and a stale messageCount could even open one that
   * had since gained real messages.
   */
  const newConversation = useCallback(() => {
    activeIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    setPending(null);
    setToolLog([]);
    setError(null);
    // The selected mode (Chat / Agent / Deep Research) carries over to
    // the fresh prompt — it is applied when the conversation is created.
  }, []);

  /** Reflect a completed history wipe without remounting ChatProvider. */
  const resetHistory = useCallback(() => {
    abortRef.current?.abort();
    generationIdRef.current = null;
    activeIdRef.current = null;
    setActiveId(null);
    setConversations([]);
    setMessages([]);
    setPending(null);
    setToolLog([]);
    setToolActivity(null);
    setStreamMeta(null);
    setThinking('');
    setStreaming(false);
    setError(null);
  }, []);

  /** Reconcile a partial history wipe while retaining surviving chats. */
  const reconcileHistory = useCallback(async () => {
    const list = await refreshList();
    if (generationIdRef.current && !list.some(item => item.id === generationIdRef.current)) {
      abortRef.current?.abort();
    }
    const visible = activeIdRef.current;
    if (visible && !list.some(item => item.id === visible)) newConversation();
  }, [refreshList, newConversation]);

  /** Switch which agent (Chat / Agent / Deep Research) this conversation uses. */
  const setMode = useCallback(async (nextAgentId: string) => {
    if (streaming) return;
    const id = activeIdRef.current;
    const previous = agentIdRef.current;
    setAgentIdState(nextAgentId);
    setPending(null); // a paused turn belongs to the previous agent — it can no longer be resumed
    // Fresh unpersisted chat: nothing to PATCH yet — the choice is local
    // state and generate() pins it onto the conversation at creation.
    if (!id) return;
    try {
      await chatApi.setConversationAgent(id, nextAgentId);
    } catch (err) {
      setAgentIdState(previous);
      setError(err instanceof Error ? err.message : 'Failed to switch mode');
    }
  }, [streaming]);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await chatApi.deleteConversation(id);
      const list = await refreshList();
      if (activeIdRef.current === id) {
        if (list.length > 0) await openConversation(list[0].id);
        else { setActiveId(null); setMessages([]); setToolLog([]); }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete conversation');
    }
  }, [refreshList, openConversation]);

  // ── Generation ──────────────────────────────────────────────

  const runGeneration = useCallback(async (
    conversationId: string,
    mode: 'send' | 'regenerate' | 'continue' | 'resume',
    content?: string,
    confirmedToolCallIds?: string[],
  ) => {
    setStreaming(true);
    setError(null);
    setPending(null);
    setToolActivity(null);
    setThinking('');
    const controller = new AbortController();
    abortRef.current = controller;
    generationIdRef.current = conversationId;

    /** Apply a message-list update only while this conversation is visible. */
    const patch = (fn: (prev: ChatMessage[]) => ChatMessage[]) => {
      if (activeIdRef.current === conversationId) setMessages(fn);
    };

    // Settings are read at send time so changes apply immediately.
    // With streaming display off, tokens still arrive but the reply
    // is revealed at once via onDone — no fake typing.
    const prefs = getPrefs();

    let meta: StreamMeta | null = null;
    try {
      await chatApi.generate(
        {
          conversationId, mode, content,
          targetAgentId: agentIdRef.current,
          confirmedToolCallIds,
          temperature: prefs.temperature ?? undefined,
          contextLength: prefs.contextLength ?? undefined,
        },
        {
          onMeta: (m) => {
            meta = m;
            setStreamMeta(m);
            // In reveal-at-once mode there is no placeholder — the
            // thinking indicator stays until the reply is complete.
            if (mode !== 'continue' && prefs.streamTokens) {
              // Placeholder that fills up token by token
              patch((prev) => [...prev, {
                id: m.messageId,
                role: 'assistant',
                content: '',
                agentId: m.agentId,
                agentName: m.agentName,
                model: m.model,
                createdAt: new Date().toISOString(),
              }]);
            }
          },
          onToken: (token) => {
            if (!prefs.streamTokens) return;   // reveal-at-once mode
            const id = meta?.messageId;
            if (!id) return;
            patch((prev) => prev.map((msg) =>
              msg.id === id ? { ...msg, content: msg.content + token } : msg
            ));
          },
          onDone: (message) => {
            patch((prev) => {
              const has = prev.some((msg) => msg.id === message.id);
              if (!has) return message.content ? [...prev, message] : prev;
              // Empty content means the turn was stopped before any token
              if (!message.content) return prev.filter((msg) => msg.id !== message.id);
              return prev.map((msg) => (msg.id === message.id ? message : msg));
            });
          },
          onPending: (info) => {
            if (activeIdRef.current === conversationId) {
              setPending({ agentId: info.agentId, agentName: info.agentName, model: info.model, items: info.pendingConfirmations });
            }
          },
          onToolActivity: (activity) => {
            if (activeIdRef.current !== conversationId) return;
            setToolActivity(activity);
            // Grow the Agent-view table from the same REAL event stream:
            // 'started' appends a running row; 'result' resolves the most
            // recent still-running row for that plugin/action.
            if (activity.phase === 'started') {
              setToolLog((prev) => [...prev, {
                id: `tl-${Date.now().toString(36)}-${prev.length}`,
                plugin: activity.plugin,
                action: activity.action,
                args: activity.args,
                status: 'running',
                startedAt: new Date().toISOString(),
              }]);
            } else {
              setToolLog((prev) => {
                const idx = [...prev].reverse().findIndex(
                  (r) => r.status === 'running' && r.plugin === activity.plugin && r.action === activity.action,
                );
                if (idx === -1) return prev;
                const real = prev.length - 1 - idx;
                return prev.map((r, i) => (i === real ? {
                  ...r,
                  status: activity.success === false ? 'failed' as const : 'ok' as const,
                  summary: activity.summary,
                  endedAt: new Date().toISOString(),
                } : r));
              });
            }
          },
          onThinking: (delta) => {
            if (activeIdRef.current === conversationId) setThinking((prev) => prev + delta);
          },
          onError: (msg) => {
            setError(msg);
            // Drop an empty placeholder — never show a fake reply
            const id = meta?.messageId;
            if (id) patch((prev) => prev.filter((m) => m.id !== id || m.content.length > 0));
          },
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Generation failed');
        const id = (meta as StreamMeta | null)?.messageId;
        if (id) patch((prev) => prev.filter((m) => m.id !== id || m.content.length > 0));
      }
    } finally {
      if (abortRef.current === controller) {
        setStreaming(false);
        setStreamMeta(null);
        setToolActivity(null);
        setThinking('');
        abortRef.current = null;
        generationIdRef.current = null;
      }
      refreshList().catch(() => { /* list refresh is best-effort */ });
    }
  }, [refreshList]);

  const send = useCallback(async (content: string) => {
    const text = content.trim();
    if (!text || streaming) return;

    let conversationId = activeIdRef.current;
    try {
      if (!conversationId) {
        const conv = await chatApi.createConversation();
        conversationId = conv.id;
        setActiveId(conv.id);
        setMessages([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create conversation');
      return;
    }

    // Optimistic user message (server persists the real one)
    setMessages((prev) => [...prev, {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }]);

    await runGeneration(conversationId, 'send', text);
  }, [streaming, runGeneration]);

  const stop = useCallback(async () => {
    const id = generationIdRef.current;
    if (!id) return;
    try {
      await chatApi.stop(id);
    } catch {
      // Backend unreachable — abort the stream locally as a fallback
      abortRef.current?.abort();
      setStreaming(false);
    }
  }, []);

  const regenerate = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id || streaming) return;
    // Server drops the trailing assistant message; mirror locally
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      return last?.role === 'assistant' ? prev.slice(0, -1) : prev;
    });
    await runGeneration(id, 'regenerate');
  }, [streaming, runGeneration]);

  const continueGeneration = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id || streaming) return;
    await runGeneration(id, 'continue');
  }, [streaming, runGeneration]);

  /** Approve one paused tool call and resume the turn that proposed it. */
  const approve = useCallback(async (confirmationId: string) => {
    const id = activeIdRef.current;
    if (!id || streaming) return;
    await runGeneration(id, 'resume', undefined, [confirmationId]);
  }, [streaming, runGeneration]);

  /** Drop a paused turn without approving anything — nothing was done. */
  const cancelPending = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id || !pending) return false;
    try {
      await chatApi.deny(id, pending.items.map(item => item.id));
      setPending(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke pending actions.');
      return false;
    }
  }, [pending]);

  return {
    conversations, activeId, messages, agentId, pending, loading, streaming, streamMeta, toolActivity, toolLog, thinking, error,
    draft, setDraft,
    openConversation, newConversation, deleteConversation, resetHistory, reconcileHistory,
    send, stop, regenerate, continueGeneration, setMode, approve, cancelPending,
    clearError: () => setError(null),
  };
}
