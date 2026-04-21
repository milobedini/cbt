# CLAUDE.md

## Project

cbt — Node/Express backend API for the bwell therapy app. Serves a React Native (Expo) frontend with role-based access (Patient, Therapist, Admin) for CBT, PWP, and self-help workflows.

**Frontend:** The React Native (Expo) app lives at `../bwell` (`/Users/milobedini/Documents/git/bwell`).

## Stack

- **Runtime:** Node.js, Express 5.1
- **Language:** TypeScript (strict mode, `noImplicitAny`)
- **Database:** MongoDB with Mongoose 8
- **Auth:** JWT (7-day, HttpOnly cookie), bcryptjs for passwords
- **Email:** Mailtrap (transactional — verification, password reset)
- **Rate Limiting:** express-rate-limit (100 req/15min global, stricter on auth)
- **Time:** Luxon (London timezone for week boundaries)
- **Types:** Shared types published as `@milobedini/shared-types` from `src/shared-types/`

## Architecture

```
src/
├── config/          # MongoDB connection
├── controllers/     # Route handlers (auth, user, module, program, attempts, assignments, admin*)
├── jobs/            # Scheduled jobs: rollupMetrics + scheduler (cron + on-boot catch-up) + CLIs
├── middleware/      # Auth (JWT), role authorization
├── models/          # Mongoose schemas (User, Program, Module, Question, ModuleAttempt, ModuleAssignment, ScoreBand, MetricsRollup, AdminAuditEvent, JobRun)
├── routes/          # Express routers
├── seeds/           # Seed scripts (seedBaseline, seedClinicalMetadata, seedAdminDev) — see src/seeds/CLAUDE.md
├── shared-types/    # Published npm package (@milobedini/shared-types)
├── test-utils/      # Jest setup, in-memory Mongo helpers, factories
├── utils/           # Error handling, JWT, roles, attempt/diary/access, IAPT pairing, suppression, thresholds, audit, London buckets
├── mailtrap/        # Email client + templates
└── index.ts         # Express app setup, middleware stack, route mounting, startScheduler()
```

### Key patterns

- **Separation of concerns:** routes → controllers → utils → models
- **Module snapshot system** — questions are frozen at attempt time so history is preserved if content changes
- **Denormalized therapist field** — ModuleAttempt stores therapist ID for fast filtering without joins
- **Weekly grouping** — Activity Diary keyed by weekStart (Monday 00:00 London time → UTC)
- **Access policies** — modules can be `open` or `assigned` (assignment-only); resolved per user
- **Status lifecycles** — Attempts: started → submitted | abandoned; Assignments: assigned → in_progress → completed | cancelled
- **Score bands** — range-based interpretation (min–max) stored separately per module
- **Cursor pagination** — ISO timestamps for attempts; offset-based for admin user search
- **Lean queries** — `.lean()` on read-heavy paths to skip Mongoose document overhead
- **Aggregation pipelines** — used for complex grouping (therapist dashboard, latest per patient per module)

## Scheduled jobs & admin metrics

Authoritative spec: `../bwell/docs/superpowers/specs/2026-04-20-admin-overhaul-design.md`. Read that before changing anything in this subsystem — the rules below are summaries, not decisions.

### Trailing-90d snapshot model

Every `MetricsRollup` row is a **snapshot point**, not a data window. For each `(programmeId, careTier, instrument)` dimension and each bucket endpoint, we pair each patient's earliest + latest attempt whose `completedAt` falls in `[bucket.endsAt − 90d, bucket.endsAt)`, then apply IAPT recovery / reliable-improvement / reliable-recovery rules (see `src/utils/iaptPairing.ts`).

Consequences:

- `/admin/overview` reads the most recent snapshot row per dimension — it does **not** sum across buckets (which would double-count patients).
- `/admin/outcomes` returns a time-series where each bucket is the trailing-90d rate at that bucket's endpoint.
- Admin responses run through `applySuppression` (`src/utils/suppression.ts`) which enforces k-anonymity + min-N thresholds.

### Nightly rollup + catch-up

- `node-cron` inside the web process fires `runNightlyRollup` at **02:00 Europe/London** (`src/jobs/scheduler.ts`). Writes `thisWeek` + `prevWeek` + `thisMonth` (+ `prevMonth` on the 1st London-local).
- On BE boot, `catchUpIfMissed` replays every missed 02:00 slot between the last successful `JobRun.completedAt` and now, capped at 60 slots. Handles Render free-tier spin-down, deploy restarts, and local `npm run dev` after laptop sleep. De-duplicates against concurrent instances because both instances share Atlas.
- Manual triggers: `npm run rollup-metrics` (one run, today's slot) and `npm run rollup-metrics:backfill` (historical rebuild across N months + M weeks).
- Every job writes a `JobRun` document. `/admin/overview.rollupAsOf` surfaces the latest success.

### Admin audit log

- Write-path events call `logAdminAction(req, { action, resourceType, resourceId, outcome, context? })` from `src/utils/audit.ts`. The helper never throws — audit failures can't break the underlying mutation.
- `AuditedAction` is an explicit enum (`therapist.verified`, `user.viewed`, etc.). Add new actions to the enum in `src/shared-types/types.ts` and publish shared-types.

## Shared Types (`src/shared-types/`)

**This is critical.** All types and constants consumed by the frontend live in `src/shared-types/` and are published to npm as `@milobedini/shared-types`.

- **When to update:** any time you add or change a model, enum, API response shape, or constant that the frontend depends on
- **How to publish:** run `npm run publish` from the project root after updating types/constants
- **Structure:** `types.ts` (type-only exports), `constants.ts` (runtime values like `LONDON_TZ`, `SLOT_*`)
- **Export pattern:** types use `export type *`, constants use `export *`

If you add a new module type, status enum, response field, or shared constant — update shared-types and publish before the frontend can consume it.

## API Routes

| Prefix | Router | Key endpoints |
|--------|--------|---------------|
| `/api` | auth | register, login, verify-email, logout, forgot/reset-password |
| `/api/user` | user | profile, patients list, assignments, attempts, admin stats/therapists |
| `/api/modules` | modules | list, detail, create (admin), start attempt |
| `/api/programs` | programs | list, detail |
| `/api/attempts` | attempts | save progress, submit, patient/therapist views, timelines |
| `/api/assignments` | assignments | create, list, update status, delete |
| `/api/admin` | admin | overview, outcomes time-series, programme detail, audit log, system health (admin role only) |

## Auth & Security

- JWT in HttpOnly cookie (`token`), secure + SameSite:none in production
- Passwords hashed with bcrypt (salt 10)
- Verification/reset tokens hashed with SHA256 before storage
- CORS whitelist enforced (localhost:8081, expo URL, CLIENT_URL)
- Rate limiting: 15 attempts/15min on login/register, 10/15min on verify
- Generic responses on password reset to prevent user enumeration
- `trust proxy 1` for Render (reverse proxy)

## Database Models

| Model | Collection | Purpose |
|-------|-----------|---------|
| User | `users-data` | Auth, roles, therapist-patient relationships |
| Program | `programs` | Treatment programs (Depression, GAD, etc.) |
| Module | `modules` | Individual tools within programs |
| Question | `questions` | MCQ questions for questionnaire modules |
| ModuleAttempt | `moduleAttempts` | Patient work — answers, diary entries, scores |
| ModuleAssignment | `moduleAssignments` | Therapist-assigned homework |
| ScoreBand | `scoreBands` | Score interpretation ranges per module |
| MetricsRollup | `metricsRollups` | Pre-computed IAPT rollup snapshots (trailing-90d at bucket endpoint) |
| AdminAuditEvent | `adminAuditEvents` | Curated admin-action audit log (see `utils/audit.ts`) |
| JobRun | `jobRuns` | Scheduled-job observability (rollup start/end/status/rows) |

## Commands

- `npm run dev` — start dev server (nodemon + ts-node)
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run compiled output
- `npm test` — Jest (in-memory Mongo via `mongodb-memory-server`)
- `npm run publish` — publish shared-types to npm

### Seeds

Full details in `src/seeds/CLAUDE.md`. Short summary:

- `npm run seed:all` — **the default.** Chains `seed:baseline` → `seed:clinical-metadata` → `seed:admin-dev`. Drops the DB and repopulates everything needed for the admin dashboard.
- `npm run seed:baseline` — destructive: wipes DB, writes baseline content (3 programmes, 9 modules, 42 questions, 23 score bands) + 90 users.
- `npm run seed:clinical-metadata` — idempotent: sets PHQ-9/GAD-7/PDSS cutoffs + deltas, backfills `therapistTier='cbt'` on verified therapists.
- `npm run seed:admin-dev` — dev-only: adds 3 therapists + 30 patients with ~12 months of staggered PHQ-9/GAD-7 attempts. Not idempotent (fails on rerun).

### Rollup jobs

- `npm run rollup-metrics` — fires `runNightlyRollup(now)` once: writes `thisWeek` + `prevWeek` + `thisMonth` snapshots. Also runs automatically at 02:00 Europe/London via `node-cron` inside the web process and on-boot via `catchUpIfMissed` (cap 60 slots).
- `npm run rollup-metrics:backfill [months] [weeks]` — walks back N months and M weeks (defaults 12/12) writing one snapshot per bucket endpoint. Use after a fresh `seed:all` to populate historical sparkline data, or after any schema change that invalidates existing rollups.

## Database Access

Query MongoDB Atlas directly via `mongosh` using the `MONGO_URI` from `.env`:

```bash
mongosh "$(grep MONGO_URI .env | cut -d= -f2-)"
```

**Collection names** (note: these differ from model names and are **case-sensitive** — `jobruns` ≠ `jobRuns`):

- `users-data` (not `users`) — User documents
- `moduleAssignments` — Assignment documents
- `moduleAttempts` — Attempt documents
- `modules`, `programs`, `questions`, `scoreBands` — reference data
- `metricsRollups` — pre-computed IAPT rollup snapshots
- `adminAuditEvents` — curated admin audit log
- `jobRuns` — scheduled-job observability

Use `mongosh` for debugging data issues — check seed consistency, verify field values, and trace relationships between assignments and attempts.

## Environment Variables

```
PORT=3000
MONGO_URI=<MongoDB connection string>
JWT_SECRET=<required, especially in production>
NODE_ENV=development|production
MAILTRAP_TOKEN=<transactional email token>
CLIENT_URL=<frontend URL for password reset links>
MAILTRAP_OVERRIDE_EMAIL=<dev override for email delivery>

# Admin metrics (production defaults enforced via boot-guard in src/utils/thresholds.ts)
K_ANONYMITY_THRESHOLD=5              # min cell size before a rate is suppressed; prod floor 5
METRICS_MIN_N_FOR_DISPLAY=20         # min n before a rate is shown; prod floor 20
ROLLUP_JOB_ENABLED=true              # set `false` in tests to skip the cron
```

In dev, lower `K_ANONYMITY_THRESHOLD` and `METRICS_MIN_N_FOR_DISPLAY` to `1` to see populated percentages against a small seed dataset. Response payloads include `privacyMode: 'reduced'` when thresholds are below production floor.

## Code Conventions

- Arrow functions, `const` over `let`
- `async`/`await` throughout (no `.then()` chains)
- Named exports from controllers and utils
- Centralized error handling via `errorHandler(res, error)` in all controllers
- Mongoose schema validation for request data (no separate validation library)
- Controller functions follow pattern: parse request → validate → query/mutate → respond

## Adding a New CBT Tool

Each new tool typically requires:

1. New `ModuleType` enum value (in model + shared-types)
2. Mongoose model if the tool has unique data shape
3. Controller functions (start, save, submit, view)
4. Route definitions
5. Add a module entry to the relevant programme inside `src/seeds/seedBaseline.ts` (`PROGRAMS` constant)
6. Update shared-types and `npm run publish`
