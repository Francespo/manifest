# Contributing to Manifest

Thanks for your interest in contributing to Manifest! This guide will help you get up and running.

[![codecov](https://img.shields.io/codecov/c/github/mnfst/manifest?color=brightgreen)](https://codecov.io/gh/mnfst/manifest)

## Tech Stack

| Layer     | Technology                                    |
| --------- | --------------------------------------------- |
| Frontend  | SolidJS, uPlot, custom CSS theme              |
| Backend   | NestJS 11, TypeORM, sql.js (local) / PostgreSQL (cloud) |
| Auth      | Better Auth (auto-login on localhost)          |
| Routing   | OpenAI-compatible proxy (`/v1/chat/completions`) |
| Build     | Turborepo + npm workspaces                    |

The full NestJS + SolidJS stack runs locally backed by sql.js (WASM SQLite). The same codebase also powers the [cloud version](https://app.manifest.build) with PostgreSQL — the only differences are the database driver and auth guard.

## Prerequisites

- Node.js 22.x (LTS)
- npm 10.x

## Repository Structure

Manifest is a monorepo managed with [Turborepo](https://turbo.build/) and npm workspaces.

```
packages/
├── shared/               # Shared TypeScript types and constants
├── backend/              # NestJS API server (TypeORM, PostgreSQL, Better Auth)
└── frontend/             # SolidJS single-page app (Vite, uPlot)
```

Self-hosting is supported via the [Docker image](https://hub.docker.com/r/manifestdotbuild/manifest).

## Getting Started

1. Fork and clone the repository:

```bash
git clone https://github.com/<your-username>/manifest.git
cd manifest
npm install
```

2. Set up environment variables:

```bash
cp packages/backend/.env.example packages/backend/.env
```

Edit `packages/backend/.env` with at least:

```env
PORT=3001
BIND_ADDRESS=127.0.0.1
NODE_ENV=development
BETTER_AUTH_SECRET=<run: openssl rand -hex 32>
DATABASE_URL=postgresql://myuser:mypassword@localhost:5432/mydatabase
API_KEY=dev-api-key-12345
SEED_DATA=true
```

3. Start the development servers (in separate terminals):

```bash
# Backend (must preload dotenv)
cd packages/backend && NODE_OPTIONS='-r dotenv/config' npx nest start --watch

# Frontend
cd packages/frontend && npx vite
```

The frontend runs on `http://localhost:3000` and proxies API requests to the backend on `http://localhost:3001`.

4. With `SEED_DATA=true`, you can log in with `admin@manifest.build` / `manifest`.

## Testing Routing with a Personal AI Agent

Manifest is a smart router for any personal AI agent that speaks OpenAI-compatible HTTP. The list of supported agents lives in `packages/shared/src/agent-type.ts` — OpenClaw, Hermes, OpenAI SDK, Vercel AI SDK, LangChain, and cURL are all first-class. The dashboard's "Connect Agent" flow generates the right setup snippet for whichever platform you pick.

This section walks through **OpenClaw** because it's the deepest integration and the easiest to wire up end-to-end. The same backend also handles all other agents — just follow the dashboard instructions after creating the agent, or grab the snippet shown by the setup modal.

To test routing against your local backend, add Manifest as a model provider in your OpenClaw config:

1. Build and start the backend in local mode:

```bash
npm run build
MANIFEST_MODE=local PORT=38238 BIND_ADDRESS=127.0.0.1 \
  node -r dotenv/config packages/backend/dist/main.js
```

2. Create an agent in the dashboard at `http://localhost:38238` and get the API key.

3. Add Manifest as a provider in OpenClaw:

```bash
openclaw config set models.providers.manifest '{"baseUrl":"http://localhost:38238/v1","api":"openai-completions","apiKey":"mnfst_YOUR_KEY","models":[{"id":"auto","name":"Manifest Auto"}]}'
openclaw config set agents.defaults.model.primary manifest/auto
openclaw gateway restart
```

The backend runs standalone and OpenClaw talks to it as a regular OpenAI-compatible provider — no plugin needed. For other agents (OpenAI SDK, Vercel AI SDK, LangChain, cURL, …) follow the corresponding tab in the dashboard's "Connect Agent" modal — the underlying endpoint and auth are identical.

**When to use this:**

- Testing routing, tier assignment, or model resolution
- Debugging the proxy or message recording
- Working on the dashboard UI with live data

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start frontend in watch mode (start backend separately) |
| `npm run build` | Production build (shared, backend, frontend via Turborepo) |
| `npm start` | Start the production server |
| `npm test --workspace=packages/backend` | Run backend unit tests (Jest) |
| `npm run test:e2e --workspace=packages/backend` | Run backend e2e tests (Jest + Supertest) |
| `npm test --workspace=packages/frontend` | Run frontend tests (Vitest) |
| `npm test --workspace=packages/shared` | Run shared tests (Jest) |

## Working with Individual Packages

### Backend (`packages/backend`)

- **Framework**: NestJS 11 with TypeORM 0.3 and PostgreSQL 16
- **Auth**: Better Auth (email/password + Google, GitHub, Discord OAuth)
- **Tests**: Jest for unit tests (`*.spec.ts`), Supertest for e2e tests (`test/`)
- **Key directories**: `entities/` (data models), `analytics/` (dashboard queries), `routing/` (proxy, scoring, tier assignment), `auth/` (session management)

### Frontend (`packages/frontend`)

- **Framework**: SolidJS with Vite
- **Charts**: uPlot for time-series visualization
- **Tests**: Vitest
- **Key directories**: `pages/` (route components), `components/` (shared UI), `services/` (API client, auth client)

### Shared (`packages/shared`)

- TypeScript types, constants, and helpers used by both the backend and the frontend.
- Built with `tsc` — both CJS and ESM outputs are produced so it can be consumed from either package.

## Making Changes

### Workflow

1. Create a branch from `main` for your change
2. Make your changes in the relevant package(s)
3. Write or update tests as needed
4. Run the test suite to make sure everything passes:

```bash
npm test --workspace=packages/shared
npm test --workspace=packages/backend
npm run test:e2e --workspace=packages/backend
npm test --workspace=packages/frontend
```

5. Verify the production build works:

```bash
npm run build
```

6. Open a pull request against `main`

### Commit Messages

Write clear, concise commit messages that explain **why** the change was made. Use present tense (e.g., "Add token cost breakdown to overview page").

### Pull Requests

- Keep PRs focused on a single concern
- Include a short summary of what changed and why
- Reference any related issues

## Architecture Notes

- **Single-service deployment**: In production, NestJS serves both the API and the frontend static files from the same port via `@nestjs/serve-static`.
- **Dev mode**: Vite on `:3000` proxies `/api` and `/v1` to the backend on `:3001`. CORS is enabled only in development.
- **Database**: PostgreSQL 16. Schema changes are managed via TypeORM migrations (`migrationsRun: true` on boot). After modifying an entity, generate a migration with `npm run migration:generate -- src/database/migrations/Name`.
- **Validation**: Global `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`.
- **TypeScript**: Strict mode across all packages.

## Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/mnfst/manifest/issues) with as much detail as possible.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
