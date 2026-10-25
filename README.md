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
pnpm infra:up      # postgres, redis, minio, mailpit, gotenberg
pnpm dev           # web on :3000, api on :4000
```

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

## Ports

| Service              | Port        |
| -------------------- | ----------- |
| Web (Next.js)        | 3000        |
| API (NestJS)         | 4000        |
| PostgreSQL           | 5432        |
| Redis                | 6379        |
| MinIO (S3) / console | 9000 / 9001 |
| Mailpit SMTP / UI    | 1025 / 8025 |
| Gotenberg (PDF)      | 3001        |
| Storybook            | 6006        |

## Pinned major versions

Dependencies are pinned exactly (`saveExact: true` in `pnpm-workspace.yaml`).

| Tool       | Major                                          |
| ---------- | ---------------------------------------------- |
| TypeScript | 6.0 (typescript-eslint does not support 7 yet) |
| ESLint     | 10                                             |
| Turborepo  | 2                                              |
| Vitest     | 5                                              |
