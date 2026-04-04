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
├── controllers/     # Route handlers (auth, user, module, program, attempts, assignments)
├── middleware/       # Auth (JWT), role authorization
├── models/          # Mongoose schemas (User, Program, Module, Question, ModuleAttempt, ModuleAssignment, ScoreBand)
├── routes/          # Express routers
├── seeds/           # Data seeding scripts
├── shared-types/    # Published npm package (@milobedini/shared-types)
├── utils/           # Error handling, JWT, roles, attempt/diary/access helpers
├── mailtrap/        # Email client + templates
└── index.ts         # Express app setup, middleware stack, route mounting
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

## Commands

- `npm run dev` — start dev server (nodemon + ts-node)
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run compiled output
- `npm run seed` — seed questionnaires
- `npm run seed-others` — seed programs
- `npm run refresh` — drop + reseed PHQ-9
- `npm run diary` — seed activity diary data
- `npm run drop` — clear all collections
- `npm run publish` — publish shared-types to npm

## Database Access

Query MongoDB Atlas directly via `mongosh` using the `MONGO_URI` from `.env`:

```bash
mongosh "$(grep MONGO_URI .env | cut -d= -f2-)"
```

**Collection names** (note: these differ from model names):
- `users-data` (not `users`) — User documents
- `moduleAssignments` — Assignment documents
- `moduleAttempts` — Attempt documents
- `modules`, `programs`, `questions`, `scoreBands` — reference data

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
```

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
5. Seed script for initial data
6. Update shared-types and `npm run publish`
