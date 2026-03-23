# Seed Redesign — Unified Seed Script

**Date:** 2026-03-23
**Status:** Approved

## Overview

Replace the fragmented seed scripts with a single unified `seed-all` script that seeds the entire database: programs, modules, questions, score bands, users (admins, therapists, patients), assignments, and attempts. All randomised decisions use a seeded PRNG for reproducibility.

## Goals

- Rich, varied test data across all models
- Dynamic dates relative to seed time so data always looks fresh
- Deterministic via seeded PRNG (same seed = same database state)
- Single command: `npm run seed-all`
- All test users share password `12345678` with auto-verified emails

## Script Structure

**File:** `src/seeds/seedAll.ts`
**Command:** `npm run seed-all`

Execution order:

1. Connect to MongoDB
2. Drop all collections (clean slate)
3. Seed programs, modules, questions, score bands (existing content inlined)
4. Seed users (admins, therapists, patients)
5. Seed assignments
6. Seed attempts (linked to assignments where applicable)
7. Log summary table
8. Disconnect

### Cleanup

Remove old seed files and npm scripts:

- `src/seeds/questionnaires.ts`
- `src/seeds/phq9.ts`
- `src/seeds/otherPrograms.ts`
- `src/seeds/diary.ts`
- `src/seeds/drop.ts`
- `src/seeds/user.ts`
- npm scripts: `seed`, `refresh`, `seed-others`, `diary`, `drop`

## Programs & Modules (explicit inventory)

All existing seed content is inlined into the unified script.

| Program | Module | Type | Access | Questions | Score Bands |
|---------|--------|------|--------|-----------|-------------|
| Depression | PHQ-9 | questionnaire | assigned | 9 | 5 |
| Depression | GAD-7 | questionnaire | assigned | 7 | 4 |
| Depression | PSS-10 | questionnaire | open | 10 | 3 |
| Depression | AUDIT-C | questionnaire | assigned | 3 | 4 |
| Depression | ISI | questionnaire | assigned | 7 | 4 |
| Depression | Activity Diary | activity_diary | assigned | 0 | 0 |
| Resilience & Coping | Resilience Snapshot (6-item) | questionnaire | assigned | 6 | 3 |
| Resilience & Coping | Values Clarification | exercise | assigned | 0 | 0 |
| Sleep Health | Sleep Hygiene Basics | psychoeducation | open | 0 | 0 |

**Totals:** 3 programs, 9 modules, 42 questions, 23 score bands.

Each module preserves its existing `imageUrl` (placeholder.co) and `disclaimer` text where present.

**Model fix required:** The Question model (`questionModel.ts`) constrains `choices.score` to `max: 3`, but existing seed data for PSS-10, AUDIT-C, ISI, and Resilience Snapshot uses scores up to 4. Update the constraint to `max: 4` as part of this work.

## PRNG & Reproducibility

- Inline mulberry32 PRNG — no external dependency
- Fixed seed constant (`const SEED = 42`)
- All random decisions flow through this PRNG
- Dates computed as deterministic offsets from `new Date()` at seed time

## Users (90 total)

### Admins (5)

| Field | Value |
|-------|-------|
| Email | `admin1@test.com` – `admin5@test.com` |
| Username | `admin1` – `admin5` |
| Name | From realistic name pool |
| Roles | `['admin']` |
| isVerified | `true` |
| Password | `12345678` (bcrypt, salt 10) |

### Therapists (25)

| Field | Value |
|-------|-------|
| Email | `therapist1@test.com` – `therapist25@test.com` |
| Username | `therapist1` – `therapist25` |
| Name | From name pool |
| Roles | `['therapist']` |
| isVerified | `true` |
| isVerifiedTherapist | ~18 true, ~7 false |
| Password | `12345678` |

**Patient distribution (bell curve):**

- ~3 therapists: 0 patients (newly joined, these should have `isVerifiedTherapist: false`)
- ~10 therapists: 1–2 patients
- ~8 therapists: 3–4 patients
- ~4 therapists: 5–8 patients

Remaining unverified therapists (~4) may have patients — representing therapists whose credentialing is still pending but have already been assigned patients.

### Patients (60)

| Field | Value |
|-------|-------|
| Email | `patient1@test.com` – `patient60@test.com` |
| Username | `patient1` – `patient60` |
| Name | From name pool |
| Roles | `['patient']` |
| isVerified | `true` |
| Password | `12345678` |
| Therapist | 55 assigned (per bell curve), 5 unassigned |
| lastLogin | Varied — some recent, some weeks ago, some never beyond creation |

**Bidirectional therapist-patient linking:** For each patient-therapist link, set `patient.therapist = therapistId` AND push the patient's `_id` into `therapist.patients[]`. Both sides must stay in sync.

**Password hashing:** Hash `12345678` with bcrypt (salt 10) once, reuse the same hash string for all 90 users to avoid slow per-user hashing.

## Assignments (~150–180 total)

Only for patients with a therapist (55 patients).

### Distribution per patient

- ~12 patients: 1 assignment
- ~35 patients: 2–4 assignments
- ~8 patients: 5+ assignments (active patients)

### Status mix

| Status | Proportion |
|--------|-----------|
| assigned (not started) | ~25% |
| in_progress | ~15% |
| completed | ~45% |
| cancelled | ~15% |

### Other fields

- **dueAt:** ~60% have a due date (mix of past/overdue, upcoming, future 1–2 weeks). ~40% have none.
- **recurrence:** ~15% have recurrence (mostly `weekly` for questionnaires)
- **notes:** ~40% have therapist instructions from a realistic pool
- **module weighting:** ~60% questionnaires, rest split across exercise, psychoeducation, activity diary
- **program:** derived from `module.program` (required field on assignment)
- **moduleType:** copied from `module.type` (required field on assignment)
- **recurrence shape:** `{ freq: 'weekly' | 'monthly', interval: 1 }` — keep interval at 1 for simplicity

### Consistency with attempts

- `completed` assignments have a matching submitted attempt; `latestAttempt` set to the attempt's `_id`
- `in_progress` assignments have a matching started attempt; `latestAttempt` set to the attempt's `_id`
- `assigned` and `cancelled` assignments have no linked attempt (`latestAttempt` unset)

## Attempts (~180–220 total)

### Sources

- **Assignment-linked:** every `completed` or `in_progress` assignment generates a corresponding attempt
- **Self-started:** patients independently start `open` modules (PSS-10, Sleep Hygiene). ~30–40 additional attempts, including from unassigned patients.

### Status mix

| Status | Proportion |
|--------|-----------|
| submitted | ~55% |
| started (in progress) | ~20% |
| abandoned | ~25% |

### By module type

**All attempts:**
- `program` derived from `module.program`
- `moduleType` copied from `module.type`
- `contentVersion` = 1

**Questionnaire attempts:**
- `answers` populated per question count. For each answer: randomly select a choice, then set `chosenScore` (the choice's score), `chosenIndex` (its index in the choices array), and `chosenText` (the choice's text)
- `totalScore` = sum of chosen scores
- `scoreBandLabel` resolved from seeded score bands based on total score
- `moduleSnapshot` = frozen copy of module + questions
- `weekStart` = Monday 00:00 London time (converted to UTC) of the week containing `startedAt`, matching the existing Luxon-based calculation

**Activity diary attempts:**
- 3–10 `diaryEntries` per attempt
- Each entry: `at` (timestamp within slot range), `label` (time slot label), `activity` (from pool: "Walking", "Reading", "Cooking", "Work meeting", "Exercise", "Journaling", "Socialising", "Watching TV", "Shopping", "Meditation"), `mood` (0–100), `achievement` (0–10), `closeness` (0–10), `enjoyment` (0–10)
- Entries spread across time slots (`SLOT_START_HOUR` / `SLOT_END_HOUR` / `SLOT_STEP_HOURS`)

**Exercise & psychoeducation attempts:**
- Minimal data — status and timestamps only

### Timing (relative to seed date)

- Submitted attempts spread across last 60 days, clustered toward recent (more in last 2 weeks)
- Started/abandoned attempts skew recent (last 7–14 days)
- `startedAt` always before `completedAt`
- `durationSecs`: questionnaires 3–20 min, diary 5–30 min, exercises 2–15 min
- `lastInteractionAt`: matches `completedAt` for submitted, few minutes after `startedAt` for abandoned
- `iteration`: incremented per user per module (2nd attempt = 2, etc.)

### Denormalization

- `therapist` field on attempt matches patient's assigned therapist

## Output

Script logs on completion:
- Count of each entity by type (users by role, assignments by status, attempts by status)
- Example credentials for quick access (e.g. `patient1@test.com / 12345678`)

## Data Volume Summary

| Entity | Count |
|--------|-------|
| Programs | 3 |
| Modules | 9 |
| Questions | 42 |
| Score Bands | 23 |
| Admins | 5 |
| Therapists | 25 |
| Patients | 60 |
| Assignments | 150–180 |
| Attempts | 180–220 |
