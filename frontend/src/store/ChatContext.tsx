// ============================================================
// ChatContext — keeps the live chat session mounted for the
// lifetime of the app, not just while the Chat page is visible.
//
// App.tsx swaps pages with <AnimatePresence mode="wait">, which
// fully unmounts the outgoing page. useChat() used to live inside
// Chat.tsx, so navigating away mid-generation destroyed its state
// (streaming, streamMeta, the growing message) — the reply kept
// generating on the backend, but the UI had nothing left to show
// it on. Hoisting the single useChat() instance up to this
// always-mounted provider lets generation survive page switches;
// Chat.tsx now just reads the shared instance.
// ============================================================

import { createContext, useContext, type ReactNode } from 'react';
import { useChat } from '@/hooks/useChat';

type ChatContextValue = ReturnType<typeof useChat>;

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const chat = useChat();
  return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within a ChatProvider');
  return ctx;
}
