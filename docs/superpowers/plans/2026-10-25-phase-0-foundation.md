# Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working monorepo skeleton with no business features: tooling, local infrastructure, design tokens, a shared UI kit, the responsive app shell, a NestJS API skeleton wired to the web app through a generated client, and a test harness (unit, integration, cross-device E2E, accessibility) running in CI.

**Architecture:** pnpm + Turborepo monorepo. `apps/web` (Next.js App Router) consumes `packages/ui` (shadcn on Base UI), `packages/design-tokens`, `packages/utils` and `packages/api-client` (Orval output generated from `apps/api`'s OpenAPI). `apps/api` is a NestJS modular monolith with Prisma/Postgres and Redis. Local infrastructure runs in Docker Compose.

**Tech Stack:** Node 24, pnpm 12, Turborepo, TypeScript strict, Next.js (App Router, React 19), Tailwind CSS v4, shadcn/ui (Base UI), Storybook, next-intl, next-themes, Serwist, NestJS, Prisma, PostgreSQL 17, Redis 7, Orval, TanStack Query, Vitest, Testcontainers, Playwright, @axe-core/playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-25-classloom-master-design.md` (sections 1, 2, 4, 5, 6 "Phase 0", 9). Design values: `docs/research/figma-design-system.md`.

## Global Constraints

- Node `>=24`; `packageManager` set to the installed pnpm (`pnpm@12.6.0`); `.npmrc` has `save-exact=true`. Every dependency is added at its latest stable version at scaffold time and pinned exactly. Record the resolved major versions of Next.js, NestJS, Prisma, Tailwind and Storybook in the root `README.md`.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true` in every package.
- Package scope `@classloom/*` (e.g. `@classloom/ui`, `@classloom/utils`).
- Ports: web `3000`, api `4000`, postgres `5432`, redis `6379`, minio `9000` (console `9001`), mailpit SMTP `1025` / UI `8025`, gotenberg `3001`, storybook `6006`.
- Locale `en` only, but every user-visible string in `apps/web` comes from `messages/en.json` via next-intl. No hard-coded copy in components (Storybook stories excepted).
- Dates display as `DD/MM/YYYY` in `Asia/Kolkata`; money is integer paise, displayed with Indian grouping (`₹1,23,456.78`).
- Icons come only from `@tabler/icons-react`. Font is Roboto via `next/font/google` (weights 400, 500, 600, 700).
- All text/background token pairs meet WCAG 2.1 AA: ≥ 4.5:1 for text, ≥ 3:1 for UI boundaries and large text.
- No horizontal page scroll at 375px width on any shell page.
- Commits follow Conventional Commits and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work happens on branch `phase-0/foundation`.

## Review Focus

1. **Figma colours used as text fail contrast.** Status pills, muted text and white-on-danger would ship unreadable. Task 4's contrast test pins the computed `*-strong` text tokens.
2. **Indian mobile numbers typed in many shapes** (`+91 98765 43210`, `098765-43210`, `919876543210`, `98765 43210`) must all normalise to `+919876543210`; an email with spaces or capitals must normalise to trimmed lowercase. This underpins the login identifier field (Task 2 tests).
3. **The IST date boundary at the academic-year change:** `2026-03-31T19:00:00Z` is already 1 April in India and belongs to academic year `2026-27` (Task 2 tests).
4. **Long labels at 375px** (school name, user name, nav labels) must truncate rather than overflow the page (Task 10 E2E asserts `scrollWidth <= innerWidth` on every device project).
5. **Errors leaking internals:** unknown routes and thrown errors must return RFC 7807 `application/problem+json` and never include a stack trace when `NODE_ENV=production` (Task 6 unit tests, Task 7 integration tests).

---

## File structure

```
package.json  pnpm-workspace.yaml  turbo.json  .npmrc  .nvmrc  .prettierrc.json  .prettierignore
commitlint.config.mjs  .husky/{pre-commit,commit-msg}  README.md
.github/workflows/ci.yml
docker/compose.yml  .env.example
packages/config/            tsconfig.base.json, tsconfig.{library,nextjs,nestjs}.json, eslint/{base,react,next,nest}.mjs, vitest.shared.ts
packages/utils/src/         money.ts, dates.ts, identifiers.ts, validators.ts, index.ts (+ *.test.ts beside each)
packages/design-tokens/src/ palette.ts, semantic.ts, contrast.ts, tokens.css, index.ts (+ contrast.test.ts)
packages/ui/                components.json, src/components/ui/* (shadcn), src/components/{page-header,status-pill,stat-card,icon-tile}.tsx,
                            src/lib/cn.ts, src/styles/globals.css, .storybook/*, src/stories/{tokens,typography,*.stories}.tsx
packages/contracts/src/     problem.ts, health.ts, index.ts
packages/api-client/        orval.config.ts, openapi.json (generated, committed), src/fetcher.ts, src/generated/* (generated, committed)
apps/api/src/               main.ts, app.module.ts, core/config/*, core/prisma/*, core/redis/*, core/health/*, core/http/problem.filter.ts, openapi.ts
apps/api/prisma/schema/     base.prisma
apps/api/test/              setup-containers.ts, health.int.test.ts, errors.int.test.ts
apps/web/src/               app/[locale]/{layout,page,not-found}.tsx, app/[locale]/(app)/{layout.tsx,dashboard/page.tsx}, app/manifest.ts, app/sw.ts,
                            i18n/{routing,request}.ts, middleware.ts, components/shell/*, config/nav.ts, lib/{nav-filter.ts,mock-session.ts,query-client.tsx}
apps/web/messages/en.json   apps/web/e2e/{shell.spec.ts,a11y.spec.ts}   apps/web/playwright.config.ts
```

---

### Task 1: Monorepo scaffold and tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `.nvmrc`, `.prettierrc.json`, `.prettierignore`, `commitlint.config.mjs`, `.husky/pre-commit`, `.husky/commit-msg`, `packages/config/**`, `README.md`

**Interfaces:**
- Produces: root scripts `dev`, `build`, `lint`, `typecheck`, `test`, `test:int`, `e2e`, `format`, `infra:up`, `infra:down`. Each runs `turbo run <task>`, except the `infra:*` scripts, which wrap docker compose (Task 3). Shared configs live in `@classloom/config` and are consumed via `extends`/import: `@classloom/config/tsconfig.library.json`, `tsconfig.nextjs.json`, `tsconfig.nestjs.json`, `@classloom/config/eslint/{base,react,next,nest}`, and `@classloom/config/vitest.shared` (exports `sharedVitestConfig`).

- [ ] **Step 1:** Create a branch: `git switch -c phase-0/foundation`.
- [ ] **Step 2:** Write the root `package.json` (`private: true`, `engines.node: ">=24"`, `packageManager: "pnpm@12.6.0"`). Write `pnpm-workspace.yaml` with `apps/*` and `packages/*`. Write `turbo.json` with tasks `build` (dependsOn `^build`, outputs `dist/**`, `.next/**` excluding `.next/cache/**`), `dev` (persistent, no cache), `lint`, `typecheck` (dependsOn `^build`), `test`, `test:int` (no cache), `e2e` (no cache).
- [ ] **Step 3:** Create `packages/config` with the tsconfigs (base: `strict`, `noUncheckedIndexedAccess`, `moduleResolution: "bundler"`, `target: "ES2023"`; the nestjs variant uses `module: "nodenext"`, `emitDecoratorMetadata`, `experimentalDecorators`), the ESLint flat configs (typescript-eslint recommended-type-checked, react-hooks, `@next/eslint-plugin-next` for `next`, import sorting), Prettier config (`singleQuote`, `semi`, `printWidth: 100`, `prettier-plugin-tailwindcss`) and `vitest.shared.ts`.
- [ ] **Step 4:** Add husky + lint-staged (prettier + eslint --fix on staged files) and commitlint with `@commitlint/config-conventional`.
- [ ] **Step 5:** Verify the tooling. Run `pnpm install && pnpm lint && pnpm typecheck`. Expected: exits 0 (no packages with sources yet). Run `echo "bad message" | pnpm commitlint`. Expected: non-zero exit with a `subject-empty` / `type-empty` error.
- [ ] **Step 6:** Write `README.md` (prerequisites, `pnpm install`, `pnpm infra:up`, `pnpm dev`, test commands, port table, pinned major versions), then commit: `chore: scaffold pnpm/turbo monorepo with shared tooling`.

### Task 2: `@classloom/utils` — Indian formatting and validation (TDD)

**Files:**
- Create: `packages/utils/{package.json,tsconfig.json,vitest.config.ts}`, `src/money.ts`, `src/dates.ts`, `src/identifiers.ts`, `src/validators.ts`, `src/index.ts`
- Test: `src/money.test.ts`, `src/dates.test.ts`, `src/identifiers.test.ts`, `src/validators.test.ts`

**Interfaces:**
- Produces:
  - `formatINR(paise: number, opts?: { decimals?: boolean }): string`
  - `formatDateIN(input: Date | string): string` (DD/MM/YYYY in Asia/Kolkata)
  - `toISTDateString(input: Date | string): string` (YYYY-MM-DD in IST)
  - `academicYearOf(input: Date | string, startMonth?: number): string` (default `startMonth = 4`, returns `"2026-27"`)
  - `type Identifier = { kind: 'email'; value: string } | { kind: 'mobile'; value: string } | { kind: 'invalid'; value: string }`
  - `parseIdentifier(raw: string): Identifier`
  - `normalizeIndianMobile(raw: string): string | null` (returns E.164 `+91XXXXXXXXXX`)
  - `isValidPincode(s: string): boolean`, `isValidAadhaar(s: string): boolean` (12 digits, first digit 2–9, Verhoeff checksum), `maskAadhaar(s: string): string`, `isValidIFSC(s: string): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// money.test.ts
expect(formatINR(12345678)).toBe('₹1,23,456.78');
expect(formatINR(0)).toBe('₹0.00');
expect(formatINR(-50000)).toBe('-₹500.00');
expect(formatINR(1000000000)).toBe('₹1,00,00,000.00');
expect(formatINR(12345678, { decimals: false })).toBe('₹1,23,457');
// dates.test.ts
expect(formatDateIN('2026-03-31T19:00:00Z')).toBe('01/04/2026');
expect(toISTDateString('2026-03-31T18:29:59Z')).toBe('2026-03-31');
expect(academicYearOf('2026-03-31T19:00:00Z')).toBe('2026-27');
expect(academicYearOf('2026-03-31T18:29:59Z')).toBe('2025-26');
expect(academicYearOf('2026-06-15', 6)).toBe('2026-27');
// identifiers.test.ts
for (const raw of ['+91 98765 43210', '098765-43210', '919876543210', '98765 43210', '9876543210'])
  expect(parseIdentifier(raw)).toEqual({ kind: 'mobile', value: '+919876543210' });
expect(parseIdentifier('  Priya.Sharma@Gmail.COM ')).toEqual({ kind: 'email', value: 'priya.sharma@gmail.com' });
expect(parseIdentifier('12345').kind).toBe('invalid');
expect(parseIdentifier('5876543210').kind).toBe('invalid'); // Indian mobiles start 6–9
expect(normalizeIndianMobile('+1 415 555 0100')).toBeNull();
// validators.test.ts
expect(isValidPincode('248001')).toBe(true);
expect(isValidPincode('048001')).toBe(false);
expect(isValidAadhaar('234123412346')).toBe(true);   // valid Verhoeff
expect(isValidAadhaar('234123412341')).toBe(false);  // bad checksum
expect(isValidAadhaar('123412341234')).toBe(false);  // starts with 1
expect(maskAadhaar('234123412346')).toBe('XXXX-XXXX-2346');
expect(isValidIFSC('SBIN0001234')).toBe(true);
expect(isValidIFSC('SBIN1001234')).toBe(false);      // 5th char must be 0
```

- [ ] **Step 2:** Run `pnpm --filter @classloom/utils test`. Expected: FAIL (modules not found).
- [ ] **Step 3:** Implement the functions. `formatINR` uses `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` on `paise / 100`. The date functions use `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'` (no date library needed here). `parseIdentifier` treats input containing `@` as an email (simple RFC-lite regex), otherwise strips spaces, dashes and parentheses and delegates to `normalizeIndianMobile`. The Verhoeff check uses the standard d/p tables.
- [ ] **Step 4:** Run `pnpm --filter @classloom/utils test`. Expected: PASS. Then run `pnpm typecheck`.
- [ ] **Step 5:** Commit: `feat(utils): add INR, IST date, identifier and Indian ID validators`.

### Task 3: Local infrastructure (Docker Compose)

**Files:**
- Create: `docker/compose.yml`, `.env.example`
- Modify: `package.json` (`infra:up` = `docker compose -f docker/compose.yml --env-file .env up -d --wait`, `infra:down` = `... down`)

**Interfaces:**
- Produces: env vars used by later tasks: `DATABASE_URL=postgresql://classloom:classloom@localhost:5432/classloom`, `REDIS_URL=redis://localhost:6379`, `S3_ENDPOINT=http://localhost:9000`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET=classloom-dev`, `SMTP_URL=smtp://localhost:1025`, `GOTENBERG_URL=http://localhost:3001`, `API_PORT=4000`, `NEXT_PUBLIC_API_URL=http://localhost:4000`, `WEB_ORIGIN=http://localhost:3000`.

- [ ] **Step 1:** Write `compose.yml` with services `postgres:17-alpine`, `redis:7-alpine`, `minio/minio` (+ a one-shot `minio/mc` service creating `classloom-dev`), `axllent/mailpit`, `gotenberg/gotenberg:8` (host port 3001 → container 3000). Every long-running service gets a `healthcheck` and a named volume where it holds data.
- [ ] **Step 2:** Run `cp .env.example .env && pnpm infra:up`. Expected: the command returns after all services report `healthy`. `docker compose -f docker/compose.yml ps` shows 5 running services, all healthy.
- [ ] **Step 3:** Smoke-check the services. `curl -s localhost:8025` returns HTML; `curl -s -o /dev/null -w "%{http_code}" localhost:3001/health` prints `200`.
- [ ] **Step 4:** Commit: `chore(infra): add docker compose for postgres, redis, minio, mailpit, gotenberg`.

### Task 4: `@classloom/design-tokens` (TDD on contrast)

**Files:**
- Create: `packages/design-tokens/{package.json,tsconfig.json}`, `src/palette.ts`, `src/semantic.ts`, `src/contrast.ts`, `src/tokens.css`, `src/index.ts`
- Test: `src/contrast.test.ts`

**Interfaces:**
- Produces:
  - `palette` (every ramp from `docs/research/figma-design-system.md`, keyed like `palette.primary[500]`, `palette.grey[700]`, plus `brand`/`system` singles)
  - `semantic: { light: Record<SemanticToken, string>; dark: Record<SemanticToken, string> }`
  - `contrastRatio(fg: string, bg: string): number` (WCAG relative luminance)
  - CSS export `@classloom/design-tokens/tokens.css`, which defines the raw ramps as `--cl-<ramp>-<step>` and the semantic tokens as shadcn variables under `:root` and `.dark`, then exposes them to Tailwind v4 via `@theme inline` (`--color-primary: var(--primary)` etc.), including `--font-sans`, `--radius`, and the type-scale utilities.
- Semantic values to pin (light / dark):

| token | light | dark |
|---|---|---|
| background (canvas) | `#F4F6FA` | `#0F0C1C` |
| foreground | `#202C4B` | `#EFEFF2` |
| card / popover | `#FFFFFF` | `#1B1632` |
| muted-foreground | `#515B73` | `#B9B7C0` |
| subtle-foreground (placeholder, on card/input only) | `#6A7287` | `#8C8997` |
| border / input | `#E6E8EB` | `#322D46` |
| primary / primary-foreground | `#3D5EE1` / `#FFFFFF` | `#3D5EE1` / `#FFFFFF` |
| primary-text (links, active nav text) | `#3D5EE1` | `#778EEA` |
| accent (active nav bg) | `#F2F5FF` | `#322D46` |
| secondary | `#6FCCD8` | `#6FCCD8` |
| destructive / destructive-foreground | `#E32545` / `#FFFFFF` | same |
| ring | `#3D5EE1` | `#778EEA` |
| `{success,warning,danger,info,sky,secondary,violet,pink,orange,green,red}-tint` | Figma "transparent"/100 tints | same hue at 15% alpha over card |
| `success-strong` `#128110` · `warning-strong` `#8F6D00` · `danger-strong` `#D1223F` · `info-strong` `#0F65CD` · `sky-strong` `#03799C` · `secondary-strong` `#437A82` · `violet-strong` `#673AB7` · `pink-strong` `#C33476` · `orange-strong` `#AF570E` · `green-strong` `#217E5F` · `red-strong` `#D12424` | (text on matching tint) | dark: use the 500 step of each ramp (verify by test) |
| radius | `0.375rem` (6px) | — |

- [ ] **Step 1: Write the failing test**

```ts
const AA = 4.5, UI = 3;
test.each(['light', 'dark'] as const)('%s text pairs meet AA', (mode) => {
  const s = semantic[mode];
  expect(contrastRatio(s.foreground, s.background)).toBeGreaterThanOrEqual(AA);
  expect(contrastRatio(s['muted-foreground'], s.background)).toBeGreaterThanOrEqual(AA);
  expect(contrastRatio(s['muted-foreground'], s.card)).toBeGreaterThanOrEqual(AA);
  expect(contrastRatio(s['subtle-foreground'], s.card)).toBeGreaterThanOrEqual(AA);
  expect(contrastRatio(s['primary-foreground'], s.primary)).toBeGreaterThanOrEqual(AA);
  expect(contrastRatio(s['primary-text'], s.card)).toBeGreaterThanOrEqual(AA);
  expect(contrastRatio(s['destructive-foreground'], s.destructive)).toBeGreaterThanOrEqual(AA);
  expect(contrastRatio(s.ring, s.card)).toBeGreaterThanOrEqual(UI);
  for (const hue of STATUS_HUES) expect(contrastRatio(s[`${hue}-strong`], s[`${hue}-tint`])).toBeGreaterThanOrEqual(AA);
});
test('known ratio', () => expect(contrastRatio('#FFFFFF', '#3D5EE1')).toBeCloseTo(5.4, 1));
```

- [ ] **Step 2:** Run `pnpm --filter @classloom/design-tokens test`. Expected: FAIL.
- [ ] **Step 3:** Implement `palette.ts`, `semantic.ts` (export `STATUS_HUES`), `contrast.ts` and `tokens.css`. In dark mode, compute each tint as an opaque hex (the hue blended at 15% over `#1B1632`) so the test can measure it.
- [ ] **Step 4:** Run the test. Expected: PASS. If a dark `*-strong` 500 step fails, move it one step lighter (600, 700…) until it passes, and note the change in a comment in `semantic.ts`.
- [ ] **Step 5:** Commit: `feat(tokens): add Figma-derived palette and AA-checked semantic tokens`.

### Task 5: `@classloom/ui` — shadcn kit, composites, Storybook

**Files:**
- Create: `packages/ui/{package.json,tsconfig.json,components.json,vitest.config.ts}`, `src/styles/globals.css` (imports `tailwindcss` and `@classloom/design-tokens/tokens.css`), `src/lib/cn.ts`, `src/components/ui/*` (via shadcn CLI, Base UI flavour), `src/components/{page-header,status-pill,stat-card,icon-tile}.tsx`, `.storybook/{main,preview}.ts`, `src/stories/*`
- Test: `src/components/status-pill.test.tsx`, `src/components/page-header.test.tsx`

**Interfaces:**
- Consumes: `tokens.css` (Task 4).
- Produces (exports from `@classloom/ui`):
  - `cn(...classes: ClassValue[]): string`
  - shadcn components: `Button, Input, Label, Card*, Badge, Avatar*, DropdownMenu*, Sheet*, Tooltip*, Separator, Skeleton, Breadcrumb*, Command*, Dialog*, ScrollArea, Collapsible*, Sidebar*` (the shadcn `sidebar` block supplies `SidebarProvider`, `Sidebar`, `SidebarTrigger`, `useSidebar`, with `collapsible="icon"` and mobile sheet built in)
  - `StatusPill({ tone, children }: { tone: 'success'|'warning'|'danger'|'info'|'neutral'; children: ReactNode })`, which renders a dot + text using `bg-<tone>-tint text-<tone>-strong`
  - `PageHeader({ title, breadcrumbs, actions }: { title: string; breadcrumbs: { label: string; href?: string }[]; actions?: ReactNode })`
  - `IconTile({ tone, icon }: { tone: Hue; icon: TablerIcon })`
  - `StatCard({ label, value, delta?, tone, icon, footer? })`

- [ ] **Step 1:** Initialise shadcn in `packages/ui` (`pnpm dlx shadcn@latest init`, choosing the Base UI primitives and `src/components/ui` as the alias). Follow `.agents/skills/shadcn/SKILL.md` and its `rules/`. Add the components listed above.
- [ ] **Step 2: Write the failing tests**

```tsx
render(<StatusPill tone="success">Active</StatusPill>);
expect(screen.getByText('Active')).toHaveClass('text-success-strong');
render(<PageHeader title="Students" breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Students' }]} actions={<button>Add</button>} />);
expect(screen.getByRole('heading', { level: 1, name: 'Students' })).toBeInTheDocument();
expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toBeInTheDocument();
expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
expect(screen.getByText('Students', { selector: '[aria-current="page"]' })).toBeInTheDocument();
```

- [ ] **Step 3:** Run `pnpm --filter @classloom/ui test`. Expected: FAIL.
- [ ] **Step 4:** Implement the four composites. On small screens, `PageHeader` stacks its actions under the title (`flex-col sm:flex-row`); the title truncates.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Set up Storybook (React + Vite builder, the Tailwind `globals.css` import, a theme toolbar toggling `.dark`, and `@storybook/addon-a11y`). Add stories: `Tokens/Colors` (every ramp + semantic swatches with their contrast ratios), `Tokens/Typography` (the Figma type scale), `Tokens/Spacing & Radius`, and one story per composite showing every tone in both themes.
- [ ] **Step 7:** Run `pnpm --filter @classloom/ui storybook:build`. Expected: builds with no a11y addon violations on the composite stories. Open `pnpm --filter @classloom/ui storybook` and compare `Tokens/Colors` with Figma node `5028:565054` by eye.
- [ ] **Step 8:** Commit: `feat(ui): add shadcn kit, Classloom composites and token Storybook`.

### Task 6: `@classloom/contracts` + API skeleton

**Files:**
- Create: `packages/contracts/src/{problem.ts,health.ts,index.ts}`; `apps/api/{package.json,tsconfig.json,nest-cli.json,vitest.config.ts}`, `src/main.ts`, `src/app.module.ts`, `src/core/config/{env.schema.ts,config.module.ts}`, `src/core/prisma/{prisma.service.ts,prisma.module.ts}`, `src/core/redis/{redis.service.ts,redis.module.ts}`, `src/core/health/{health.controller.ts,health.module.ts}`, `src/core/http/problem.filter.ts`, `src/openapi.ts`, `prisma/schema/base.prisma`
- Test: `src/core/config/env.schema.test.ts`, `src/core/http/problem.filter.test.ts`

**Interfaces:**
- Produces:
  - `problemDetailsSchema` (Zod): `{ type: string; title: string; status: number; detail?: string; instance?: string; errors?: { path: string; message: string }[] }`, plus `type ProblemDetails`
  - `healthResponseSchema`: `{ status: 'ok' | 'error'; checks: { database: 'up' | 'down'; redis: 'up' | 'down' } }`, plus `type HealthResponse`
  - `parseEnv(raw: NodeJS.ProcessEnv): Env`, which throws listing every invalid/missing key. `Env` contains `NODE_ENV`, `API_PORT`, `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN`.
  - `ProblemFilter` (global `ExceptionFilter`), which maps `HttpException` to its status, Zod validation errors to 400 with `errors[]`, and anything else to 500 `title: "Internal Server Error"`. It responds with `content-type: application/problem+json`. A `stack` field is included only when `NODE_ENV !== 'production'`.
  - `createApp(env: Env): Promise<INestApplication>` exported from `main.ts` (used by integration tests), with helmet, CORS for `WEB_ORIGIN` (credentials true), `nestjs-pino`, a global `ZodValidationPipe` (nestjs-zod), the `ProblemFilter`, and Swagger at `/docs` (JSON at `/docs-json`)
  - `GET /health → HealthResponse` (200 when both checks are up, 503 otherwise)
  - Script `pnpm --filter api openapi:export` writes `packages/api-client/openapi.json`

- [ ] **Step 1: Write the failing unit tests**

```ts
expect(() => parseEnv({})).toThrow(/DATABASE_URL.*REDIS_URL|REDIS_URL.*DATABASE_URL/s);
expect(parseEnv(validEnv).API_PORT).toBe(4000);           // coerced from "4000"
// problem.filter.test.ts (call the filter with a mocked ArgumentsHost)
// NotFoundException → status 404, body.title 'Not Found', header application/problem+json
// new Error('boom') with NODE_ENV=production → status 500, body has no 'stack' and detail does not contain 'boom'
// new Error('boom') with NODE_ENV=development → body.stack defined
```

- [ ] **Step 2:** Run `pnpm --filter api test`. Expected: FAIL.
- [ ] **Step 3:** Implement contracts, config, the filter, Prisma (`base.prisma` holds the `datasource` + `generator` only, with `prismaSchemaFolder`-style multi-file layout; no models yet), Redis (ioredis), health (`SELECT 1` and `PING`), `createApp` and `openapi.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then, with infra up, run `pnpm --filter api dev`. `curl localhost:4000/health` returns `{"status":"ok","checks":{"database":"up","redis":"up"}}`; `curl -i localhost:4000/nope` returns `404` with `content-type: application/problem+json`; `localhost:4000/docs` renders.
- [ ] **Step 5:** Commit: `feat(api): add NestJS skeleton with env validation, problem+json errors and health`.

### Task 7: API integration tests with Testcontainers

**Files:**
- Create: `apps/api/test/setup-containers.ts`, `apps/api/vitest.int.config.ts`
- Test: `apps/api/test/health.int.test.ts`, `apps/api/test/errors.int.test.ts`

**Interfaces:**
- Consumes: `createApp(env)` (Task 6).
- Produces: `startTestInfra(): Promise<{ env: Env; stop(): Promise<void> }>` (starts `postgres:17-alpine` + `redis:7-alpine` containers). Every later module's integration tests reuse this helper. Script `test:int`.

- [ ] **Step 1: Write the failing tests**

```ts
// health.int.test.ts
const res = await request(app.getHttpServer()).get('/health');
expect(res.status).toBe(200);
expect(healthResponseSchema.parse(res.body)).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
// after stopping the redis container:
expect((await request(server).get('/health')).status).toBe(503);
// errors.int.test.ts
const r = await request(server).get('/does-not-exist');
expect(r.status).toBe(404);
expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
expect(problemDetailsSchema.parse(r.body).status).toBe(404);
```

- [ ] **Step 2:** Run `pnpm --filter api test:int`. Expected: FAIL (helper missing).
- [ ] **Step 3:** Implement `startTestInfra` with `@testcontainers/postgresql` and `@testcontainers/redis`.
- [ ] **Step 4:** Run `pnpm --filter api test:int`. Expected: PASS (Docker must be running).
- [ ] **Step 5:** Commit: `test(api): add Testcontainers integration harness`.

### Task 8: `@classloom/api-client` (Orval)

**Files:**
- Create: `packages/api-client/{package.json,tsconfig.json,orval.config.ts}`, `src/fetcher.ts`, `src/index.ts`; generated `openapi.json` and `src/generated/**` (committed)
- Test: `src/fetcher.test.ts`

**Interfaces:**
- Consumes: `openapi:export` (Task 6), `problemDetailsSchema` (Task 6).
- Produces:
  - `class ApiError extends Error { status: number; problem: ProblemDetails }`
  - `apiFetch<T>(config: { url: string; method: string; params?: object; data?: unknown; headers?: HeadersInit; signal?: AbortSignal }): Promise<T>` (the Orval custom mutator; base URL from `NEXT_PUBLIC_API_URL`, `credentials: 'include'`, throws `ApiError` on non-2xx)
  - generated `useGetHealth()` (TanStack Query, react-query client)
  - Script `pnpm --filter @classloom/api-client generate` (runs the API export, then orval). CI fails if regeneration produces a diff.

- [ ] **Step 1: Write the failing test** (mock `fetch`)

```ts
// 404 problem response
await expect(apiFetch({ url: '/x', method: 'GET' })).rejects.toMatchObject({ status: 404, problem: { title: 'Not Found' } });
// non-JSON 502 from a proxy
await expect(apiFetch({ url: '/x', method: 'GET' })).rejects.toMatchObject({ status: 502, problem: { title: 'Bad Gateway' } });
// 200
await expect(apiFetch({ url: '/health', method: 'GET' })).resolves.toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
```

- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement `fetcher.ts`, configure orval (`client: 'react-query'`, `mutator: src/fetcher.ts#apiFetch`), and generate.
- [ ] **Step 4:** Run `pnpm --filter @classloom/api-client test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api-client): generate typed client and query hooks from OpenAPI`.

### Task 9: Web app shell (Next.js, i18n, theme, PWA)

**Files:**
- Create: `apps/web/{package.json,tsconfig.json,next.config.ts,postcss.config.mjs,vitest.config.ts}`, `src/middleware.ts`, `src/i18n/{routing.ts,request.ts}`, `messages/en.json`, `src/app/[locale]/{layout.tsx,page.tsx,not-found.tsx}`, `src/app/[locale]/(app)/{layout.tsx,dashboard/page.tsx}`, `src/app/manifest.ts`, `src/app/sw.ts`, `public/icons/*`, `src/config/nav.ts`, `src/lib/{nav-filter.ts,mock-session.ts,query-client.tsx}`, `src/components/shell/{app-sidebar.tsx,campus-switcher.tsx,topbar.tsx,academic-year-switcher.tsx,theme-toggle.tsx,user-menu.tsx,command-search.tsx,mobile-tab-bar.tsx,api-status.tsx}`
- Test: `src/lib/nav-filter.test.ts`

**Interfaces:**
- Consumes: `@classloom/ui` (Task 5), `useGetHealth` (Task 8), `formatDateIN` (Task 2).
- Produces:
  - `type NavItem = { key: string; href: string; icon: TablerIcon; permission?: string; children?: NavItem[] }`; `type NavGroup = { key: string; items: NavItem[] }`. Labels come from i18n `nav.<key>`.
  - `navConfig: NavGroup[]` (Phase 0 groups: Main → Dashboard; People → Students, Admissions, Parents, Staff; Academic → Classes, Subjects, Timetable; Finance → Fees; Settings → School profile, Users & roles. Non-dashboard links go to a localised "Coming soon" page.)
  - `filterNav(groups: NavGroup[], permissions: ReadonlySet<string>): NavGroup[]`
  - `getMockSession(): { user: { name: string; avatarUrl?: string }; role: 'admin'|'teacher'|'parent'|'student'; permissions: Set<string>; campus: { id: string; name: string }; academicYear: string }`. This is replaced by real auth in Phase 1.

- [ ] **Step 1: Write the failing test**

```ts
const groups = [{ key: 'people', items: [
  { key: 'students', href: '/students', icon: X, permission: 'students.read' },
  { key: 'fees', href: '/fees', icon: X, permission: 'fees.read', children: [{ key: 'collect', href: '/fees/collect', icon: X, permission: 'fees.collect' }] },
] }, { key: 'empty', items: [{ key: 'hidden', href: '/h', icon: X, permission: 'nope' }] }];
const out = filterNav(groups, new Set(['students.read', 'fees.read']));
expect(out.map(g => g.key)).toEqual(['people']);                // empty groups dropped
expect(out[0].items.map(i => i.key)).toEqual(['students', 'fees']);
expect(out[0].items[1].children).toEqual([]);                   // child without permission removed
expect(filterNav(groups, new Set())).toEqual([]);
// items without `permission` are always visible
```

- [ ] **Step 2:** Run `pnpm --filter web test`. Expected: FAIL.
- [ ] **Step 3:** Implement `filterNav`. Run the test. Expected: PASS.
- [ ] **Step 4:** Build the shell. `[locale]/layout.tsx` sets up Roboto, `NextIntlClientProvider`, `ThemeProvider` (`attribute="class"`), `QueryClientProvider` and `<Toaster/>`. `(app)/layout.tsx` renders `SidebarProvider` → `AppSidebar` (logo, `CampusSwitcher`, `filterNav(navConfig, session.permissions)`, `collapsible="icon"`) + `SidebarInset` (`Topbar` with `SidebarTrigger`, ⌘K `CommandSearch` listing nav pages, `AcademicYearSwitcher`, `ThemeToggle`, notifications icon button, `UserMenu`) + `<main>`. `MobileTabBar` renders below `md` only for the `teacher`/`parent`/`student` roles. The dashboard page shows a `PageHeader`, four placeholder `StatCard`s and `ApiStatus` (a `StatusPill` driven by `useGetHealth`: "API online" success / "API offline" danger). Every string goes in `messages/en.json`; long text uses `truncate` + `min-w-0`.
- [ ] **Step 5:** Add PWA support: `manifest.ts` (name "Classloom", theme `#3D5EE1`, background `#F4F6FA`, 192/512 icons and a maskable icon) and Serwist (`sw.ts`, enabled in production builds only).
- [ ] **Step 6:** Run `pnpm infra:up && pnpm dev`. Open `http://localhost:3000` (redirects to `/en/dashboard`). The shell renders; "API online" shows; the sidebar collapses to icons on desktop and opens as a sheet at 375px; dark mode toggles; ⌘K opens search.
- [ ] **Step 7:** Run `pnpm --filter web build`. Expected: succeeds; `/manifest.webmanifest` is served by `pnpm --filter web start`.
- [ ] **Step 8:** Commit: `feat(web): add responsive app shell with i18n, theming, PWA and API status`.

### Task 10: Cross-device E2E + accessibility harness

**Files:**
- Create: `apps/web/playwright.config.ts`
- Test: `apps/web/e2e/shell.spec.ts`, `apps/web/e2e/a11y.spec.ts`

**Interfaces:**
- Consumes: the shell (Task 9), the API (Task 6).
- Produces: Playwright projects `desktop-chrome`, `desktop-firefox`, `desktop-webkit`, `pixel-7`, `iphone-14`, `ipad`; `webServer` entries start the api (`:4000`) and web (`:3000`, production build) against running infra. Script `e2e`. Screenshots are saved as artifacts in `test-results/` (not snapshot assertions yet).

- [ ] **Step 1: Write the tests**

```ts
// shell.spec.ts
test('dashboard renders with API online', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('API online')).toBeVisible();
});
test('no horizontal overflow', async ({ page }) => {
  await page.goto('/en/dashboard');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('navigation is reachable', async ({ page, isMobile }) => {
  await page.goto('/en/dashboard');
  if (isMobile) await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  await expect(page.getByRole('link', { name: 'Students' })).toBeVisible();
});
test('theme toggle persists', async ({ page }) => {
  await page.goto('/en/dashboard');
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
});
test('unknown page shows localized 404', async ({ page }) => {
  const res = await page.goto('/en/definitely-missing');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
// a11y.spec.ts: run in light and dark
const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
expect(results.violations).toEqual([]);
```

- [ ] **Step 2:** Run `pnpm --filter web exec playwright install --with-deps && pnpm e2e`. Expected: all tests pass on all 6 projects. Fix any shell defects found (most likely: overflow from the top-bar controls at 375px; contrast of muted text). Re-run until green.
- [ ] **Step 3:** Commit: `test(web): add cross-device Playwright and axe accessibility suite`.

### Task 11: CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root scripts (Task 1), `infra:up` (Task 3), `generate` (Task 8).

- [ ] **Step 1:** Write the workflow (trigger on push and pull_request; `ubuntu-latest`; `pnpm/action-setup` + `actions/setup-node` with Node 24 and pnpm cache). Job `checks`: install → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm --filter @classloom/api-client generate && git diff --exit-code` → `pnpm build`. Job `integration`: `pnpm test:int` (Docker is available on the runner). Job `e2e`: `cp .env.example .env && pnpm infra:up` → Playwright install → `pnpm e2e` → upload `playwright-report` and `test-results` as artifacts on failure.
- [ ] **Step 2:** Validate locally with `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build && pnpm e2e`. Expected: all green.
- [ ] **Step 3:** Commit: `ci: add lint, typecheck, unit, integration and e2e workflow`.
- [ ] **Step 4:** If a GitHub remote exists (ask the user before creating one or pushing), push the branch and open a PR. Expected: all three CI jobs pass.

---

## Phase 0 exit check (spec section 9)

- `pnpm infra:up` → 5 services healthy.
- `pnpm dev` → web `:3000` shows the shell with "API online"; api `:4000/health` returns ok; `/docs` shows OpenAPI.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int` → pass.
- `pnpm e2e` → pass on all 6 device projects with zero axe violations in light and dark.
- `pnpm --filter @classloom/ui storybook` → token pages match the Figma Design System frames.
- CI green (once a remote exists).
