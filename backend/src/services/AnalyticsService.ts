// ============================================================
// AnalyticsService — real usage analytics over the persisted
// chat history. Every number here is COMPUTED from actual stored
// messages (ChatService's conversations.json) — sessions, message
// counts, active days, streaks, peak hour, per-model usage, and a
// per-day activity calendar. Nothing is estimated: token figures
// come only from messages that actually recorded them, and where a
// value cannot be determined it is reported as null/0, never guessed.
//
// The Models breakdown is METRIC-ADAPTIVE: once at least half of the
// modelled assistant messages carry real token counts, it reports by
// tokens (like a mature usage dashboard); until then it reports by
// message count — the only fully-accurate "which models did I use
// most" signal for history recorded before per-message token
// accounting existed. The chosen metric is returned so the UI can
// label it honestly.
// ============================================================

import { chatService, type StoredConversation, type StoredMessage } from './ChatService';

export type AnalyticsRange = 'all' | '30d' | '7d';
export type AnalyticsMetric = 'tokens' | 'messages';

export interface AnalyticsModel {
  model: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Share of the active metric (tokens or messages), 0–100. */
  pct: number;
}

export interface AnalyticsDay {
  date: string;                       // YYYY-MM-DD, local time
  count: number;                      // assistant+user messages that day
  tokens: number;                     // real tokens recorded that day
  byModel: Record<string, number>;    // value in the ACTIVE metric, per model
}

export interface AnalyticsComparison {
  label: string;                      // e.g. "a Shakespeare sonnet"
  times: number;                      // totalTokens / reference, ≥ 1
}

export interface Analytics {
  range: AnalyticsRange;
  metric: AnalyticsMetric;
  generatedAt: string;
  totals: {
    sessions: number;
    messages: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    activeDays: number;
    currentStreak: number;
    longestStreak: number;
    peakHour: number | null;          // 0–23 local, null if no data
    favoriteModel: string | null;
  };
  models: AnalyticsModel[];           // sorted desc by active metric
  daily: AnalyticsDay[];              // active days only, ascending — the bar chart
  calendar: AnalyticsDay[];           // every day in the window (incl. empty) — the heatmap
  comparison: AnalyticsComparison | null;
}

// ── Local-time date helpers (a local desktop app: server tz = user tz) ──
const pad = (n: number) => String(n).padStart(2, '0');
/** YYYY-MM-DD in LOCAL time (so days line up with the user's clock). */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Midnight local for a given date key. */
function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((keyToDate(localDateKey(b)).getTime() - keyToDate(localDateKey(a)).getTime()) / 86_400_000);
}

// Reference "sizes" for the playful footer comparison, in tokens. The
// largest one below the user's total is chosen so the multiple is always
// a meaningful "N×" for any history size, tiny or huge. Approximate token
// counts for well-known texts (words × ~1.33).
const REFERENCES: Array<{ label: string; tokens: number }> = [
  { label: 'a text message', tokens: 20 },
  { label: 'a Shakespeare sonnet', tokens: 200 },
  { label: 'a short story', tokens: 2_600 },
  { label: 'a college essay', tokens: 6_500 },
  { label: 'Animal Farm', tokens: 39_000 },
  { label: 'The Great Gatsby', tokens: 63_000 },
  { label: 'Harry Potter and the Philosopher’s Stone', tokens: 104_000 },
  { label: 'the Lord of the Rings trilogy', tokens: 630_000 },
  { label: 'the entire Bible', tokens: 800_000 },
];

export class AnalyticsService {
  /**
   * @param range  Time window: all / 30d / 7d.
   * @param agent  Optional agent id (e.g. 'coding-agent') to scope the whole
   *   report to ONE agent's usage. When set, a message counts only if it
   *   belongs to a conversation that used that agent AND it is either a user
   *   prompt or an assistant reply produced BY that agent. So "code" analytics
   *   reflect only the CodingAgent — zero until you actually use it, then real.
   */
  compute(range: AnalyticsRange = 'all', agent?: string): Analytics {
    const conversations = chatService.allConversations();
    const now = new Date();
    const todayKey = localDateKey(now);

    // Agent scoping predicate. A conversation is "in scope" if it is pinned to
    // the agent or contains any assistant reply from it (catches conversations
    // whose mode was later switched). Within such a conversation, user messages
    // always count; assistant messages count only if that agent produced them.
    const filter = agent && agent.trim() ? agent.trim() : null;
    const convInScope = (c: StoredConversation): boolean =>
      !filter || c.agentId === filter || c.messages.some((m) => m.role === 'assistant' && m.agentId === filter);
    const scopeCache = new Map<string, boolean>();
    const inScope = (c: StoredConversation, m: StoredMessage): boolean => {
      if (!filter) return true;
      let ok = scopeCache.get(c.id);
      if (ok === undefined) { ok = convInScope(c); scopeCache.set(c.id, ok); }
      if (!ok) return false;
      return m.role !== 'assistant' || m.agentId === filter;
    };

    // Range window [startKey, todayKey]. 'all' starts at the first message
    // (or 15 weeks back, whichever is earlier, so the heatmap has a canvas).
    const firstMsgDate = this.firstMessageDate(conversations, inScope);
    let windowStart: Date;
    if (range === '7d') windowStart = addDays(now, -6);
    else if (range === '30d') windowStart = addDays(now, -29);
    else {
      const fallback = addDays(now, -7 * 15); // ≥15 week columns for the grid
      windowStart = firstMsgDate && firstMsgDate < fallback ? firstMsgDate : fallback;
    }
    const startKey = localDateKey(windowStart);

    // ── Single pass: collect in-range messages, bucket by day/model/hour ──
    const inRange = (m: StoredMessage): boolean => {
      const k = localDateKey(new Date(m.createdAt));
      return k >= startKey && k <= todayKey;
    };

    const sessions = conversations.filter((c) => c.messages.some((m) => inScope(c, m) && inRange(m))).length;
    let messages = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let modelledAssistant = 0;      // assistant msgs that name a model
    let modelledWithTokens = 0;     // …of those, how many recorded tokens

    const hourCounts = new Array<number>(24).fill(0);
    const activeDayKeys = new Set<string>();
    const perModelMsgs = new Map<string, number>();
    const perModelIn = new Map<string, number>();
    const perModelOut = new Map<string, number>();
    // date -> { count, tokens, byModelTokens, byModelMsgs }
    const dayAgg = new Map<string, { count: number; tokens: number; tok: Map<string, number>; msg: Map<string, number> }>();

    const bump = (map: Map<string, number>, key: string, by: number) => map.set(key, (map.get(key) ?? 0) + by);
    const dayOf = (key: string) => {
      let d = dayAgg.get(key);
      if (!d) { d = { count: 0, tokens: 0, tok: new Map(), msg: new Map() }; dayAgg.set(key, d); }
      return d;
    };

    for (const conv of conversations) {
      for (const m of conv.messages) {
        if (!inScope(conv, m) || !inRange(m)) continue;
        const when = new Date(m.createdAt);
        const key = localDateKey(when);
        messages++;
        activeDayKeys.add(key);
        hourCounts[when.getHours()]++;
        const day = dayOf(key);
        day.count++;

        if (m.role !== 'assistant') continue;
        const model = m.model ?? null;
        const inTok = typeof m.inputTokens === 'number' && m.inputTokens >= 0 ? m.inputTokens : 0;
        const outTok = typeof m.outputTokens === 'number' && m.outputTokens >= 0 ? m.outputTokens : 0;
        const hasTokens = typeof m.inputTokens === 'number' || typeof m.outputTokens === 'number';
        inputTokens += inTok;
        outputTokens += outTok;
        day.tokens += inTok + outTok;

        if (model) {
          modelledAssistant++;
          if (hasTokens) modelledWithTokens++;
          bump(perModelMsgs, model, 1);
          bump(perModelIn, model, inTok);
          bump(perModelOut, model, outTok);
          bump(day.msg, model, 1);
          bump(day.tok, model, inTok + outTok);
        }
      }
    }

    const totalTokens = inputTokens + outputTokens;

    // Metric choice: tokens only once they cover the majority of modelled
    // messages AND there is a nonzero total — otherwise message counts,
    // the only accurate historical signal.
    const metric: AnalyticsMetric =
      totalTokens > 0 && modelledAssistant > 0 && modelledWithTokens / modelledAssistant >= 0.5
        ? 'tokens'
        : 'messages';

    // ── Models, ranked by the active metric ──
    const modelNames = new Set<string>([...perModelMsgs.keys()]);
    const modelValue = (name: string) =>
      metric === 'tokens' ? (perModelIn.get(name) ?? 0) + (perModelOut.get(name) ?? 0) : perModelMsgs.get(name) ?? 0;
    const metricTotal = [...modelNames].reduce((s, n) => s + modelValue(n), 0);
    const models: AnalyticsModel[] = [...modelNames]
      .map((name) => ({
        model: name,
        messages: perModelMsgs.get(name) ?? 0,
        inputTokens: perModelIn.get(name) ?? 0,
        outputTokens: perModelOut.get(name) ?? 0,
        totalTokens: (perModelIn.get(name) ?? 0) + (perModelOut.get(name) ?? 0),
        pct: metricTotal > 0 ? Math.round((modelValue(name) / metricTotal) * 1000) / 10 : 0,
      }))
      .sort((a, b) => modelValue(b.model) - modelValue(a.model) || b.messages - a.messages);

    // ── Per-day series (active days → bar chart; full window → heatmap) ──
    const dayToAnalytics = (key: string): AnalyticsDay => {
      const d = dayAgg.get(key);
      const src = metric === 'tokens' ? d?.tok : d?.msg;
      const byModel: Record<string, number> = {};
      if (src) for (const [k, v] of src) byModel[k] = v;
      return { date: key, count: d?.count ?? 0, tokens: d?.tokens ?? 0, byModel };
    };
    const daily = [...activeDayKeys].sort().map(dayToAnalytics);

    const calendar: AnalyticsDay[] = [];
    for (let d = keyToDate(startKey); localDateKey(d) <= todayKey; d = addDays(d, 1)) {
      calendar.push(dayToAnalytics(localDateKey(d)));
    }

    // ── Streaks (over the FULL history, not just the range, so "current
    //    streak" is honest even on a 7d view) and peak hour / favorite. ──
    const allActive = this.allActiveDayKeys(conversations, inScope);
    const { current, longest } = this.streaks(allActive, todayKey);
    const peakHour = messages > 0 ? hourCounts.indexOf(Math.max(...hourCounts)) : null;
    const favoriteModel = models.length ? [...perModelMsgs.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;

    return {
      range,
      metric,
      generatedAt: now.toISOString(),
      totals: {
        sessions,
        messages,
        totalTokens,
        inputTokens,
        outputTokens,
        activeDays: activeDayKeys.size,
        currentStreak: current,
        longestStreak: longest,
        peakHour,
        favoriteModel,
      },
      models,
      daily,
      calendar,
      comparison: this.comparison(totalTokens),
    };
  }

  private firstMessageDate(
    conversations: readonly StoredConversation[],
    inScope: (c: StoredConversation, m: StoredMessage) => boolean,
  ): Date | null {
    let min: number | null = null;
    for (const c of conversations) {
      for (const m of c.messages) {
        if (!inScope(c, m)) continue;
        const t = new Date(m.createdAt).getTime();
        if (Number.isFinite(t) && (min === null || t < min)) min = t;
      }
    }
    return min === null ? null : new Date(min);
  }

  private allActiveDayKeys(
    conversations: readonly StoredConversation[],
    inScope: (c: StoredConversation, m: StoredMessage) => boolean,
  ): Set<string> {
    const s = new Set<string>();
    for (const c of conversations) for (const m of c.messages) if (inScope(c, m)) s.add(localDateKey(new Date(m.createdAt)));
    return s;
  }

  /**
   * Current streak = consecutive active days ending today, or ending
   * yesterday if today has no activity yet (the streak is still alive).
   * Longest streak = the longest consecutive run anywhere in history.
   */
  private streaks(activeKeys: Set<string>, todayKey: string): { current: number; longest: number } {
    if (activeKeys.size === 0) return { current: 0, longest: 0 };
    const today = keyToDate(todayKey);

    // Current: walk backwards from today (or yesterday) while days are active.
    let anchor = activeKeys.has(todayKey) ? today : addDays(today, -1);
    let current = 0;
    if (activeKeys.has(localDateKey(anchor))) {
      while (activeKeys.has(localDateKey(anchor))) {
        current++;
        anchor = addDays(anchor, -1);
      }
    }

    // Longest: sort keys, count consecutive runs.
    const sorted = [...activeKeys].sort();
    let longest = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
      const gap = daysBetween(keyToDate(sorted[i - 1]), keyToDate(sorted[i]));
      run = gap === 1 ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    return { current, longest };
  }

  private comparison(totalTokens: number): AnalyticsComparison | null {
    if (totalTokens <= 0) return null;
    // Largest reference at or below the total → a meaningful "N×".
    let ref = REFERENCES[0];
    for (const r of REFERENCES) if (r.tokens <= totalTokens) ref = r;
    const times = Math.round((totalTokens / ref.tokens) * 10) / 10;
    return { label: ref.label, times: Math.max(1, times) };
  }
}

export const analyticsService = new AnalyticsService();
