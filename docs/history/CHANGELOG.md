# Changelog

## Milestone 8.4 — Code view layout + model picker (2026-07-24)

Three refinements to Professional mode's **Code** view, matching the
Claude-Code shape:

- **Analytics graph moved to the top-left.** The Code home is now a
  full-width, left-aligned workspace: the usage widget sits in the
  top-left corner instead of the centered reading column.
- **Prompt bar expanded edge-to-edge.** The composer (and the
  tool-activity table) stretch the full width of the Code view rather
  than the ~940px centered column — on a wide window it goes from ~940px
  to the full width (measured 1584px at 1900px viewport). The centered
  column is kept for the Chat view's readability.
- **Real model picker below the send button** (`ModelPicker`). Lists
  every installed, runnable model — Ollama tags **and** GGUF files, live
  via `useModels` (embedding models excluded) — and assigns the chosen
  one to the current mode's agent through the existing agents API, so
  the choice persists and takes effect on the next run. Like Claude
  Code's model selector. Verified: 10 real models listed with
  provider/size; selecting one flips `coding-agent`'s model server-side
  (round-tripped qwen3:8b ↔ qwen2.5:1.5b).

## Milestone 8.3 — Usage analytics in the Code view (2026-07-23)

A real usage dashboard modelled on Claude's "What's up next" home card,
embedded in Professional mode's **Code** view as its home screen (the
empty state, above the tool-activity strip and task input). Every figure
is computed from the user's actual chat history; nothing is placeholder.

**Scoped to the Code agent.** The Code home shows only CodingAgent usage
(`?agent=coding-agent`) — a message counts only if its conversation used
that agent and it is either a user prompt or an assistant reply produced
by it. So the numbers start at ~0 and grow only as you actually use
Code; Chat/Research usage is excluded. (An earlier build put this behind
a separate all-usage "Usage" page, which conflated every mode's data —
replaced by this in-context, code-scoped view.)

### Backend — `AnalyticsService` + `GET /api/chat/analytics?range=all|30d|7d`
- Computes, over the persisted conversations: sessions, messages, total
  tokens (real recorded `inputTokens`/`outputTokens`), active days,
  current & longest streaks, peak hour (local), favourite model, a
  per-day activity calendar, and a per-model / per-day breakdown.
- **Metric-adaptive**: reports by tokens once ≥50% of modelled assistant
  messages carry real token counts, otherwise by message count — the
  only fully-accurate "which models did I use most" signal for history
  recorded before per-message token accounting (M8) existed. The chosen
  metric is returned so the UI labels it honestly. No estimation, ever.
- All local-time date bucketing (a local desktop app), so days line up
  with the user's clock. Streaks computed over full history so "current
  streak" stays honest even on a 7-day view.

### Frontend — `UsageAnalytics`
- **Overview** tab: eight stat tiles + a GitHub-style week-column
  activity calendar (intensity-bucketed) + a playful token comparison
  that picks the largest reference text below your total (e.g. "~4.2×
  more tokens than a Shakespeare sonnet").
- **Models** tab: a per-day stacked bar chart (blue ramp, ranked stack
  order) + a ranked model legend showing real in/out tokens where
  recorded, else message counts, each with its share %. A caption states
  the active metric.
- **All / 30d / 7d** range toggle refetches and recomputes.
- Rendered directly (no exit-gated `AnimatePresence`) so a tab/range
  switch shows immediately even in a backgrounded browser tab.
- Professional-mode only; the dashboard interface is untouched. The chat
  stays mounted, so the analytics home appears only when a Code session
  is empty and gives way to the conversation once a task starts.
- `AnalyticsService.compute(range, agent?)` + `GET
  /api/chat/analytics?range=&agent=`; `UsageAnalytics` takes `agent` and
  `embedded` props.

Verified live and cross-checked against an independent computation:
code-scoped All shows 4 sessions · 14 messages · 0 tokens · 3 active
days · favourite qwen2.5-3b-instruct · models qwen2.5-3b 80% / DeepSeek
20% (qwen3:8b and smollm2 correctly excluded as Chat/Research usage), no
token comparison (0 code tokens yet). Sending a real Code task bumped the
live counts (sessions +1, a new active day, streak recomputed),
confirming it grows with use; endpoint and on-disk store agree exactly.

## Milestone 8.2 — TerminalPlugin works on Windows (2026-07-23)

The Agent (Code) view's tool calls now succeed on Windows. Previously the
allow-list was Unix-flavored (`ls, cat, pwd, echo, git`) and every command
was spawned via `execFile`; on Windows the GNU coreutils are not on the
system PATH (they live in Git's `usr\bin`, deliberately kept off it), so
`ls`/`cat`/`pwd`/`echo` failed with ENOENT and a CodingAgent would burn its
whole tool loop retrying. Observed live: `exec {"command":"ls","args":["-l"]}`
→ `Command "ls" was not found on this host's PATH.`

### Native builtins — nothing spawned
- `ls`, `cat`, `pwd`, `echo` are now implemented **directly in Node**, so
  they work identically on every OS regardless of PATH. They never spawn a
  process and never touch a shell, so a metacharacter is just text
  (`echo "a > b"` works) — the shell-metachar / argv-escape defences that
  guard the spawned path don't apply and aren't run for them.
- `git` still runs as the real program via `execFile` (no shell); it's a
  real `.exe` on the system PATH, which `CreateProcess` resolves.

### Shared sandbox — one boundary, no duplication
- New `plugins/shared/Sandbox.ts` holds the single sandbox-confinement
  implementation (path resolution rejecting lexical escapes, absolute
  paths, protected paths, and symlink escapes) plus `read`/`list`. Both
  **FilePlugin** and **TerminalPlugin** use it, so the native `ls`/`cat`
  enforce the exact same boundary as the file tools — including refusing
  Lumen's identity file (`cat LUMEN.md` is blocked just as `file:read` is).
- FilePlugin was refactored to delegate to `Sandbox`; its public behaviour
  is unchanged (verified: read/write/list/delete/exists, escape rejection,
  protected-path rejection).
- Verified with a harness driving the real plugin code through the same
  `execute({action:'exec'})` entry point the agent loop uses: 20/20 —
  native builtins, every escape/protected-path refusal, `git` spawn, and
  the full FilePlugin surface.

## Milestone 8.1 — Professional mode refinements (2026-07-23)

Five targeted fixes bringing Professional mode closer to Claude's real
interface. Refinement only — no other theme, mode or page was touched.

### New Chat opens a genuinely empty prompt
- `useChat.newConversation()` is now **purely local and synchronous**:
  it clears `activeId` / `messages` / `toolLog` and creates nothing
  server-side. `send()` already lazy-creates the conversation on the
  first message, so nothing is persisted or listed until then.
- Root cause of the old behaviour: `newConversation()` first tried to
  *reuse* an existing `messageCount === 0` conversation (and otherwise
  immediately POSTed a new one), so "New Chat" landed inside a listed
  conversation — and a stale `messageCount` could even open one that
  had since gained real messages.
- `setMode()` no longer early-returns when there is no active
  conversation: the choice is kept as local state and pinned onto the
  conversation at creation via `targetAgentId` (verified: a fresh Code
  session creates its conversation already pinned to `coding-agent`).

### Sidebar: Chat/Code toggle, collapsible recents, hover-expand
- Segmented **Chat / Code** toggle at the very top of the rail
  (Claude's Home/Code). Derived from — and writing through — the
  existing `agentId` mode mechanism; no parallel state.
- **Recents** section collapses/expands from its own header control,
  persisted in `localStorage` (`luminary.pro.recents.v1`). Collapsed
  leaves the rail clean.
- On wide screens the rail collapses to a 52px strip
  (`luminary.pro.rail.v1`). Hovering slides the full rail out as a
  preview over the content (real `transform` transition, 0.3s
  cubic-bezier); clicking the expand control pins it open. A 140ms
  grace period on mouse-out stops the strip↔panel seam from flickering.

### Agent (Code) view — live tool-activity table
- `useChat` accumulates a `toolLog` from the **existing** streamed
  `tool_call_started` / `tool_call_result` events (no backend change):
  'started' appends a `running` row, 'result' resolves the matching row
  to `ok`/`failed` with the real summary. Cleared per conversation,
  never persisted, never seeded with placeholder rows.
- New `ToolActivityTable` renders those rows live (tool, action,
  arguments, status, result) with an honest empty state.
- Verified against a real CodingAgent run on qwen3:8b: the model chose
  `exec {"command":"ls","args":["-l"]}` and the row resolved to
  **failed** — `Command "ls" was not found on this host's PATH.` — the
  real Windows failure, surfaced rather than fabricated.

### Prompt-bar pair
- In Professional's chat view the prompt-bar selector is **Chat / Deep
  Research** (mirroring Claude's Chat/Cowork); Agent moved to the
  sidebar toggle. The dashboard keeps its original three-way selector
  unchanged. Deep Research still routes to `research-agent` through the
  same `setMode` mechanism.

## Milestone 8 — Professional mode & real per-message performance metadata (2026-07-23)

### Professional mode (structural interface mode — not a color theme)
- `ThemeState` gains `ui: 'dashboard' | 'professional'` (Theme Center →
  new **Interface** section). Professional renders a plain, Claude-like
  chat workspace: conversation rail + chat area only. The nav sidebar,
  top bar, Dashboard, Models, Integrations, wallpaper, weather and film
  grain are all structurally absent — not hidden with CSS.
- The Chat/Agent/Deep Research selector stays beside the prompt bar and
  keeps working in both modes.
- Only the accent COLOR is customizable in Professional (rail footer →
  **Appearance** popover, which is also the one-click **Back to
  Dashboard**). Wallpapers/particles stay exclusive to the dashboard.
- Dashboard↔Professional switches cross-fade (shared `AnimatePresence`
  shell swap + the engine's existing mode-transition pulse) — never a
  hard cut. `ChatProvider` sits above the swap, so an in-flight
  generation and the composer draft (now lifted into `useChat`) survive
  switching either way.

### Real per-message performance metadata
- `StoredMessage` gains `inputTokens` / `outputTokens` (Ollama's real
  `prompt_eval_count` / `eval_count`), `contextWindow` and `contextUsed`.
  A new optional provider capability `getLoadedContextWindow()` reads
  the EFFECTIVE runtime context window from `/api/ps` (`context_length`)
  right after the generation — never a hardcoded per-model guess.
- `contextUsed` is a cumulative recurrence over the final model call's
  reported counts, exact under both of Ollama's `prompt_eval_count`
  reporting behaviours (full prompt vs. cached-suffix). Remaining
  context = window − used, computed in the UI.
- `BaseAgent` tool loops additionally report `lastPromptTokens` /
  `lastCompletionTokens` (loop-wide sums re-count re-sent prefixes and
  would inflate context accounting).
- New `MessageStats` component: the familiar agent · model · duration ·
  tok/s row plus an expandable panel (input/output tokens, context
  window, context left). Every value is real or shown as **unknown** —
  never estimated. Verified live against Ollama 0.32.1's reported
  numbers (585/257 tokens, 8192 ctx → 842 used, 7350 left).

## Milestone 7 — Agentic tool use (2026-07-09)

The plugin layer stops being dead code. Agents can now *act*: propose a
tool call, run it for real, read the result, and iterate — with hard
safety limits and the project's honesty rule enforced end to end.

### Tool calling in the provider contract
- `IModelProvider` gains **optional** tool support (same pattern as
  `chatStream`): `supportsTools()` and `chatWithTools()`, plus new
  `ToolDefinition` / `ToolCall` types and a `'tool'` role on `ChatTurn`.
- `OllamaProvider` implements both against `/api/chat`'s `tools` array,
  parsing `tool_calls` off the response. **Non-streaming for tool turns
  by design** — Ollama emits tool calls as one assembled field, not
  stream deltas, so we don't fake a token stream around them.
- `LocalProvider` (GGUF) deliberately does **not** implement tools, so a
  GGUF-backed agent degrades to a plain completion rather than silently
  ignoring the model's ability to act.
- `PluginRegistry.toolDefinitions(pluginIds)` translates each plugin
  capability's `inputSchema` into provider tool format — agents never
  hand-assemble tool JSON.

### The loop (BaseAgent.execute)
- One shared implementation on the non-streaming path
  (`POST /api/router/send`). Taken only when an agent declares
  `allowedPlugins` **and** its provider supports tools; otherwise the
  original single-call path runs unchanged.
- **Bounded**: ≤ 5 iterations and ≤ 60 s wall-clock (both env-tunable via
  `AGENT_MAX_TOOL_ITERATIONS` / `AGENT_TOOL_TIMEOUT_MS`). A shared
  `AbortController` cancels the in-flight model call on the deadline;
  exceeding either limit throws an error that *names* the limit.
- **Honest**: a tool returning `success:false` (or throwing) is fed back
  to the model verbatim — never retried silently, never fabricated.
- **Scoped**: tool calls resolve only against the agent's declared
  plugins. `CodingAgent` → `['terminal-plugin']`; every other agent
  stays `[]` and behaves exactly as before.

### TerminalPlugin.exec is real
- Runs via `child_process.execFile` (**no shell**, so model-supplied
  strings are never interpreted), confined to a sandbox cwd
  (`TERMINAL_SANDBOX_DIR`, default `backend/data/sandbox`, created on
  boot), with a 10 s timeout and output truncated to 4 KB per stream.
- **Hard-coded allow-list** (`ls, cat, pwd, echo, node, git, npm`);
  everything else is refused. Shell metacharacters and path arguments
  that escape the sandbox are rejected before spawn. Every attempt is
  logged, allowed or refused.
- Non-zero exits and timeouts are surfaced as honest failures, not
  hidden. `spawn` / `kill` / `list-procs` remain honest "not
  implemented" stubs.
- Confirmation gating (interactive per-command approval) is intentionally
  deferred; the allow-list is the safety boundary for now. The hook
  point is marked in `runExec()`.

## Milestone 6 — Theme Center, functional settings & identity (2026-07-07)

### Theme engine
- New theme engine (`frontend/src/theme/engine.ts`): a single persisted
  ThemeState projected onto CSS custom properties and data-attributes
  before first paint — the whole interface retunes instantly with zero
  theme flash. Every accent color in the app now derives from
  `--lum-accent-rgb`; nothing is hardcoded violet anymore.

### Theme Center (new page)
- **Moods**: six curated presets (Luminary, Glacier, Ember, Monsoon,
  Nova, Void) with mini environment previews.
- **Accent**: ten swatches plus a full custom color picker.
- **Wallpaper**: the artwork plus five procedural gradient scenes,
  including "Resonance" which follows the accent color.
- **Atmosphere**: snow / rain / embers / still, with particle density.
- **Liquid Glass**: live transparency, blur (0–48px) and glass-strength
  (borders, highlights, reflections) sliders.
- **Shape & Motion**: corner radius; Fluid / Calm / Static motion
  levels (wired into framer-motion's MotionConfig and a CSS
  kill-switch); Glass / Floating / Solid sidebar styles.
- **Typography**: seven variable fonts — Luminary (system), Claude
  (literary serif), Inter, Space Grotesk, Sora, Manrope, JetBrains
  Mono — self-hosted via @fontsource, applied instantly.
- **Saved themes**: snapshot, apply and delete custom themes.

### Settings became real
- Every control now does something: Stream Tokens (reveal-at-once mode
  when off), Send on Enter, Confirm Before Delete, Show Performance
  Stats, Temperature and Context Length (sent with every generation —
  new pass-through to Ollama options incl. num_ctx), live Provider
  Health in Network, PIN lock screen (Require Authentication), Privacy
  Frost (blur on window unfocus), and Clear All Conversations.
- Placebo toggles from earlier milestones were removed or replaced
  with honest, functional equivalents.

### Identity & polish
- Dashboard hero: time-of-day greeting, live clock, one-line system
  truth, and a "start a conversation" action — no more admin panel.
- Luminous hover: a pool of accent light follows the pointer across
  glass cards (Luminary's signature).
- Film-grain overlay, brighter glass top edges, boot veil ("the OS
  breathes in"), lock screen with living wallpaper, top-bar clock.

### Responsiveness
- Sidebar auto-collapses below 1080px; chat's conversation list
  becomes a summonable overlay below 980px; Settings' tab rail turns
  into horizontal chips below 860px; every stat/card grid is
  auto-fit; page bodies center with max-widths on ultrawide; chat
  messages hold a readable column width.

### Japanese animated environments
- Three new living wallpapers, drawn procedurally (zero assets) with
  pure-CSS keyframe layers riding the pointer parallax:
  - **Sakura** — hanami dusk: breathing low sun, drifting haze bands,
    mountain silhouettes; paired with the new **petals** weather:
    canvas sakura petals that tumble, flutter and rotate in depth.
  - **Neon Tokyo** — midnight rain: generated skyline (deterministic
    SVG with lit windows), flickering window layer, pink/cyan neon
    haze pulsing over a wet-street sheen.
  - **Yozora** — starlit night: two star fields twinkling out of
    phase, a haloed moon, an aurora ribbon flowing across the sky,
    dark treeline horizon; the embers weather doubles as fireflies.
- Three matching mood presets (桜 Sakura, 東京 Neon Tokyo, 夜空
  Yozora) and a Petals option in the Theme Center atmosphere control.

### Liquid Glass v2 — depth, lighting & materiality
- **True glass material**: five-layer construction (corner lensing,
  surface tint, `brightness(1.12)` added to the backdrop filter so
  what's behind a pane comes through *lifted*, differentiated edge
  rims, interior top-light/bottom-occlusion) replaces the old
  flat blur-plus-tint look.
- **Cursor-reactive lighting everywhere**: the pointer-tracked light
  pool (`pointerLight`, shared from the ui kit) now runs on the
  sidebar, top bar, chat rail and Settings pane, not just cards — 13
  surfaces total, each gaining an accent-tinted glow border on hover.
- **Real depth stack**: particles split across two canvases — the
  back ~¾ render behind the UI, visibly frosted by every pane's
  backdrop-filter; the front ¼ render on a `z-index: 30` canvas
  drifting *over* the glass. Snow and petals that reach a panel's top
  edge now **settle and rest there**, fading over ~5 s, like flakes
  collecting on a window sill.
- **Content parallax**: the wallpaper drifts opposite the pointer;
  the UI content plane now leans gently *with* it at a shallower
  rate (CSS vars fed by the wallpaper's rAF loop) — three planes,
  three speeds.
- **Breathing auras**: the active nav pill and the dashboard hero now
  pulse with a slow accent glow (`lum-aura`).
- Sidebar is markedly more translucent (chrome panes are now
  *clearer* than cards, by design, so the living wallpaper reads
  through) and the Dashboard vitals cards dropped the icon-chip/
  uppercase-label admin-panel formula for value-first typography
  with large ghost-icon watermarks.

### Fixed
- **First-boot crash on fresh installs**: the backend dev runner
  (ts-node-dev) hooks child processes and wraps node-llama-cpp's ESM
  binding probe in a CJS require, killing the server ~3 s after
  launch on a machine with no cached probe result. The dev runner is
  now **tsx** (ESM-native, leaves children alone) — verified by
  installing and booting from a fresh zip extraction: the server
  stays up and the GGUF runtime probes clean (Vulkan).
- **Boot banner wasn't purple in a plain double-clicked run.bat
  window**: color detection required `WT_SESSION`/`TERM_PROGRAM`,
  which a classic conhost window never sets, so it silently fell
  back to plain ASCII. Now uses Node's own `process.stdout.hasColors()`
  — the correct, maintained detector — so the full violet LUMINARY
  wordmark and bold "Nah I'd win™" tagline render in any real
  terminal (double-clicked `run.bat`, `setup.bat`, `doctor.bat`,
  Windows Terminal, or a Unix shell). The gradient itself is also
  pure purple end to end now (was fading into ice-blue by the last
  row); `run.bat`/`setup.bat`/`doctor.bat` no longer print a
  duplicate, uncolored banner before Node's real one.

## Milestone 5 — Premium liquid-glass experience (2026-07-06)

### Living wallpaper
- The official Luminary artwork is now the app's living environment:
  pointer-parallax artwork layer, drifting volumetric fog, breathing
  bloom, and canvas snowfall in three parallax depths with sinusoidal
  wind — one shared rAF loop, transform/opacity only, paused when the
  tab hides, honours prefers-reduced-motion. Verified 60fps (vsync)
  with zero dropped frames during the sweep.

### Liquid glass design system
- New token set (Luminary Violet · Ice Blue · Aurora White over a
  near-black blue base) with layered glass materials: backdrop blur +
  saturation, top-light gradients, hairline borders, inner highlights,
  diagonal reflection streaks, and a cinematic scrim that keeps every
  pane readable.
- Shared motion vocabulary (framer-motion springs): page transitions,
  staggered card entrances, sliding nav pill, hover elevation, press
  scaling, skeleton shimmer, animated numbers with tabular digits.

### Pages
- **Dashboard**: glass stat cards, spring-animated values, live CPU/
  GPU/RAM sparkline history from real polling samples, honest empty
  states.
- **Chat**: message entrance springs, thinking-dots indicator, glowing
  streaming caret, copy-button pop animation, smarter auto-scroll that
  never fights the reader, glass conversation rail.
- **Models**: card-based professional manager with provider badges
  (Ollama/GGUF), metadata grids, in-memory usage per running model —
  and **drag-and-drop GGUF install**: drop a .gguf anywhere on the
  page and it streams into models/ (new `PUT /api/models/upload`),
  registering live via the folder watcher. Duplicate names get an
  honest 409; body parsers can never consume upload streams.
- **Agents**: breathing avatars while live, spring status changes,
  friendly model names for GGUF paths.
- **Settings**: icon tabs, glass content pane, cross-tab search that
  jumps to and highlights the matched row, spring toggles.
- Memory and Devices harmonised to the same palette and materials.

### GGUF runtime resilience (real fixes found during verification)
- Loading a model that exceeds GPU memory no longer fails: Luminary
  now evicts other loaded GGUF models and retries, then falls back to
  CPU inference — verified with DeepSeek-R1-7B, which previously
  errored with Vulkan out-of-memory and now loads and generates.
- Reasoning models stream their thinking live (response segments,
  marked with *Thinking…*) instead of appearing frozen for minutes.

### Terminal experience
- run.bat / setup.bat / doctor.bat and the start/setup/doctor scripts
  now boot with the official LUMINARY block banner — violet-to-ice
  ANSI gradient in modern terminals, clean ASCII fallback elsewhere —
  plus the "Nah I'd win™" tagline.

## Milestone 4 — First-class GGUF models + real runtime (2026-07-06)

### models/ folder — zero configuration
- A `models/` folder is **created automatically beside run.bat** at
  boot (with a README explaining usage). No browsing, no setup: drop
  `.gguf` files anywhere inside (nested subfolders fine) and they are
  discovered, parsed, and registered automatically on startup.
  The Settings folder option remains as an *extra* folder.
- Files are never moved, copied, or modified — paths + metadata only.

### Live file watching — no manual Refresh
- The models folders are watched recursively (`fs.watch`). Dropping a
  .gguf in while Luminary runs registers it automatically; deleting it
  removes it automatically. Changes are pushed to the UI over a new
  SSE stream (`GET /api/models/events`) — verified in the browser with
  zero clicks: file appears/disappears on the Models page by itself.

### Real GGUF runtime (node-llama-cpp)
- `GgufRuntime` runs .gguf files **in-process via node-llama-cpp 3**
  (llama.cpp; GPU-accelerated — Vulkan on this machine). Nothing is
  faked: Load/Unload genuinely load/free model memory, and chat
  streams real tokens from real inference (verified end-to-end,
  including stop mid-generation with honest partials and continue).
- If the runtime cannot initialise, models are still listed with an
  honest "No runtime" status and the real error message; Settings →
  Models shows live runtime status.
- Chat routing is provider-aware: the Router picks the agent, then the
  message runs on whichever provider owns the agent's model (Ollama
  tag or GGUF file path). Agents can be assigned **Ollama models or
  GGUF models** — only runnable models are selectable, stored by
  canonical id.

### Models page
- Columns now: Model (+ on-disk path for GGUF), Provider
  (Ollama/GGUF), Type, Arch, Params, Size, Context, Quant, Actions.
- Load/Unload buttons work for GGUF models when the runtime is
  available; "In Memory"/"Loaded" stats include runtime-loaded GGUFs.

### No fabricated statistics
- Dashboard resources are now real: CPU% from `os.cpus()` time deltas,
  RAM from the OS, GPU% from Windows GPU-engine performance counters
  (sampled in the background). The random/hardcoded numbers are gone.
- Fixed a React style warning (border shorthand conflict) in the Chat
  and Settings navigation buttons.

## Milestone 3 — Complete Local Model Management (2026-07-06)

### GGUF models folder
- **Settings → Models** has a new "GGUF Models Folder" option: pick a
  folder and it is scanned **recursively** for `.gguf` files. Only file
  paths and metadata are stored — model files are **never copied,
  moved, or modified** (verified: byte-identical mtimes/sizes after
  repeated scans).
- Real metadata is parsed from each file's GGUF v2/v3 header:
  architecture, model name, parameter size, quantization
  (`general.file_type`), and context length. Corrupt or unparseable
  files still appear with honest fallback values instead of being
  hidden.
- The folder choice is persisted (`backend/data/settings.json`) and
  survives restarts. **Refresh** on the Models page rescans the folder
  (metadata cached by mtime, so rescans are cheap).
- Discovered GGUF models appear on the Models page **alongside Ollama
  models** with a `gguf` provider tag and their on-disk path. They stay
  visible even when Ollama is down.
- No GGUF runtime is installed yet (node-llama-cpp): the UI says so
  clearly — a notice banner, a per-row "No runtime" indicator, and a
  Settings row — rather than hiding the models. Attempting to run or
  assign one returns an honest error; the agent model dropdown only
  offers runnable models.
- New backend pieces: `SettingsService` (+ `/api/settings` routes),
  `GgufScanner` (recursive walk + header parser), and `LocalProvider`
  implemented as the read-only GGUF discovery provider.

### Connection fixes
- Ollama default endpoint is now `http://127.0.0.1:11434` instead of
  `localhost` (avoids IPv6 `::1` resolution stalls on some Windows
  setups). `OLLAMA_BASE_URL` still overrides it.
- Vite dev server port can be overridden with the `PORT` env variable
  (still defaults to 5173).

### Verification status
- **Verified against a real local Ollama installation (v0.31.1)**:
  model auto-detection with real metadata, pull with streamed progress
  (smollm2:135m), delete, load/unload via keep_alive with live
  `/api/ps` status, real token-streamed chat through the UI (markdown,
  code blocks, copy buttons), stop mid-generation with honest partial
  persistence, continue extending a stopped reply, regenerate, and
  per-agent model assignment.
- Every GGUF workflow verified against generated real-format GGUF
  fixtures (recursive scan, header metadata parsing, corrupt-file
  fallback, persistence, rescan, read-only guarantee).
- Fixed: nonsense tokens-per-second values are dropped when Ollama
  reports near-zero eval durations.

## Boot fix — mock data layer removed entirely (2026-07-05)

The backend failed to start from the packaged build with
`Cannot find module '../data/mockData'` (the ZIP packaging step had
excluded every directory named `data`, including `src/data`). Rather than
restoring the file, the mock data layer is now gone completely:

- `DeviceService` delegates to the real `DeviceManager` registry — no
  adapters register yet, so `/api/devices` returns an honest empty list;
  connect/disconnect on unknown devices return honest errors.
- `InMemoryProvider` no longer seeds fake memories — the store starts
  empty.
- Frontend: removed all `@/data/mockData` imports. System status starts
  from an honest zero-state until the first real snapshot; Memory,
  Devices, and Dashboard tasks start empty; the `withFallback` mock
  wrapper in the API client was deleted, so backend failures surface as
  errors everywhere.
- `backend/src/data/mockData.ts` and `frontend/src/data/mockData.ts` are
  deleted. Verified: backend boots, `/api/health` responds, and both
  projects build cleanly.

## Milestone 2 — Real Chat + Real Models (2026-07-05)

Replaces the mock chat and mock model system with a real local AI workflow
backed by Ollama. No cloud APIs are used or contacted — everything runs
against `http://localhost:11434` (configurable via `OLLAMA_BASE_URL` in
`backend/.env`).

### Real Chat

- **Streaming responses** — messages stream token-by-token from Ollama's
  `/api/chat` endpoint through a new NDJSON endpoint
  (`POST /api/chat/generate`) into the Chat page.
- **Conversation history** — full multi-turn history is sent to the model on
  every turn, together with the responding agent's system prompt.
- **Session persistence** — conversations are stored in
  `backend/data/conversations.json` (atomic writes) and survive app restarts.
  Conversations can be created, renamed, and deleted from the UI.
- **Markdown rendering** — assistant replies render GitHub-flavored Markdown
  (react-markdown + remark-gfm) styled to the existing design language.
- **Syntax highlighting** — fenced code blocks are highlighted
  (react-syntax-highlighter, Prism oneDark) with a language label header.
- **Copy code buttons** — every code block has a copy-to-clipboard button
  with visual confirmation.
- **Stop generation** — the send button becomes a stop button while
  streaming; stopping aborts the upstream Ollama request and persists the
  partial response, marked `stopped`. Closing the browser tab mid-stream
  also cancels the upstream generation.
- **Regenerate** — re-runs the last turn (drops the previous assistant
  reply server-side and re-streams).
- **Continue generation** — extends the last assistant reply: the history
  is resent ending with the assistant message so the model continues it;
  new tokens append to the same message.
- **Honest error states** — when Ollama is down, no model is installed, or
  generation fails, the UI shows the real error in a dismissable banner.
  All mock/fallback chat responses were removed.
- Chat is still dispatched through the Luminary Router: the agent is
  selected per message (keyword strategy or explicit target) and the reply
  is generated with that agent's assigned model and system prompt. The
  header shows live `agent · model` routing info while streaming, and each
  reply shows agent, model, duration and tok/s (from Ollama's eval stats).

### Real Models Page

- **Discovery** — lists the models actually installed in Ollama
  (`GET /api/tags`), with real name, size, family, parameter size,
  quantization, and context length (from `/api/show`, cached by digest).
  Nothing is hardcoded.
- **Live load state** — "loaded" reflects `GET /api/ps` (models currently
  in memory). Load/Unload buttons issue real keep-alive requests.
- **Refresh** — re-queries the Ollama API on demand.
- **Pull models** — pull any model from the Ollama registry with live
  streaming progress (status, bytes, percent) and cancel support
  (`POST /api/models/pull`).
- **Delete models** — permanently removes a model from disk after
  confirmation (`DELETE /api/models/:name`).
- **Real statistics** — Installed / Loaded / Total Size / In Memory cards
  are computed from live API data (the fake "VRAM Used: 6.7 GB" card is
  gone). When Ollama is unreachable the page shows an honest error banner
  with a retry button — no placeholder rows.

### Agent Wiring

- **Model selection per agent** — each agent card on the Agents page has a
  dropdown listing the models installed in Ollama
  (`PUT /api/agents/:id/model`, validated against the live model list).
- **Persistence** — assignments are stored in
  `backend/data/agent-models.json` and survive restarts.
- **Display** — the card shows the currently assigned model; agents with
  no assignment fall back to the first installed model at runtime (shown
  as such — no hardcoded model names remain in the agents).
- Agents now perform **real inference**: `BaseAgent.execute()` calls the
  provider with the resolved model and the agent's system prompt, so the
  non-streaming `POST /api/router/send` path is real too. All
  `stubResponse` placeholder replies were removed.

### Backend

- `OllamaProvider` fully implemented (was a stub): health check with
  latency, model listing (+running models), load/unload via keep-alive,
  non-streaming completion, streaming chat with abort support, pull with
  progress, delete, and embeddings — with honest `OllamaError`s carrying
  the upstream message.
- New `ChatService` + `/api/chat/*` routes (conversation CRUD, streaming
  generate, stop).
- New `AgentModelStore` and `JsonStore` (atomic file-backed persistence in
  `backend/data/`, gitignored).
- `Router.selectAgent()` — agent selection without execution, reused by
  the streaming chat flow.
- Error handler now surfaces operational error messages (Ollama/chat/router
  errors) instead of a generic "Internal server error".
- `IModelProvider` extended with optional `chatStream` / `pullModel` /
  `deleteModel` capabilities plus richer `ModelInfo`
  (`sizeBytes`, `parameterSize`, `modifiedAt`).

### Frontend

- New `useChat` hook (streaming lifecycle, stop/regenerate/continue,
  conversation management) and `chatApi`/NDJSON stream reader in the API
  client.
- `useModels` rewritten against live data (health-gated, pull progress,
  no mock initial state); `useAgents` gained `setModel`.
- New `Markdown` chat renderer component with code-block copy buttons.
- Removed mock conversations, mock model list, and mock agent list; the
  Router hook no longer fabricates offline responses. (Dashboard, Memory
  and Devices keep their existing development fallbacks — out of scope
  for this milestone.)
- Fixed pre-existing build errors: `StatusDot` was missing the `error` /
  `pairing` / `disabled` statuses used by Dashboard and Devices, and
  Chat.tsx imported Node's `crypto` in browser code.

### Dependencies

- Frontend: `react-markdown`, `remark-gfm`, `react-syntax-highlighter`
  (+ types). Backend: no new dependencies (uses Node 18+ global fetch).
