# Seeds

Single unified seed script: `npm run seed-all` (runs `src/seeds/seedAll.ts`).

## What it does

Drops the entire database and reseeds everything from scratch:

1. **Content** — 3 programs, 9 modules, 42 questions, 23 score bands (all inlined)
2. **Users** — 90 total: 5 admins, 25 therapists (bell-curve patient distribution), 60 patients (55 assigned, 5 unassigned)
3. **Assignments** — ~170 with varied statuses, due dates, recurrence, therapist notes
4. **Attempts** — ~170 linked to assignments + self-started on open modules, with scoring, diary entries, and module snapshots

## Key design decisions

- **Seeded PRNG** (mulberry32, seed `42`) — all random decisions are deterministic. Same seed = same database state. Dates are relative offsets from `new Date()` so data always looks fresh.
- **Single bcrypt hash** — password `12345678` is hashed once and reused for all 90 users.
- **Bidirectional therapist-patient linking** — both `patient.therapist` and `therapist.patients[]` are set.
- **Assignment-attempt consistency** — completed assignments have a matching submitted attempt with `latestAttempt` back-linked; in_progress assignments have a matching started attempt.
- **All users are email-verified** (`isVerified: true`). Therapist verification (`isVerifiedTherapist`) is mixed: ~18 verified, ~7 pending.

## Credentials

All users share password `12345678`:

- `patient1@test.com` through `patient60@test.com`
- `therapist1@test.com` through `therapist25@test.com`
- `admin1@test.com` through `admin5@test.com`

## Modifying seed data

- **Programs/modules/questions/bands** — edit the `PROGRAMS` constant (inline data, ~line 160)
- **User counts or distributions** — edit `seedUsers` function
- **Assignment/attempt volumes** — edit `seedAssignments` / `seedAttempts` functions
- **PRNG seed** — change `const SEED = 42` to get different (but still deterministic) data
- **Name/note/activity pools** — edit the `FIRST_NAMES`, `LAST_NAMES`, `THERAPIST_NOTES`, `ACTIVITIES` constants

## Dependencies

Requires `MONGO_URI` in `.env` (loaded via dotenv at top of file).
