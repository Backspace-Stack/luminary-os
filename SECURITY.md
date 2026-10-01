# Security

Luminary is an early local agent application with powerful host-facing tools. Filesystem confinement, Git subprocess rules, approval lifecycle, HTTP authentication/origin checks, model uploads, native model loading, Discord authorization, and secrets persistence are security-sensitive.

Report vulnerabilities privately. Once the repository exists, use **Security → Report a vulnerability** if the owner has enabled GitHub private vulnerability reporting. If unavailable, request a private reporting channel from the maintainer without publishing exploit details or private data. No security email is established here; do not send reports to an invented address. The owner should enable private vulnerability reporting before publication.

Provide affected version/commit, platform, reproduction steps, expected/actual behavior, and a minimal harmless fixture. Redact tokens, model prompts, notes, personal paths and conversation content. Do not put real credentials or a working destructive exploit in public issues.

Only the current developer-preview revision is reviewed; there is no promise of long-term support for older snapshots. Automated tests improve regression protection and do not constitute a complete security certification.

## Operating assumptions

- Default bind is loopback. An explicitly configured external bind requires `API_AUTH_TOKEN`; it still needs a carefully configured trusted frontend/proxy and transport protection. This project is not a public multi-user service.
- A correct bearer token protects API access except the minimal health probe. Browser Host/Origin checks also reject hostile webpage requests before parsing or uploads.
- Approval tokens authorize the original frozen tool payload, are session/agent-bound, expire and are single-use. A denial revokes the whole paused turn.
- Plugin entrypoints are internal code APIs. Code that bypasses the agent loop is trusted application code and must preserve confirmation policy.
- Restrict `FILE_ALLOWED_DIRS`; they grant the agent read access and approved write/delete access. Terminal access is application policy, not an OS sandbox.
- Another process/user with filesystem access can change files between checks. Symlink/hard-link races and native model parsing need defense beyond JavaScript path validation for hostile multi-user environments.
- Keys in SQLite, conversation JSON, curated memory, and UI preferences are local **plaintext**. The screen PIN is not encryption. Protect filesystem permissions and backups.
- Cloud inference, web search, URL opening and Discord send information off-device when used. Review these choices before handling sensitive data.
- Use trusted GGUF files; native inference libraries parse complex binary input. Upload extension/header validation does not prove a model is safe.

Before committing or packaging, inspect the file list and run `npm run check:repository`. The Git ignore file is a safeguard, not a replacement for reviewing the index. `.env`, runtime memory/data, databases, model weights, dependency trees and build output must remain excluded.
