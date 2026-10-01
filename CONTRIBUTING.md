# Contributing

Use Node.js 24 LTS and npm 10+. Run `npm run setup`, then `npm start`. Keep local model files and runtime state out of Git.

```sh
npm run dev:backend
npm run dev:frontend
npm run lint
npm run typecheck
npm test
npm run build
```

The development servers run in separate terminals. `npm test` uses Node's native test runner and `tsx`, real temporary filesystem/SQLite fixtures, local HTTP streaming and launcher processes, and mocked provider network boundaries. Backend tests, frontend transport tests and launcher tests run from the root; `npm run typecheck` includes the TypeScript tests. It must not depend on an active Ollama server, credentials, model downloads or local devices.

The root holds setup/launch scripts and public documentation. Backend contracts/registries live in `backend/src/core`; routes delegate to services, agents use provider/plugin interfaces, and Kernel creates concrete implementations. Frontend API calls live in `frontend/src/services/api.ts`; pages and hooks preserve the existing visual and interaction behavior.

For agents, plugins and providers, start with [docs/extensions.md](docs/extensions.md). Use strict types, validate untrusted inputs at tool boundaries, surface errors honestly, and retain confirmation controls. Add regression tests for changed safety/correctness behavior. Keep changes focused; do not restructure large files solely because of line count or replace the stack.

A pull request should explain the problem, resulting behavior, and commands actually verified. Include a real screenshot for visible changes, with personal data removed. Describe any unverified external integrations or platform behavior. Never attach credentials, conversations, runtime databases or weights to issues/PRs.

Approachable future tasks: tests for unusual keyword-routing prompts; a broader accessibility review; a compiled plugin example; verified macOS/Linux launcher diagnostics. Discuss native inference/tool security changes before broadening privileges.
