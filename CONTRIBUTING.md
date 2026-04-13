# Contributing to Manifest

Thanks for your interest in contributing to Manifest! This guide will help you get up and running.

[![codecov](https://img.shields.io/codecov/c/github/mnfst/manifest?color=brightgreen)](https://codecov.io/gh/mnfst/manifest)

## Tech Stack

| Layer     | Technology                                    |
| --------- | --------------------------------------------- |
| Frontend  | SolidJS, uPlot, custom CSS theme              |
| Backend   | NestJS 11, TypeORM, PostgreSQL 16              |
| Auth      | Better Auth (email/password + Google/GitHub/Discord OAuth) |
| Routing   | OpenAI-compatible proxy (`/v1/chat/completions`) |
| Build     | Turborepo + npm workspaces                    |

The full NestJS + SolidJS stack runs on PostgreSQL. Self-hosted deployments use the Docker image (`manifestdotbuild/manifest`) with a bundled Postgres container via Docker Compose. The [cloud version](https://app.manifest.build) runs the same codebase.

## Prerequisites

- Node.js 22.x (LTS)
- npm 10.x

## Repository Structure

Manifest is a monorepo managed with [Turborepo](https://turbo.build/) and npm workspaces.

```
packages/
├── backend/              # NestJS API server (TypeORM, PostgreSQL, Better Auth)
├── frontend/             # SolidJS single-page app (Vite, uPlot)
└── openclaw-plugins/
    └── manifest-model-router/ # npm: `manifest-model-router` — OpenClaw provider plugin
```

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

1. Build and start the backend against your dev Postgres:

```bash
npm run build
DATABASE_URL=postgresql://myuser:mypassword@localhost:5432/mydatabase \
BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
PORT=38238 BIND_ADDRESS=127.0.0.1 \
  node -r dotenv/config packages/backend/dist/main.js
```

2. Create an agent in the dashboard at `http://localhost:38238` and get the API key.

3. Add Manifest as a provider in OpenClaw:

```bash
openclaw config set models.providers.manifest '{"baseUrl":"http://localhost:38238/v1","api":"openai-completions","apiKey":"mnfst_YOUR_KEY","models":[{"id":"auto","name":"Manifest Auto"}]}'
openclaw config set agents.defaults.model.primary manifest/auto
openclaw gateway restart
```

No plugin needed for this. The backend runs standalone and OpenClaw talks to it as a regular model provider. For other agents (OpenAI SDK, Vercel AI SDK, LangChain, cURL, …) follow the corresponding tab in the dashboard's "Connect Agent" modal — the underlying endpoint and auth are identical.

**When to use this:**

- Testing routing, tier assignment, or model resolution
- Debugging the proxy or message recording
- Working on the dashboard UI with live data

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start frontend in watch mode (start backend separately) |
| `npm run build` | Production build (frontend then backend via Turborepo) |
| `npm start` | Start the production server |
| `npm test --workspace=packages/backend` | Run backend unit tests (Jest) |
| `npm run test:e2e --workspace=packages/backend` | Run backend e2e tests (Jest + Supertest) |
| `npm test --workspace=packages/frontend` | Run frontend tests (Vitest) |
| `npm test --workspace=packages/openclaw-plugins/manifest-model-router` | Run provider plugin tests (Jest) |
| `npm run build:provider` | Build the manifest-model-router plugin |

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

### Provider Plugin (`packages/openclaw-plugins/manifest-model-router`)

- **npm**: `manifest-model-router` — lightweight OpenClaw provider plugin (~22KB)
- **Bundler**: esbuild (zero runtime dependencies)
- Registers Manifest as a model provider with interactive auth onboarding. No embedded server or dashboard.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `devMode` | `boolean` | auto | Skips API key validation. Auto-detected when endpoint is a loopback address. |
| `endpoint` | `string` | `https://app.manifest.build` | Manifest server URL. |

Settings are parsed in `src/config.ts` and validated in `validateConfig`. The JSON schema in `openclaw.plugin.json` is the source of truth.

## Making Changes

### Workflow

1. Create a branch from `main` for your change
2. Make your changes in the relevant package(s)
3. Write or update tests as needed
4. If your change affects the `manifest-model-router` publishable package, add a changeset:

```bash
npx changeset
```

Follow the prompts to select the affected packages and bump type (patch / minor / major). This creates a file in `.changeset/` — commit it with your code. See [Changesets](#changesets) below for details.

5. Run the test suite to make sure everything passes:

```bash
npm test --workspace=packages/backend
npm run test:e2e --workspace=packages/backend
npm test --workspace=packages/frontend
npm test --workspace=packages/openclaw-plugins/manifest-model-router
```

6. Verify the production build works:

```bash
npm run build
```

7. Open a pull request against `main`

### Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for version management and npm publishing. When you change a publishable package, you need to include a changeset describing the change.

**Which packages need changesets?**

| Package | npm name | Needs changeset? |
| --- | --- | --- |
| `packages/openclaw-plugins/manifest-model-router` | `manifest-model-router` | Yes — when its own code changes |
| `packages/backend` | — | No — ships as part of the Docker image, not via npm |
| `packages/frontend` | — | No — ships as part of the Docker image, not via npm |

**Adding a changeset:**

```bash
npx changeset
```

Select the affected packages, choose the semver bump type, and write a short summary. This creates a markdown file in `.changeset/` — commit it alongside your code changes.

**What happens after merge:**

1. The release workflow detects changesets and opens a "Version Packages" PR
2. That PR bumps versions in `package.json` and updates `CHANGELOG.md`
3. When the version PR is merged, the workflow publishes to npm automatically

**If your change doesn't need a release** (e.g., docs, CI, internal tooling):

```bash
npx changeset add --empty
```

### Commit Messages

Write clear, concise commit messages that explain **why** the change was made. Use present tense (e.g., "Add token cost breakdown to overview page").

### Pull Requests

- Keep PRs focused on a single concern
- Include a short summary of what changed and why
- If you changed a publishable package, include a changeset (CI will warn if missing)
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
