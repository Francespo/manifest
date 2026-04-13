<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mnfst/manifest/HEAD/.github/assets/logo-white.svg" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/mnfst/manifest/HEAD/.github/assets/logo-dark.svg" />
    <img src="https://raw.githubusercontent.com/mnfst/manifest/HEAD/.github/assets/logo-dark.svg" alt="Manifest" height="53" title="Manifest"/>
  </picture>
</p>
<p align="center">
  <a href="https://github.com/mnfst/manifest/stargazers"><img src="https://img.shields.io/github/stars/mnfst/manifest?style=flat" alt="GitHub stars" /></a>
  &nbsp;
  <a href="https://github.com/mnfst/manifest/blob/main/LICENSE"><img src="https://img.shields.io/github/license/mnfst/manifest?color=blue" alt="license" /></a>
  &nbsp;
  <a href="https://discord.gg/FepAked3W7"><img src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
</p>

## What is Manifest?

Manifest is a smart model router for personal AI agents (OpenClaw, Hermes, OpenAI SDK, Vercel AI SDK, LangChain, cURL, and any OpenAI-compatible client). It sits between your agent and your LLM providers, scores each request, and routes it to the cheapest model that can handle it. Simple questions go to fast, cheap models. Hard problems go to expensive ones. You save money without thinking about it.

- Route requests to the right model: Cut costs up to 70%
- Automatic fallbacks: If a model fails, the next one picks up
- Set limits: Don't exceed your budget

![manifest-gh](https://github.com/user-attachments/assets/7dd74fc2-f7d6-4558-a95a-014ed754a125)

## Supported providers

Works with 300+ models across OpenAI, Anthropic, Google Gemini, DeepSeek, xAI, Mistral, Qwen, MiniMax, Kimi, Amazon Nova, OpenRouter, Ollama, and any provider with an OpenAI-compatible API.

## Manifest vs OpenRouter

|              | Manifest                                     | OpenRouter                                          |
| ------------ | -------------------------------------------- | --------------------------------------------------- |
| Architecture | Self-hosted or cloud-hosted — you own the data | Cloud proxy. All traffic goes through their servers |
| Cost         | Free                                         | 5% fee on every API call                            |
| Source code  | MIT, fully open                              | Proprietary                                         |
| Data privacy | Metadata only                                | Prompts and responses pass through a third party    |
| Transparency | Open scoring. You see why a model was chosen | No visibility into routing decisions                |

---

## Installation

### Option 1: Docker Compose (recommended)

Runs Manifest with a bundled PostgreSQL database. One command after you set a secret.

1. Download the compose file and env template:

```bash
curl -O https://raw.githubusercontent.com/mnfst/manifest/main/docker/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/mnfst/manifest/main/docker/.env.example
```

2. Generate a session secret and write it to `.env`:

```bash
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
```

3. Start it:

```bash
docker compose up -d
```

4. Open [http://localhost:3001](http://localhost:3001) and log in:
   - Email: `admin@manifest.build`
   - Password: `manifest`

**Change the admin password immediately** — the seeded credentials are insecure. Then connect a provider on the Routing page and you're set.

To stop:

```bash
docker compose down       # keeps data
docker compose down -v    # deletes everything
```

### Option 2: Docker Run (bring your own PostgreSQL)

If you already have PostgreSQL running:

```bash
docker run -d \
  -p 3001:3001 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/manifest \
  -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  -e BETTER_AUTH_URL=http://localhost:3001 \
  -e AUTO_MIGRATE=true \
  manifestdotbuild/manifest
```

`AUTO_MIGRATE=true` makes TypeORM migrations run on startup. The image defaults to `NODE_ENV=production` for production-grade security (trust proxy enabled, upstream errors sanitized, same-origin only).

### Verifying the image signature

Published images are signed with cosign keyless signing (Sigstore). Verify before pulling:

```bash
cosign verify manifestdotbuild/manifest:<version> \
  --certificate-identity-regexp="^https://github.com/mnfst/manifest/" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

### Custom port

If port 3001 is taken, change both the mapping and `BETTER_AUTH_URL`:

```bash
docker run -d \
  -p 8080:3001 \
  -e BETTER_AUTH_URL=http://localhost:8080 \
  ...
```

Or in `docker-compose.yml`:

```yaml
ports:
  - "8080:3001"
environment:
  - BETTER_AUTH_URL=http://localhost:8080
```

If you see "Invalid origin" on the login page, `BETTER_AUTH_URL` doesn't match the port you're using.

## Email setup (optional but recommended)

Manifest can send two kinds of email:

- **Login emails** — signup verification + password reset, triggered by Better Auth
- **Threshold alerts** — per-agent budget/token limit notifications

**Both are powered by the same `EMAIL_*` env vars.** Set one provider block in your `.env`:

### Resend (recommended for self-hosting)

No domain setup required. Sign up at https://resend.com and create an API key.

```env
EMAIL_PROVIDER=resend
EMAIL_API_KEY=re_your_api_key_here
EMAIL_FROM=noreply@yourdomain.com
```

### Mailgun

Requires a verified sending domain. Sign up at https://mailgun.com.

```env
EMAIL_PROVIDER=mailgun
EMAIL_API_KEY=key-your_api_key_here
EMAIL_DOMAIN=mg.yourdomain.com
EMAIL_FROM=noreply@mg.yourdomain.com
```

### SendGrid

Sign up at https://sendgrid.com and create an API key.

```env
EMAIL_PROVIDER=sendgrid
EMAIL_API_KEY=SG.your_api_key_here
EMAIL_FROM=noreply@yourdomain.com
```

### Without email configuration

If no email provider is set, Manifest still works:

- Users can sign up and log in immediately (email verification waived)
- Password reset is a no-op — reset via DB admin if needed
- Threshold alerts can still be configured per-user in the dashboard (Notifications → Email Provider) with an independent provider

Per-user configuration in the dashboard **overrides** the `EMAIL_*` env vars for that user's alerts, so multi-tenant deployments can layer per-user config on top of a server-wide fallback.

## OAuth logins (optional)

Enable Google, GitHub, or Discord logins by setting the matching env vars in your `.env`:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
```

Each provider activates automatically when both the ID and SECRET are set. Configure the OAuth callback URL with each provider to `${BETTER_AUTH_URL}/api/auth/callback/<provider>`.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BETTER_AUTH_SECRET` | Yes | -- | Session signing secret (min 32 chars). Generate with `openssl rand -hex 32`. |
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string |
| `BETTER_AUTH_URL` | No | `http://localhost:3001` | Public URL. Set this when deploying to a domain. |
| `PORT` | No | `3001` | Internal server port |
| `NODE_ENV` | No | `production` | Production-grade defaults (trust proxy, error sanitization) |
| `AUTO_MIGRATE` | No | `false` | Run TypeORM migrations on startup. Set `true` for self-hosted first boot. |
| `SEED_DATA` | No | `false` | Seed demo data + admin user on startup. Leave off in production after first boot. |
| `EMAIL_PROVIDER` | No | -- | Email service. One of: `resend`, `mailgun`, `sendgrid`. |
| `EMAIL_API_KEY` | No | -- | API key for the chosen email provider. |
| `EMAIL_DOMAIN` | No | -- | Sending domain. Required for `mailgun`, unused for `resend`/`sendgrid`. |
| `EMAIL_FROM` | No | `noreply@manifest.build` | Sender address for all outbound email. |
| `GOOGLE_CLIENT_ID` | No | -- | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | No | -- | Google OAuth client secret. |
| `GITHUB_CLIENT_ID` | No | -- | GitHub OAuth client ID. |
| `GITHUB_CLIENT_SECRET` | No | -- | GitHub OAuth client secret. |
| `DISCORD_CLIENT_ID` | No | -- | Discord OAuth client ID. |
| `DISCORD_CLIENT_SECRET` | No | -- | Discord OAuth client secret. |

Full env var reference: [github.com/mnfst/manifest](https://github.com/mnfst/manifest)

## Links

- [GitHub](https://github.com/mnfst/manifest)
- [Website](https://manifest.build)
- [Docs](https://manifest.build/docs)
- [Discord](https://discord.gg/FepAked3W7)

## License

[MIT](https://github.com/mnfst/manifest/blob/main/LICENSE)
