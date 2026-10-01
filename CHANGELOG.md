# Changelog

## 0.1.0 — developer preview

- Use the original logo consistently across app branding, favicon and README; derive displayed version and Node requirement from package metadata.
- Preserve note edits across autosave/research failures and page switches; reject stale research inserts rather than overwrite newer text.
- Keep failed memory/device/model-assignment actions visible, and reconcile mounted chat state after history deletion.
- Target Stop at the generating conversation and keep failed disk writes from publishing unsaved conversation/settings/assignment state.
- Align the managed browser address, backend origin guard and frontend port; preserve validated local overrides and prevent Vite port drift.
- Add model-free CRUD, persistence, conflict and frontend state regression coverage; document verification boundaries in [docs/testing.md](docs/testing.md).
- Load non-dashboard pages and syntax highlighting on demand, preserving the UI and chat state; provide page retry and readable code fallbacks.
- Support authenticated live model notifications with reconnect, token rotation, bounded SSE frames and explicit connection status.
- Launch Windows npm/Vite/tsx through their JavaScript entrypoints rather than a generic shell; preserve literal arguments and paths with spaces.
- Add frontend streaming and real launcher regression coverage to the root test command and TypeScript checks.
- Preserve the existing agent runtime, local/cloud provider architecture, plugins, chat modes, theme UI, notes and local persistence.
- Add conversation-bound, single-use approval validation and server-side denial revocation.
- Harden filesystem path variants, Git executable configuration/options, model upload names/publication, browser-origin access and external-bind authentication requirements.
- Fix capped terminal echo, Windows Git null-device handling, malformed memory metadata and blank similarity configuration.
- Add strict native GGUF types and a model generation task queue.
- Add backend/security/provider regression tests, working ESLint configuration, lockfile setup, Node 24 prerequisites, and CI configuration.
- Update affected dependencies and document incomplete integrations, plaintext local secrets and remaining security assumptions.
- Promote accurate root documentation and exclude personal/generated content from publication candidates.

This entry describes the developer-preview source. Live inference, cloud integrations and native hardware still require separate validation. Historical development notes are retained in [docs/history/CHANGELOG.md](docs/history/CHANGELOG.md); those notes are not current release guarantees.
