// ============================================================
// prefs.ts — Persistent app preferences (Settings page).
//
// Unlike the theme engine (visual identity), these are behavior
// switches. Every preference here is REAL: each one is read by
// live code paths — no placebo toggles.
// ============================================================

import { useSyncExternalStore } from 'react';

export interface AppPrefs {
  /** Show tokens as they generate; off = reveal the reply at once. */
  streamTokens: boolean;
  /** Enter sends (Shift+Enter for newline); off = Ctrl+Enter sends. */
  sendOnEnter: boolean;
  /** Ask before permanently deleting a conversation. */
  confirmDelete: boolean;
  /** Show model performance metadata (duration, tok/s) under replies. */
  showPerf: boolean;
  /** Frost the interface when the window loses focus. */
  privacyBlur: boolean;
  /** Sampling temperature sent with every generation (null = provider default). */
  temperature: number | null;
  /** Context window (num_ctx) for Ollama models (null = provider default). */
  contextLength: number | null;
  /** 4–8 digit PIN. Non-null = lock screen on launch. */
  lockPin: string | null;
}

export const DEFAULT_PREFS: AppPrefs = {
  streamTokens: true,
  sendOnEnter: true,
  confirmDelete: true,
  showPerf: true,
  privacyBlur: false,
  temperature: null,
  contextLength: null,
  lockPin: null,
};

const KEY = 'luminary.prefs.v1';

function sanitize(raw: unknown): AppPrefs {
  const o = (raw ?? {}) as Partial<AppPrefs>;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    streamTokens: bool(o.streamTokens, true),
    sendOnEnter: bool(o.sendOnEnter, true),
    confirmDelete: bool(o.confirmDelete, true),
    showPerf: bool(o.showPerf, true),
    privacyBlur: bool(o.privacyBlur, false),
    temperature: typeof o.temperature === 'number' && Number.isFinite(o.temperature)
      ? Math.min(2, Math.max(0, o.temperature)) : null,
    contextLength: typeof o.contextLength === 'number' && Number.isFinite(o.contextLength)
      ? Math.min(131072, Math.max(512, Math.round(o.contextLength))) : null,
    lockPin: typeof o.lockPin === 'string' && /^\d{4,8}$/.test(o.lockPin) ? o.lockPin : null,
  };
}

let current: AppPrefs = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : DEFAULT_PREFS;
  } catch { return DEFAULT_PREFS; }
})();

const listeners = new Set<() => void>();

export const getPrefs = (): AppPrefs => current;

export function setPrefs(patch: Partial<AppPrefs>): void {
  current = sanitize({ ...current, ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode */ }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePrefs(): [AppPrefs, (patch: Partial<AppPrefs>) => void] {
  const state = useSyncExternalStore(subscribe, getPrefs);
  return [state, setPrefs];
}
