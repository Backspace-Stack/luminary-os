# Verification and feature boundaries

The test suite uses temporary files, real SQLite/JSON persistence, local HTTP fixtures, and controlled provider responses. It does not download weights, start Ollama, load a GGUF model, or call cloud services. A passing fixture test proves the application contract exercised by that fixture; it does not certify a particular model or device.

Run from a setup checkout with Node 24:

```sh
npm run build
npm run lint
npm run typecheck
npm test
npm run check:repository
npm audit
npm audit --prefix backend
npm audit --prefix frontend
```

`check:repository` checks the intended Git index. Stage the public changes before running it. Runtime data, private configuration, weights, dependencies, and generated builds must remain excluded.

| Surface | Verification | Remaining live check |
| --- | --- | --- |
| Branding and navigation | One original logo asset; local UI inspection; build and asset response | Target-browser/device layout |
| Chat and history | HTTP CRUD and disk failures; staged generation; cancellation; hook state simulation; composer preservation in UI | Real supported-model streaming, regeneration and continuation |
| Notes | Real SQLite CRUD; research insertion/conflict fixtures; autosave and remount hook simulations | Real provider-backed research |
| Memory | SQLite persistence/search/delete; malformed data; hook mutation failures | Real embedding-model quality |
| Models and agents | Provider parsing, metadata-only assignment, upload/queue fixtures; real unavailable-provider UI; SSE/reconnect/auth fixtures | Model compatibility, native inference and hardware performance |
| Tools and approvals | Restricted command/path checks; session-bound single-use approval/denial fixtures | Review configured allowed roots for each installation |
| Settings and integrations | Persisted folder/assignment failures; local key storage and redaction tests | Cloud credentials, search and Discord operation |
| Devices | Honest empty/error UI; mutation failure simulation | Adapters, pairing and inspection remain experimental |
| Launchers | Actual Node/npm/tsx/Vite subprocesses and literal-argument tests on Windows | Full macOS/Linux setup and hosted CI |

The frontend hook simulations execute the actual hook source with controlled state, effects, promises and timers. They are deliberately labelled as simulations, not browser rendering tests. Browser inspection provides separate evidence for the rendered local interface.

Unsaved note edits survive closing/reopening Notes within the same tab. Failed saves remain visible and retry on reopening; an unsaved-change warning guards leaving the tab. These drafts are not stored in browser local storage, so forced termination or restarting the browser before a successful save can lose them.

The canonical mark is `frontend/public/brand/lantern-logo.png`. UI branding uses `BrandLogo` and package-derived version/runtime metadata; the favicon and README reference that same asset. Functional icons such as locks, tools and navigation remain distinct.
