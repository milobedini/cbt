# Seeds

Three scripts, each with a different purpose, plus one orchestrator.

## TL;DR — fresh dev database

```bash
npm run seed:all
```

This chains `seed:baseline → seed:clinical-metadata → seed:admin-dev` and is
fail-fast. Use it whenever you want a clean dev DB with a populated admin
dashboard.

## Individual scripts

| Script | File | Destructive | Idempotent | Purpose |
|---|---|---|---|---|
| `seed:baseline` | `seedBaseline.ts` | **yes** — drops DB | deterministic rerun | baseline content + 90 users |
| `seed:clinical-metadata` | `seedClinicalMetadata.ts` | no | yes | PHQ-9/GAD-7/PDSS cutoffs + therapist tier backfill |
| `seed:admin-dev` | `seedAdminDev.ts` | no | **no** (fails on rerun) | 3 dev therapists + 30 dev patients + ~480 attempts |
| `seed:all` | — | yes (via `seed:baseline`) | no | orchestrator — chains all three |

### When to run each

- **Fresh dev DB with populated admin dashboard** — `npm run seed:all`.
- **Clinical definitions changed in code** — just `seed:clinical-metadata`.
  Safe to re-run any time.
- **Already reset, need to top up the admin dev dataset** — just
  `seed:admin-dev`. Will fail if `dev_ther_*` / `dev_pat_*` users already
  exist (unique-username collision).
- **Baseline only, no admin dashboard data** — just `seed:baseline`.

## 1. `seedBaseline.ts` — `npm run seed:baseline`

**Destructive.** Drops the entire database and reseeds everything from
scratch.

- **Content** — 3 programs, 9 modules, 42 questions, 23 score bands (all
  inlined).
- **Users** — 90 total: 5 admins, 25 therapists (bell-curve patient
  distribution), 60 patients (55 assigned, 5 unassigned).
- **Assignments** — ~170 with varied statuses, due dates, recurrence,
  therapist notes.
- **Attempts** — ~170 linked to assignments + self-started on open modules,
  with scoring, diary entries, and module snapshots.

### Key design decisions

- **Seeded PRNG** (mulberry32, seed `42`) — all random decisions are
  deterministic. Same seed = same database state. Dates are relative offsets
  from `new Date()` so data always looks fresh.
- **Single bcrypt hash** — password `12345678` is hashed once and reused for
  all 90 users.
- **Bidirectional therapist-patient linking** — both `patient.therapist` and
  `therapist.patients[]` are set.
- **Assignment-attempt consistency** — completed assignments have a matching
  submitted attempt with `latestAttempt` back-linked; in_progress assignments
  have a matching started attempt.
- **All users are email-verified** (`isVerified: true`). Therapist
  verification (`isVerifiedTherapist`) is mixed: ~18 verified, ~7 pending.

### Enriched test users

`admin1`, `therapist1`, and `patient1` are enriched with extra data for
testing:

- **admin1** — recent login, rich data visible via admin dashboard (from
  therapist1/patient1 activity).
- **therapist1** — verified, 10 patients (including patient1), patients have
  4-6 assignments each.
- **patient1** — assigned to therapist1, assignments covering every module
  (~13-16 total), mix of all statuses, extra abandoned and self-started
  attempts, activity diary entries.

These overrides are applied after the random distribution so the rest of the
data stays unchanged.

### Credentials

All users share password `12345678`:

- `patient1@test.com` through `patient60@test.com`
- `therapist1@test.com` through `therapist25@test.com`
- `admin1@test.com` through `admin5@test.com`

### Modifying seed data

- **Programs/modules/questions/bands** — edit the `PROGRAMS` constant
  (inline data, ~line 160).
- **User counts or distributions** — edit `seedUsers` function.
- **Assignment/attempt volumes** — edit `seedAssignments` / `seedAttempts`
  functions.
- **PRNG seed** — change `const SEED = 42` to get different (but still
  deterministic) data.
- **Name/note/activity pools** — edit the `FIRST_NAMES`, `LAST_NAMES`,
  `THERAPIST_NOTES`, `ACTIVITIES` constants.

## 2. `seedClinicalMetadata.ts` — `npm run seed:clinical-metadata`

Additive and idempotent. Safe to re-run any time.

- Sets `instrument`, `clinicalCutoff`, `reliableChangeDelta` on the
  questionnaire modules whose titles match PHQ-9, GAD-7, or PDSS:
  - PHQ-9 → cutoff 10, Δ 6
  - GAD-7 → cutoff 8, Δ 4
  - PDSS → cutoff 8, Δ null (reliable-improvement suppressed)
- Backfills `therapistTier: 'cbt'` on any verified therapist that doesn't
  already have a tier set.

Run this:

- After `seed:baseline` on a fresh DB (the baseline seed does not set
  clinical metadata). Part of `seed:all`.
- Any time clinical cutoffs or reliable-change deltas are updated in code.
- Never destructive — upserts module fields and backfills missing tiers
  only.

## 3. `seedAdminDev.ts` — `npm run seed:admin-dev`

Additive but **not idempotent** — creates users with fixed usernames
(`dev_ther_0..2`, `dev_pat_0..29`) and fails on rerun if those users already
exist. Refuses to run when `NODE_ENV === 'production'`.

- 3 extra verified therapists: 2 CBT, 1 PWP (so all three care tiers are
  populated).
- 30 extra patients: 10 self-help (no therapist), 10 assigned to the first
  CBT therapist, 10 assigned to the PWP therapist.
- ~480 PHQ-9 + GAD-7 attempts across 8 weekly intervals per patient, with
  ~40% of patients following a recovery arc and the rest staying near
  baseline. The date range is relative to `new Date()` — re-seeding never
  needs timestamp adjustments.

### Required prerequisites

- A Depression programme (from `seed:baseline`).
- An Anxiety programme (from `seed:baseline`).
- PHQ-9 and GAD-7 modules with `instrument` set (from
  `seed:clinical-metadata`).

If either is missing, the script exits with an error and a hint to run
`seed:all`.

### After running: rollups

The rollup job reads attempts to populate `MetricsRollup`. After
`seed:admin-dev` (or `seed:all`), either:

- Wait for the nightly cron at 02:00 Europe/London, or
- Run `npm run rollup-metrics` once to populate immediately.

The scheduler's on-boot catch-up
(`src/jobs/scheduler.ts::catchUpIfMissed`) will also backfill any missed
02:00 slots the next time the BE starts.

## Dependencies

All three scripts require `MONGO_URI` in `.env` (loaded via `dotenv` at the
top of each file). `seedAdminDev` additionally reads `NODE_ENV` and refuses
to run in production.
