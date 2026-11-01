# Classloom

Multi-school management SaaS for Indian schools: one portal for admissions, students, staff, attendance, fees, exams, communication and more.

- Master design: [docs/superpowers/specs/2026-10-25-classloom-master-design.md](docs/superpowers/specs/2026-10-25-classloom-master-design.md)
- Implementation plans: [docs/superpowers/plans/](docs/superpowers/plans/)
- Research (PreSkool sitemap, Figma design system): [docs/research/](docs/research/)

## Prerequisites

- Node.js 24 (`.nvmrc`)
- pnpm 12 (`corepack enable` picks up `packageManager` from `package.json`)
- Docker Desktop (local infrastructure and integration tests)

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm infra:up      # postgres, redis, s3 (RustFS), mailpit, gotenberg
pnpm db:migrate    # apply database migrations as the owner role
pnpm dev           # web on :3000, api on :4000
```

The Postgres roles (`classloom_owner`, `classloom_app`) are created by `docker/postgres/init` only
when the data volume is first initialised. If your local volume predates them, run
`docker compose -f docker/compose.yml down -v` once and then `pnpm infra:up` again (this wipes local
data).

## Deployment notes

- The browser reaches the API only through the web app's same-site `/api` rewrite, so the session
  cookie stays first party. `API_INTERNAL_URL` (where the web server reaches the API) is read
  when the web app is **built** (Next.js fixes rewrites at build time) and again at runtime for
  server-side calls: set it in both the build and the runtime environment.
- Playwright ports: `E2E_WEB_PORT` (default 3000) and `E2E_API_PORT` (default 4000) move the E2E
  servers aside when dev servers hold those ports. The `/api` rewrite target is fixed at build
  time, so build with the matching address, for example
  `API_INTERNAL_URL=http://localhost:4100 pnpm build` (`apps/web/turbo.json` passes the variable
  through and keys the build cache on it), then `E2E_API_PORT=4100 E2E_WEB_PORT=3200 pnpm e2e`.
  A Vercel build fails if `API_INTERNAL_URL` is not set.
- Set `TRUST_PROXY` on the API for the chosen hosts so rate limits see the browser address (see
  `docs/superpowers/followups/2026-10-27-tenancy.md`).

## Commands

| Command                             | What it does                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm dev`                          | Run all apps in watch mode                                                   |
| `pnpm build`                        | Build every package and app                                                  |
| `pnpm lint` / `pnpm typecheck`      | ESLint / TypeScript across the workspace                                     |
| `pnpm test`                         | Unit tests (Vitest)                                                          |
| `pnpm test:int`                     | API integration tests (Testcontainers; Docker must be running)               |
| `pnpm e2e`                          | Playwright across desktop and mobile device projects (needs `pnpm infra:up`) |
| `pnpm format`                       | Prettier                                                                     |
| `pnpm infra:up` / `pnpm infra:down` | Start / stop local infrastructure                                            |
| `pnpm db:migrate`                   | Apply Prisma migrations (owner role)                                         |

## Ports

| Service                          | Port        |
| -------------------------------- | ----------- |
| Web (Next.js)                    | 3000        |
| API (NestJS)                     | 4000        |
| PostgreSQL                       | 5432        |
| Redis                            | 6379        |
| RustFS (S3-compatible) / console | 9000 / 9001 |
| Mailpit SMTP / UI                | 1025 / 8025 |
| Gotenberg (PDF)                  | 3001        |
| Storybook                        | 6006        |

## Pinned major versions

Dependencies are pinned exactly (`saveExact: true` in `pnpm-workspace.yaml`).

| Tool             | Major                                          |
| ---------------- | ---------------------------------------------- |
| TypeScript       | 6.0 (typescript-eslint does not support 7 yet) |
| ESLint           | 10                                             |
| Turborepo        | 2                                              |
| Vitest           | 5                                              |                                                             | Tool | Version | Note |
| ---              | ---                                            | ---                                                         |
| Node.js          | 24                                             |                                                             |
| pnpm / Turborepo | 12 / 2                                         |                                                             |
| TypeScript       | 6.0                                            | typescript-eslint does not support 7 yet                    |
| ESLint           | 10                                             | flat config, per-package `eslint.config.mjs`                |
| Next.js          | 16                                             | App Router, Turbopack, `src/proxy.ts` (formerly middleware) |
| React            | 19                                             |                                                             |
| Tailwind CSS     | 4                                              | tokens generated by `@classloom/design-tokens`              |
| shadcn/ui        | Base UI flavour                                | Tabler icons                                                |
| Storybook        | 10                                             | `pnpm --filter @classloom/ui storybook`                     |
| NestJS           | 11                                             | 12 is ESM-only and not yet supported by nestjs-zod          |
| Prisma           | 7                                              | `prisma-client` generator with the pg driver adapter        |
| Zod              | 4                                              | shared schemas in `@classloom/contracts`                    |
| Orval            | 8                                              | `pnpm --filter @classloom/api-client generate`              |
| Vitest           | 5                                              |                                                             |
| Playwright       | 1.64                                           |                                                             |
