# Before releasing 0.1.0

- [x] Set LICENSE attribution to the project owner's GitHub handle, Backspace-Stack.
- [ ] Review the complete tracked-file list, dependency licenses and supplied image rights.
- [ ] Run `npm run check:repository`, `npm run lint`, `npm test`, and `npm run build` from a fresh checkout after `npm run setup`.
- [ ] Confirm only `.env.example` configuration is tracked; no personal state, conversations, database files, weights, credentials, dependencies or builds.
- [ ] Verify the interface and health endpoint with Ollama unavailable; test real inference with a supported model on the intended release host.
- [ ] Review experimental Docker/device/browser/Windows features and platform limits in README.
- [x] Enable GitHub private vulnerability reporting, dependency alerts, secret scanning and push protection.
- [x] Obtain the owner's explicit approval to publish the source repository. Tagged releases and packaged releases require separate approval.
- [x] Add the canonical repository URL, issue tracker metadata and CI badge. Consult the workflow for its current hosted result.

Suggested repository name: `luminary-os`.

Suggested description: Local-first AI agent runtime with model routing, approval-gated tools, persistent memory and a React control interface.

Suggested topics: `local-ai`, `ollama`, `ai-agents`, `typescript`, `react`, `developer-tools`, `local-first`.

Lead with the real dashboard screenshot, followed by streaming local chat, the approval-gated tool loop, model management, and local notes/memory. Add an inference demo only after recording a real successful model workflow. Consider Discussions after users have questions to discuss.
