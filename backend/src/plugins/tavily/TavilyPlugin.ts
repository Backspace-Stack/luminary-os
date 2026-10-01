// ============================================================
// TavilyPlugin — Real web search via the Tavily API.
//
// One capability: `search`. Uses the built-in fetch (no SDK, no new
// dependency). The API key is resolved LIVE per request from
// SecretsService (a key saved in the Integrations settings, or the
// TAVILY_API_KEY env var as fallback) — so pasting a key in the UI
// takes effect immediately, no restart. When no key is set, or the
// network/API fails, this returns an honest success:false — it NEVER
// fabricates a result list. Read-only, so requiresConfirmation is false.
// ============================================================

import { BasePlugin } from '../BasePlugin';
import type { PluginAction, PluginResult, PluginManifest } from '../../core/types/IPlugin';
import { secretsService } from '../../services/SecretsService';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_CAP = 10;

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}
interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

export class TavilyPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'tavily-plugin',
    name: 'Tavily Search Plugin',
    version: '0.1.0',
    description: 'Live web search via the Tavily API — returns real results or an honest failure.',
    capabilities: [
      {
        action: 'search',
        description: 'Search the web for current information and return ranked results with source URLs.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query.' },
            maxResults: { type: 'number', description: `How many results to return (1–${MAX_RESULTS_CAP}, default ${DEFAULT_MAX_RESULTS}).` },
          },
          required: ['query'],
        },
        requiresConfirmation: false, // read-only
      },
    ],
    requiresConfig: ['TAVILY_API_KEY'],
  };

  protected async onInitialize(): Promise<void> {
    // Key is resolved live per request, so we only report presence here —
    // never the value. May be set later via the Integrations settings.
    const configured = secretsService.resolve('tavily') !== null;
    this.logger.info(`TavilyPlugin ready — API key ${configured ? 'present' : 'not set yet (set it in Integrations settings; search fails honestly until then)'}`);
  }

  async execute(action: PluginAction): Promise<PluginResult> {
    if (action.action !== 'search') return this.notImplemented(action.action);
    return this.search(action);
  }

  private async search(action: PluginAction): Promise<PluginResult> {
    // Resolved live: a key just saved in the Integrations settings is
    // used on the very next request, no restart.
    const apiKey = secretsService.resolve('tavily');
    if (!apiKey) {
      // Honest failure — no key, no fabricated results.
      return { success: false, error: 'Web search is unavailable: no Tavily API key is set. Add one in Settings → Integrations.' };
    }

    const query = typeof action.payload.query === 'string' ? action.payload.query.trim() : '';
    if (!query) return { success: false, error: 'search requires a non-empty "query" string.' };

    const requested = Number(action.payload.maxResults);
    const maxResults = Number.isFinite(requested)
      ? Math.min(MAX_RESULTS_CAP, Math.max(1, Math.floor(requested)))
      : DEFAULT_MAX_RESULTS;

    this.logger.info(`search "${query}" (maxResults=${maxResults})`, { requestId: action.requestId });

    let res: Response;
    try {
      res = await fetch(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: maxResults,
          search_depth: 'basic',
          include_answer: true,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network error / timeout — surface it, don't invent results.
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Web search failed to reach Tavily: ${msg}` };
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as Record<string, unknown>;
        // Tavily returns the error under `error`, `detail`, or `message`,
        // sometimes as a nested object — coerce to a readable string
        // rather than letting an object render as "[object Object]".
        const raw = body?.error ?? body?.detail ?? body?.message;
        if (typeof raw === 'string') {
          detail = raw;
        } else if (raw && typeof raw === 'object') {
          const nested = (raw as Record<string, unknown>).error ?? (raw as Record<string, unknown>).message;
          detail = typeof nested === 'string' ? nested : JSON.stringify(raw);
        }
      } catch { /* non-JSON error body — keep the HTTP status */ }
      const hint = res.status === 401 || res.status === 403 ? ' (check that the API key is valid)' : '';
      return { success: false, error: `Web search failed: ${detail}${hint}` };
    }

    let json: TavilyResponse;
    try {
      json = (await res.json()) as TavilyResponse;
    } catch (err) {
      return { success: false, error: `Web search returned an unreadable response: ${err instanceof Error ? err.message : String(err)}` };
    }

    const results = (json.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.content ?? '',
      score: r.score,
    }));

    return {
      success: true,
      data: {
        query,
        answer: json.answer ?? null, // Tavily's own synthesized answer, if any
        results,
        resultCount: results.length,
      },
    };
  }
}
