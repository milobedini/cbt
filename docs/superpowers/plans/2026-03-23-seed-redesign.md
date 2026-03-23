# Seed Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragmented seed scripts with a single `npm run seed-all` command that populates the entire database with programs, modules, questions, score bands, 90 users, ~170 assignments, and ~200 attempts using a seeded PRNG for reproducibility.

**Architecture:** Single file `src/seeds/seedAll.ts` with sequential phases: drop DB, seed content (programs/modules/questions/bands), seed users, seed assignments, seed attempts. A mulberry32 PRNG provides deterministic randomness. All dates are relative offsets from seed time. The script inlines all existing seed data (no imports from old seed files).

**Tech Stack:** TypeScript, Mongoose 8, bcryptjs, luxon (for weekStart calculation)

**Spec:** `docs/superpowers/specs/2026-03-23-seed-redesign-design.md`

---

### Task 1: Fix Question model score constraint

The Question model caps `choices.score` at `max: 3`, but PSS-10, AUDIT-C, ISI, and Resilience Snapshot use scores up to 4.

**Files:**
- Modify: `src/models/questionModel.ts:23`

- [ ] **Step 1: Update the score constraint**

In `src/models/questionModel.ts`, change line 23:

```typescript
// Before:
score: { type: Number, required: true, min: 0, max: 3 },

// After:
score: { type: Number, required: true, min: 0, max: 4 },
```

- [ ] **Step 2: Verify the change compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/models/questionModel.ts
git commit -m "fix: update Question score max from 3 to 4 to match existing data"
```

---

### Task 2: Create seedAll.ts — PRNG, constants, and data definitions

Create the unified seed file with the PRNG utility, name pools, therapist note pools, activity pools, and all program/module/question/band data inlined.

**Files:**
- Create: `src/seeds/seedAll.ts`

- [ ] **Step 1: Create the file with PRNG and data constants**

Create `src/seeds/seedAll.ts` with the following content:

```typescript
import mongoose, { Types } from 'mongoose'
import bcrypt from 'bcryptjs'
import { DateTime } from 'luxon'
import User, { UserRole } from '../models/userModel'
import Program, { IProgram } from '../models/programModel'
import Module, { IModule } from '../models/moduleModel'
import Question, { IQuestion } from '../models/questionModel'
import ScoreBand, { IScoreBand } from '../models/scoreBandModel'
import ModuleAttempt from '../models/moduleAttemptModel'
import ModuleAssignment from '../models/moduleAssignmentModel'

// ─── PRNG (mulberry32) ────────────────────────────────────────────
const SEED = 42

const createPrng = (seed: number) => {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = createPrng(SEED)

/** Random int in [min, max] inclusive */
const randInt = (min: number, max: number): number =>
  Math.floor(rand() * (max - min + 1)) + min

/** Pick a random element from an array */
const pick = <T>(arr: readonly T[]): T => arr[randInt(0, arr.length - 1)]

/** Shuffle array in place (Fisher-Yates) */
const shuffle = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** Random float in [min, max) */
const randFloat = (min: number, max: number): number =>
  rand() * (max - min) + min

// ─── CONSTANTS ────────────────────────────────────────────────────
const PASSWORD = '12345678'
const NOW = new Date()
const SLOT_START_HOUR = 6
const SLOT_END_HOUR = 24
const SLOT_STEP_HOURS = 2
const LONDON_TZ = 'Europe/London'

const FIRST_NAMES = [
  'Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'James', 'Sophia', 'Oliver',
  'Isabella', 'William', 'Mia', 'Benjamin', 'Charlotte', 'Lucas', 'Amelia',
  'Henry', 'Harper', 'Alexander', 'Evelyn', 'Daniel', 'Abigail', 'Matthew',
  'Ella', 'Joseph', 'Scarlett', 'David', 'Grace', 'Samuel', 'Lily', 'John',
  'Chloe', 'Sebastian', 'Aria', 'Jack', 'Zoe', 'Owen', 'Nora', 'Leo',
  'Riley', 'Adam', 'Hannah', 'Ryan', 'Stella', 'Nathan', 'Bella', 'Caleb',
  'Lucy', 'Ethan', 'Maya', 'Thomas', 'Layla', 'Isaac', 'Alice', 'Joshua',
  'Ellie', 'Andrew', 'Violet', 'Dylan', 'Aurora', 'Gabriel', 'Hazel',
  'Anthony', 'Ivy', 'Lincoln', 'Ruby', 'Max', 'Willow', 'Theo', 'Sadie',
  'Finn', 'Clara', 'Miles', 'Piper', 'Cole', 'Quinn', 'Kai', 'Julia',
  'Jake', 'Madeline', 'Eli', 'Sophie', 'Jonah', 'Iris', 'George', 'Naomi',
  'Marcus', 'Eva', 'Hugo', 'Rose', 'Felix', 'Freya',
] as const

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
  'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
  'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark',
  'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
  'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green',
  'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts', 'Patel', 'Khan', 'Singh', 'Murphy', 'O\'Brien',
  'Kelly', 'Sullivan', 'Bennett', 'Cooper', 'Reed', 'Bailey', 'Bell',
  'Murray', 'Stewart', 'Morris', 'Rogers', 'Cook', 'Morgan', 'Price',
  'Palmer', 'Ross', 'Wood', 'Barnes', 'Henderson', 'Coleman', 'Jenkins',
  'Perry', 'Powell', 'Long', 'Patterson', 'Hughes', 'Foster', 'Sanders',
  'Bryant', 'Alexander', 'Russell', 'Griffin', 'Hayes', 'Webb', 'Fox',
] as const

const THERAPIST_NOTES = [
  'Please complete before our next session',
  'Try to do this first thing in the morning',
  'Take your time with this one — no rush',
  'Complete this daily for the next week',
  'We discussed this in session — give it a go',
  'Fill this in before Thursday if you can',
  'This will help us track your progress',
  'Try to be as honest as possible',
  'Do this when you have a quiet moment',
  'Let me know if any questions come up',
  'We\'ll review your responses together next week',
  'This is a follow-up from our last conversation',
] as const

const ACTIVITIES = [
  'Walking', 'Reading', 'Cooking dinner', 'Work meeting', 'Exercise',
  'Journaling', 'Socialising', 'Watching TV', 'Shopping', 'Meditation',
  'Housework', 'Gardening', 'Phone call with friend', 'Lunch break',
  'Commuting', 'Studying', 'Playing with kids', 'Yoga', 'Gaming',
  'Listening to music',
] as const

/** Generate a name from the pool using PRNG */
const generateName = (): string => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`

/** Days ago from NOW */
const daysAgo = (days: number): Date =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

/** Hours ago from a given date */
const hoursAfter = (date: Date, hours: number): Date =>
  new Date(date.getTime() + hours * 60 * 60 * 1000)

/** Minutes after a given date */
const minsAfter = (date: Date, mins: number): Date =>
  new Date(date.getTime() + mins * 60 * 1000)

/** Get Monday 00:00 London time for a given date, returned as UTC */
const getWeekStart = (date: Date): Date => {
  const dt = DateTime.fromJSDate(date, { zone: LONDON_TZ })
  const monday = dt.startOf('week') // Luxon weeks start on Monday
  return monday.toUTC().toJSDate()
}
```

This is the first portion of the file. The rest will be added in subsequent tasks.

- [ ] **Step 2: Verify it compiles so far**

Run: `npx tsc --noEmit`
Expected: No errors (the file has no entry point yet, just definitions)

- [ ] **Step 3: Commit**

```bash
git add src/seeds/seedAll.ts
git commit -m "feat(seeds): add seedAll skeleton with PRNG, constants, and data pools"
```

---

### Task 3: Clean up old seed files and npm scripts

Remove all old seed files and their npm scripts. Done after `seedAll.ts` exists to avoid a state with no seed scripts.

**Files:**
- Delete: `src/seeds/questionnaires.ts`
- Delete: `src/seeds/phq9.ts`
- Delete: `src/seeds/otherPrograms.ts`
- Delete: `src/seeds/diary.ts`
- Delete: `src/seeds/drop.ts`
- Delete: `src/seeds/user.ts`
- Modify: `package.json` (remove old scripts, add new one)

- [ ] **Step 1: Delete old seed files**

```bash
rm src/seeds/questionnaires.ts src/seeds/phq9.ts src/seeds/otherPrograms.ts src/seeds/diary.ts src/seeds/drop.ts src/seeds/user.ts
```

- [ ] **Step 2: Update package.json scripts**

Remove these scripts: `seed`, `refresh`, `seed-others`, `diary`, `drop`

Add: `"seed-all": "ts-node ./src/seeds/seedAll.ts"`

The scripts section should look like:
```json
{
  "start": "node dist/index.js",
  "dev": "nodemon",
  "build": "tsc",
  "publish": "npm --prefix src/shared-types run publish:pkg",
  "seed-all": "ts-node ./src/seeds/seedAll.ts"
}
```

- [ ] **Step 3: Commit**

```bash
git add -A src/seeds/ package.json
git commit -m "chore: remove old seed files and scripts"
```

---

### Task 4: Add program/module/question/band data and seed function

Add all the inline program, module, question, and score band data to `seedAll.ts`, plus the function that seeds them.

**Files:**
- Modify: `src/seeds/seedAll.ts`

- [ ] **Step 1: Add the seedContent function**

Append to `src/seeds/seedAll.ts` (after the constants/helpers section):

```typescript
// ─── CONTENT DATA ─────────────────────────────────────────────────

interface QuestionData {
  text: string
  choices: { text: string; score: number }[]
}

interface BandData {
  min: number
  max: number
  label: string
  interpretation: string
}

interface ModuleData {
  title: string
  description: string
  type: 'questionnaire' | 'psychoeducation' | 'exercise' | 'activity_diary'
  accessPolicy: 'open' | 'assigned'
  disclaimer?: string
  imageUrl?: string
  questions?: QuestionData[]
  bands?: BandData[]
}

interface ProgramData {
  title: string
  description: string
  modules: ModuleData[]
}

const PROGRAMS: ProgramData[] = [
  {
    title: 'Depression',
    description: 'Step-by-step CBT programme for low mood.',
    modules: [
      {
        title: 'PHQ-9',
        description: 'Patient Health Questionnaire-9 (depression severity)',
        type: 'questionnaire',
        accessPolicy: 'assigned',
        disclaimer:
          'The PHQ-9 is a screening tool and does **not** replace professional diagnosis. If you have thoughts of self-harm, seek help immediately.',
        questions: [
          'Little interest or pleasure in doing things',
          'Feeling down, depressed, or hopeless',
          'Trouble falling or staying asleep, or sleeping too much',
          'Feeling tired or having little energy',
          'Poor appetite or overeating',
          'Feeling bad about yourself — or that you are a failure or have let yourself or your family down',
          'Trouble concentrating on things, such as reading the newspaper or watching television',
          'Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual',
          'Thoughts that you would be better off dead, or of hurting yourself in some way',
        ].map((text) => ({
          text,
          choices: [
            { text: 'Not at all', score: 0 },
            { text: 'Several days', score: 1 },
            { text: 'More than half the days', score: 2 },
            { text: 'Nearly every day', score: 3 },
          ],
        })),
        bands: [
          { min: 0, max: 4, label: 'Minimal', interpretation: 'No or minimal depression' },
          { min: 5, max: 9, label: 'Mild', interpretation: 'Watchful waiting; repeat soon' },
          { min: 10, max: 14, label: 'Moderate', interpretation: 'Consider counselling or CBT' },
          { min: 15, max: 19, label: 'Moderately severe', interpretation: 'Active treatment recommended' },
          { min: 20, max: 27, label: 'Severe', interpretation: 'Immediate intensive treatment' },
        ],
      },
      {
        title: 'GAD-7',
        description: 'Generalized Anxiety Disorder 7-item (anxiety severity)',
        type: 'questionnaire',
        accessPolicy: 'assigned',
        disclaimer:
          'This screener helps monitor anxiety but does not provide a diagnosis. If you are in crisis or feel unsafe, seek immediate support.',
        imageUrl: 'https://placehold.co/600x400?text=GAD-7',
        questions: [
          'Feeling nervous, anxious, or on edge',
          'Not being able to stop or control worrying',
          'Worrying too much about different things',
          'Trouble relaxing',
          'Being so restless that it is hard to sit still',
          'Becoming easily annoyed or irritable',
          'Feeling afraid as if something awful might happen',
        ].map((text) => ({
          text,
          choices: [
            { text: 'Not at all', score: 0 },
            { text: 'Several days', score: 1 },
            { text: 'More than half the days', score: 2 },
            { text: 'Nearly every day', score: 3 },
          ],
        })),
        bands: [
          { min: 0, max: 4, label: 'Minimal', interpretation: 'No or minimal anxiety' },
          { min: 5, max: 9, label: 'Mild', interpretation: 'Mild symptoms; monitor and consider self-help' },
          { min: 10, max: 14, label: 'Moderate', interpretation: 'Consider structured support (e.g., CBT)' },
          { min: 15, max: 21, label: 'Severe', interpretation: 'Active treatment recommended' },
        ],
      },
      {
        title: 'PSS-10',
        description: 'Perceived Stress Scale (10-item)',
        type: 'questionnaire',
        accessPolicy: 'open',
        disclaimer:
          'This scale measures how stressful you find your life. It is a self-report measure, not a diagnosis.',
        imageUrl: 'https://placehold.co/600x400?text=PSS-10',
        questions: [
          'In the last month, how often have you felt that you were unable to control the important things in your life?',
          'In the last month, how often have you felt confident about your ability to handle personal problems?',
          'In the last month, how often have you felt that things were going your way?',
          'In the last month, how often have you felt difficulties were piling up so high that you could not overcome them?',
          'In the last month, how often have you felt stressed by unexpected events?',
          'In the last month, how often have you found that you could not cope with all the things you had to do?',
          'In the last month, how often have you been upset because of something that happened unexpectedly?',
          'In the last month, how often have you felt that you were on top of things?',
          'In the last month, how often have you felt anger, tension, or irritability?',
          'In the last month, how often have you felt you had little control over important outcomes?',
        ].map((text) => ({
          text,
          choices: [
            { text: 'Never', score: 0 },
            { text: 'Almost never', score: 1 },
            { text: 'Sometimes', score: 2 },
            { text: 'Fairly often', score: 3 },
            { text: 'Very often', score: 4 },
          ],
        })),
        bands: [
          { min: 0, max: 13, label: 'Low', interpretation: 'Low perceived stress' },
          { min: 14, max: 26, label: 'Moderate', interpretation: 'Moderate stress; consider coping skills' },
          { min: 27, max: 40, label: 'High', interpretation: 'High stress; consider structured support' },
        ],
      },
      {
        title: 'AUDIT-C',
        description: 'Alcohol Use Disorders Identification Test (Consumption)',
        type: 'questionnaire',
        accessPolicy: 'assigned',
        disclaimer:
          'This screening tool provides an indicator of alcohol use risk. For medical advice, consult a clinician.',
        imageUrl: 'https://placehold.co/600x400?text=AUDIT-C',
        questions: [
          {
            text: 'How often do you have a drink containing alcohol?',
            choices: [
              { text: 'Never', score: 0 },
              { text: 'Monthly or less', score: 1 },
              { text: '2\u20134 times a month', score: 2 },
              { text: '2\u20133 times a week', score: 3 },
              { text: '4+ times a week', score: 4 },
            ],
          },
          {
            text: 'How many standard drinks do you have on a typical day when drinking?',
            choices: [
              { text: '1\u20132', score: 0 },
              { text: '3\u20134', score: 1 },
              { text: '5\u20136', score: 2 },
              { text: '7\u20139', score: 3 },
              { text: '10 or more', score: 4 },
            ],
          },
          {
            text: 'How often do you have six or more drinks on one occasion?',
            choices: [
              { text: 'Never', score: 0 },
              { text: 'Less than monthly', score: 1 },
              { text: 'Monthly', score: 2 },
              { text: 'Weekly', score: 3 },
              { text: 'Daily or almost daily', score: 4 },
            ],
          },
        ],
        bands: [
          { min: 0, max: 3, label: 'Low risk', interpretation: 'Alcohol use within lower-risk range' },
          { min: 4, max: 5, label: 'Medium risk', interpretation: 'Consider reducing intake' },
          { min: 6, max: 7, label: 'High risk', interpretation: 'Risky use; consider brief intervention' },
          { min: 8, max: 12, label: 'Very high risk', interpretation: 'Strongly consider clinical support' },
        ],
      },
      {
        title: 'ISI',
        description: 'Insomnia Severity Index',
        type: 'questionnaire',
        accessPolicy: 'assigned',
        disclaimer:
          'This tool estimates insomnia severity. It does not replace clinical evaluation. Seek help if symptoms persist.',
        imageUrl: 'https://placehold.co/600x400?text=ISI',
        questions: [
          'Difficulty falling asleep (initial insomnia)',
          'Difficulty staying asleep (middle insomnia)',
          'Problems waking too early (terminal insomnia)',
          'How satisfied/dissatisfied are you with your current sleep pattern?',
          'How noticeable to others do you think your sleep problem is?',
          'How worried/distressed are you about your current sleep problem?',
          'To what extent do sleep difficulties interfere with your daily functioning?',
        ].map((text) => ({
          text,
          choices: [
            { text: 'None', score: 0 },
            { text: 'Mild', score: 1 },
            { text: 'Moderate', score: 2 },
            { text: 'Severe', score: 3 },
            { text: 'Very severe', score: 4 },
          ],
        })),
        bands: [
          { min: 0, max: 7, label: 'No clinically significant insomnia', interpretation: 'Maintain sleep hygiene' },
          { min: 8, max: 14, label: 'Subthreshold insomnia', interpretation: 'Consider behavioral sleep strategies' },
          { min: 15, max: 21, label: 'Moderate insomnia', interpretation: 'Structured intervention recommended' },
          { min: 22, max: 28, label: 'Severe insomnia', interpretation: 'Active treatment recommended' },
        ],
      },
      {
        title: 'Activity Diary',
        description:
          'Track your activities through the day alongside mood, achievement, closeness and enjoyment.',
        type: 'activity_diary',
        accessPolicy: 'assigned',
        disclaimer:
          'This diary is for self-monitoring and does not replace professional care. If you feel unsafe, seek immediate help.',
        imageUrl: 'https://placehold.co/600x400?text=Activity+Diary',
      },
    ],
  },
  {
    title: 'Resilience & Coping',
    description: 'Build psychological flexibility and values-aligned action.',
    modules: [
      {
        title: 'Resilience Snapshot (6-item)',
        description: 'A brief self-check on resilience and bounce-back capacity.',
        type: 'questionnaire',
        accessPolicy: 'assigned',
        disclaimer:
          'This brief self-check is for self-reflection and is not a diagnosis. If you are in crisis or feel unsafe, seek immediate support.',
        imageUrl: 'https://placehold.co/600x400?text=Resilience+Snapshot',
        questions: [
          'I tend to bounce back quickly after hard times.',
          'I stay focused on what I can control.',
          'I can find a way forward even when I feel stuck.',
          'When I fail, I can learn and try again.',
          'I can act in line with my values despite difficult feelings.',
          'I maintain perspective in stressful situations.',
        ].map((text) => ({
          text,
          choices: [
            { text: 'Strongly disagree', score: 0 },
            { text: 'Disagree', score: 1 },
            { text: 'Neutral', score: 2 },
            { text: 'Agree', score: 3 },
            { text: 'Strongly agree', score: 4 },
          ],
        })),
        bands: [
          { min: 0, max: 8, label: 'Low', interpretation: 'Consider structured coping support.' },
          { min: 9, max: 16, label: 'Moderate', interpretation: 'Keep practicing skills; consider coaching.' },
          { min: 17, max: 24, label: 'High', interpretation: 'Strong resilience; maintain helpful routines.' },
        ],
      },
      {
        title: 'Values Clarification',
        description:
          'Identify your core values across life domains and define small next actions.',
        type: 'exercise',
        accessPolicy: 'assigned',
        disclaimer:
          'Coaching-style exercise. Not a substitute for therapy or crisis care.',
        imageUrl: 'https://placehold.co/600x400?text=Values+Clarification',
      },
    ],
  },
  {
    title: 'Sleep Health',
    description: 'Knowledge and routines for better sleep quality.',
    modules: [
      {
        title: 'Sleep Hygiene Basics',
        description:
          'Learn practical sleep hygiene tips and when to seek further support.',
        type: 'psychoeducation',
        accessPolicy: 'open',
        imageUrl: 'https://placehold.co/600x400?text=Sleep+Hygiene+Basics',
      },
    ],
  },
]

// ─── SEED CONTENT ─────────────────────────────────────────────────

interface SeededModule {
  doc: IModule
  data: ModuleData
  questions: IQuestion[]
  bands: IScoreBand[]
  program: IProgram
}

const seedContent = async (): Promise<SeededModule[]> => {
  const seededModules: SeededModule[] = []

  for (const programData of PROGRAMS) {
    const program = (await Program.findOneAndUpdate(
      { title: programData.title },
      { title: programData.title, description: programData.description },
      { upsert: true, new: true }
    )) as IProgram
    console.log(`  Program: ${programData.title}`)

    for (const modData of programData.modules) {
      const moduleDoc = (await Module.findOneAndUpdate(
        { title: modData.title, program: program._id },
        {
          title: modData.title,
          description: modData.description,
          program: program._id,
          type: modData.type,
          accessPolicy: modData.accessPolicy,
          ...(modData.disclaimer ? { disclaimer: modData.disclaimer } : {}),
          ...(modData.imageUrl ? { imageUrl: modData.imageUrl } : {}),
        },
        { upsert: true, new: true }
      )) as IModule

      await Program.findByIdAndUpdate(program._id, {
        $addToSet: { modules: moduleDoc._id },
      })

      let questions: IQuestion[] = []
      let bands: IScoreBand[] = []

      if (modData.questions?.length) {
        await Promise.all(
          modData.questions.map((q, i) =>
            Question.findOneAndUpdate(
              { module: moduleDoc._id, order: i + 1 },
              { module: moduleDoc._id, order: i + 1, text: q.text, choices: q.choices },
              { upsert: true, new: true }
            )
          )
        )
        questions = (await Question.find({ module: moduleDoc._id }).sort({ order: 1 })) as IQuestion[]
      }

      if (modData.bands?.length) {
        await Promise.all(
          modData.bands.map((b) =>
            ScoreBand.findOneAndUpdate(
              { module: moduleDoc._id, min: b.min },
              { module: moduleDoc._id, ...b },
              { upsert: true, new: true }
            )
          )
        )
        bands = (await ScoreBand.find({ module: moduleDoc._id }).sort({ min: 1 })) as IScoreBand[]
      }

      seededModules.push({ doc: moduleDoc, data: modData, questions, bands, program })
      console.log(`    Module: ${modData.title} (${modData.type}, ${modData.accessPolicy}) — ${questions.length}q, ${bands.length}b`)
    }
  }

  return seededModules
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/seeds/seedAll.ts
git commit -m "feat(seeds): add content data and seedContent function"
```

---

### Task 5: Add user seeding function

Add the function that creates admins, therapists, and patients with bell-curve distribution and bidirectional therapist-patient linking.

**Files:**
- Modify: `src/seeds/seedAll.ts`

- [ ] **Step 1: Add the seedUsers function**

Append to `src/seeds/seedAll.ts`:

```typescript
// ─── SEED USERS ───────────────────────────────────────────────────

interface SeededUsers {
  admins: Types.ObjectId[]
  therapists: Types.ObjectId[]
  patients: Types.ObjectId[]
  /** Map from patient ID string to therapist ID (for the 55 assigned patients) */
  patientTherapistMap: Map<string, Types.ObjectId>
}

const seedUsers = async (): Promise<SeededUsers> => {
  const hashedPassword = await bcrypt.hash(PASSWORD, 10)

  const admins: Types.ObjectId[] = []
  const therapists: Types.ObjectId[] = []
  const patients: Types.ObjectId[] = []
  const patientTherapistMap = new Map<string, Types.ObjectId>()

  // --- Admins (5) ---
  for (let i = 1; i <= 5; i++) {
    const user = await User.create({
      username: `admin${i}`,
      email: `admin${i}@test.com`,
      password: hashedPassword,
      name: generateName(),
      roles: [UserRole.ADMIN],
      isVerified: true,
      lastLogin: daysAgo(randInt(0, 30)),
    })
    admins.push(user._id as Types.ObjectId)
  }
  console.log(`  Admins: ${admins.length}`)

  // --- Therapists (25) ---
  // Bell-curve patient counts: 3 with 0, 10 with 1-2, 8 with 3-4, 4 with 5-8
  const patientCounts = shuffle([
    ...Array(3).fill(0),
    ...Array(10).fill(null).map(() => randInt(1, 2)),
    ...Array(8).fill(null).map(() => randInt(3, 4)),
    ...Array(4).fill(null).map(() => randInt(5, 8)),
  ])

  // Unverified therapists: the 3 with 0 patients + 4 random others
  const unverifiedIndices = new Set<number>()
  patientCounts.forEach((count, i) => {
    if (count === 0) unverifiedIndices.add(i)
  })
  // Add 4 more random unverified therapists (with patients)
  const verifiedCandidates = Array.from({ length: 25 }, (_, i) => i).filter(
    (i) => !unverifiedIndices.has(i)
  )
  shuffle(verifiedCandidates)
  verifiedCandidates.slice(0, 4).forEach((i) => unverifiedIndices.add(i))

  for (let i = 0; i < 25; i++) {
    const user = await User.create({
      username: `therapist${i + 1}`,
      email: `therapist${i + 1}@test.com`,
      password: hashedPassword,
      name: generateName(),
      roles: [UserRole.THERAPIST],
      isVerified: true,
      isVerifiedTherapist: !unverifiedIndices.has(i),
      lastLogin: daysAgo(randInt(0, 14)),
    })
    therapists.push(user._id as Types.ObjectId)
  }
  console.log(`  Therapists: ${therapists.length} (${25 - unverifiedIndices.size} verified)`)

  // --- Patients (60) ---
  // Build assignment list: which therapist gets how many patients
  // Then cap at exactly 55 so we get 55 assigned + 5 unassigned = 60
  const allSlots: { therapistIdx: number }[] = []
  patientCounts.forEach((count, therapistIdx) => {
    for (let j = 0; j < count; j++) {
      allSlots.push({ therapistIdx })
    }
  })
  shuffle(allSlots)
  const assignments = allSlots.slice(0, 55)

  for (let i = 1; i <= 60; i++) {
    const loginVariant = rand()
    let lastLogin: Date
    if (loginVariant < 0.3) lastLogin = daysAgo(randInt(0, 3)) // recent
    else if (loginVariant < 0.7) lastLogin = daysAgo(randInt(4, 21)) // moderate
    else lastLogin = daysAgo(randInt(22, 60)) // old

    const user = await User.create({
      username: `patient${i}`,
      email: `patient${i}@test.com`,
      password: hashedPassword,
      name: generateName(),
      roles: [UserRole.PATIENT],
      isVerified: true,
      lastLogin,
    })
    patients.push(user._id as Types.ObjectId)

    // Assign therapist if within the assigned range
    const assignment = assignments[i - 1] // first 55 get assignments (if assignments has enough)
    if (assignment && i <= assignments.length) {
      const therapistId = therapists[assignment.therapistIdx]
      await User.findByIdAndUpdate(user._id, { therapist: therapistId })
      await User.findByIdAndUpdate(therapistId, {
        $addToSet: { patients: user._id },
      })
      patientTherapistMap.set(String(user._id), therapistId)
    }
  }

  const assignedCount = patientTherapistMap.size
  console.log(`  Patients: ${patients.length} (${assignedCount} assigned, ${patients.length - assignedCount} unassigned)`)

  return { admins, therapists, patients, patientTherapistMap }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/seeds/seedAll.ts
git commit -m "feat(seeds): add user seeding with bell-curve distribution"
```

---

### Task 6: Add assignment seeding function

Add the function that creates ~150-180 module assignments for assigned patients, with varied statuses, due dates, notes, and recurrence.

**Files:**
- Modify: `src/seeds/seedAll.ts`

- [ ] **Step 1: Add the seedAssignments function**

Append to `src/seeds/seedAll.ts`:

```typescript
// ─── SEED ASSIGNMENTS ─────────────────────────────────────────────

interface SeededAssignment {
  _id: Types.ObjectId
  userId: Types.ObjectId
  therapistId: Types.ObjectId
  moduleDoc: IModule
  moduleData: ModuleData
  programId: Types.ObjectId
  status: string
  questions: IQuestion[]
  bands: IScoreBand[]
}

const seedAssignments = async (
  users: SeededUsers,
  modules: SeededModule[]
): Promise<SeededAssignment[]> => {
  const seededAssignments: SeededAssignment[] = []
  const assignedPatients = users.patients.filter((p) =>
    users.patientTherapistMap.has(String(p))
  )

  // Determine assignment count per patient: ~12 get 1, ~35 get 2-4, ~8 get 5+
  const patientAssignmentCounts = shuffle(assignedPatients.map((_, i) => {
    if (i < 12) return 1
    if (i < 47) return randInt(2, 4)
    return randInt(5, 7)
  }))

  // Filter to assignable modules (questionnaires weighted 60%, rest 40%)
  const questionnaireModules = modules.filter((m) => m.data.type === 'questionnaire')
  const otherModules = modules.filter((m) => m.data.type !== 'questionnaire')

  const pickModule = (): SeededModule => {
    if (rand() < 0.6 && questionnaireModules.length > 0) {
      return pick(questionnaireModules)
    }
    // Pick from all non-questionnaire assigned modules, or fallback to questionnaires
    if (otherModules.length > 0) return pick(otherModules)
    return pick(questionnaireModules)
  }

  for (let i = 0; i < assignedPatients.length; i++) {
    const patientId = assignedPatients[i]
    const therapistId = users.patientTherapistMap.get(String(patientId))!
    const count = patientAssignmentCounts[i]

    for (let j = 0; j < count; j++) {
      const mod = pickModule()

      // Status distribution: 45% completed, 25% assigned, 15% in_progress, 15% cancelled
      const statusRoll = rand()
      let status: string
      if (statusRoll < 0.45) status = 'completed'
      else if (statusRoll < 0.70) status = 'assigned'
      else if (statusRoll < 0.85) status = 'in_progress'
      else status = 'cancelled'

      // Due date: 60% have one
      let dueAt: Date | undefined
      if (rand() < 0.6) {
        const dueRoll = rand()
        if (dueRoll < 0.3) dueAt = daysAgo(randInt(1, 14)) // past/overdue
        else if (dueRoll < 0.6) dueAt = daysAgo(-randInt(1, 5)) // upcoming
        else dueAt = daysAgo(-randInt(6, 14)) // future
      }

      // Recurrence: 15% (mostly weekly for questionnaires)
      let recurrence: { freq: 'weekly' | 'monthly'; interval: number } | undefined
      if (rand() < 0.15 && mod.data.type === 'questionnaire') {
        recurrence = { freq: rand() < 0.8 ? 'weekly' : 'monthly', interval: 1 }
      }

      // Notes: 40%
      const notes = rand() < 0.4 ? pick(THERAPIST_NOTES) : undefined

      const createdAt = daysAgo(randInt(7, 60))

      const assignment = await ModuleAssignment.create({
        user: patientId,
        therapist: therapistId,
        program: mod.program._id,
        module: mod.doc._id,
        moduleType: mod.data.type,
        status,
        dueAt,
        recurrence,
        notes,
        createdAt,
        updatedAt: status === 'assigned' ? createdAt : daysAgo(randInt(0, 6)),
      })

      seededAssignments.push({
        _id: assignment._id as Types.ObjectId,
        userId: patientId,
        therapistId,
        moduleDoc: mod.doc,
        moduleData: mod.data,
        programId: mod.program._id as Types.ObjectId,
        status,
        questions: mod.questions,
        bands: mod.bands,
      })
    }
  }

  const statusCounts = seededAssignments.reduce(
    (acc, a) => {
      acc[a.status] = (acc[a.status] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )
  console.log(`  Assignments: ${seededAssignments.length}`, statusCounts)

  return seededAssignments
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/seeds/seedAll.ts
git commit -m "feat(seeds): add assignment seeding with status distribution"
```

---

### Task 7: Add attempt seeding function

Add the function that creates attempts linked to assignments (completed/in_progress) plus self-started attempts on open modules. Handles questionnaire answers, diary entries, scoring, snapshots, and weekStart.

**Files:**
- Modify: `src/seeds/seedAll.ts`

- [ ] **Step 1: Add the attempt generation helpers and seedAttempts function**

Append to `src/seeds/seedAll.ts`:

```typescript
// ─── SEED ATTEMPTS ────────────────────────────────────────────────

/** Generate a questionnaire attempt's answers and score */
const generateAnswers = (questions: IQuestion[], bands: IScoreBand[]) => {
  const answers = questions.map((q) => {
    const chosenIndex = randInt(0, q.choices.length - 1)
    const choice = q.choices[chosenIndex]
    return {
      question: q._id,
      chosenScore: choice.score,
      chosenIndex,
      chosenText: choice.text,
    }
  })

  const totalScore = answers.reduce((sum, a) => sum + a.chosenScore, 0)
  const band = bands.find((b) => totalScore >= b.min && totalScore <= b.max)
  const scoreBandLabel = band?.label ?? 'Unknown'

  return { answers, totalScore, scoreBandLabel }
}

/** Generate diary entries for an activity diary attempt */
const generateDiaryEntries = (startDate: Date) => {
  const entryCount = randInt(3, 10)
  const entries = []
  for (let i = 0; i < entryCount; i++) {
    const slotHour = SLOT_START_HOUR + randInt(0, Math.floor((SLOT_END_HOUR - SLOT_START_HOUR) / SLOT_STEP_HOURS) - 1) * SLOT_STEP_HOURS
    const entryDate = new Date(startDate)
    entryDate.setHours(slotHour, randInt(0, 59), 0, 0)
    entries.push({
      at: entryDate,
      label: `${slotHour}:00–${slotHour + SLOT_STEP_HOURS}:00`,
      activity: pick(ACTIVITIES),
      mood: randInt(0, 100),
      achievement: randInt(0, 10),
      closeness: randInt(0, 10),
      enjoyment: randInt(0, 10),
    })
  }
  return entries
}

/** Build a module snapshot for questionnaire attempts */
const buildSnapshot = (mod: IModule, questions: IQuestion[]) => ({
  title: mod.title,
  disclaimer: mod.disclaimer,
  questions: questions.map((q) => ({
    _id: q._id,
    text: q.text,
    choices: q.choices.map((c) => ({ text: c.text, score: c.score })),
  })),
})

const seedAttempts = async (
  users: SeededUsers,
  modules: SeededModule[],
  assignments: SeededAssignment[]
) => {
  let totalCreated = 0
  const iterationTracker = new Map<string, number>() // `${userId}-${moduleId}` -> count

  const getIteration = (userId: Types.ObjectId, moduleId: Types.ObjectId): number => {
    const key = `${String(userId)}-${String(moduleId)}`
    const current = (iterationTracker.get(key) ?? 0) + 1
    iterationTracker.set(key, current)
    return current
  }

  // --- Assignment-linked attempts ---
  for (const assignment of assignments) {
    if (assignment.status !== 'completed' && assignment.status !== 'in_progress') continue

    const isSubmitted = assignment.status === 'completed'
    const status = isSubmitted ? 'submitted' : 'started'

    // Timing: submitted spread over last 60 days (clustered recent), started in last 14 days
    const startDaysAgo = isSubmitted
      ? (rand() < 0.5 ? randInt(0, 14) : randInt(15, 60))
      : randInt(0, 14)
    const startedAt = daysAgo(startDaysAgo)

    // Duration
    let durationMins: number
    if (assignment.moduleData.type === 'questionnaire') durationMins = randInt(3, 20)
    else if (assignment.moduleData.type === 'activity_diary') durationMins = randInt(5, 30)
    else durationMins = randInt(2, 15)

    const completedAt = isSubmitted ? minsAfter(startedAt, durationMins) : undefined
    const lastInteractionAt = completedAt ?? minsAfter(startedAt, randInt(1, 5))
    const durationSecs = isSubmitted ? durationMins * 60 : undefined

    const iteration = getIteration(assignment.userId, assignment.moduleDoc._id as Types.ObjectId)

    const attemptData: Record<string, unknown> = {
      user: assignment.userId,
      therapist: assignment.therapistId,
      program: assignment.programId,
      module: assignment.moduleDoc._id,
      moduleType: assignment.moduleData.type,
      status,
      startedAt,
      completedAt,
      lastInteractionAt,
      durationSecs,
      iteration,
      contentVersion: 1,
    }

    // Questionnaire-specific fields
    if (assignment.moduleData.type === 'questionnaire' && assignment.questions.length > 0) {
      if (isSubmitted) {
        const { answers, totalScore, scoreBandLabel } = generateAnswers(
          assignment.questions,
          assignment.bands
        )
        attemptData.answers = answers
        attemptData.totalScore = totalScore
        attemptData.scoreBandLabel = scoreBandLabel
        attemptData.weekStart = getWeekStart(startedAt)
      } else {
        // In progress: partial answers
        const answeredCount = randInt(1, Math.max(1, assignment.questions.length - 1))
        const partialAnswers = assignment.questions.slice(0, answeredCount).map((q) => {
          const chosenIndex = randInt(0, q.choices.length - 1)
          const choice = q.choices[chosenIndex]
          return {
            question: q._id,
            chosenScore: choice.score,
            chosenIndex,
            chosenText: choice.text,
          }
        })
        attemptData.answers = partialAnswers
      }
      attemptData.moduleSnapshot = buildSnapshot(assignment.moduleDoc, assignment.questions)
    }

    // Activity diary entries
    if (assignment.moduleData.type === 'activity_diary' && isSubmitted) {
      attemptData.diaryEntries = generateDiaryEntries(startedAt)
    }

    const attempt = await ModuleAttempt.create(attemptData)

    // Back-link to assignment
    await ModuleAssignment.findByIdAndUpdate(assignment._id, {
      latestAttempt: attempt._id,
    })

    totalCreated++
  }

  // --- Standalone abandoned attempts ---
  // Generate additional abandoned attempts to reach ~25% of total
  // Assignment-linked gives ~100 attempts (all submitted/started), so we need ~45 abandoned
  const abandonedCount = randInt(40, 50)
  for (let i = 0; i < abandonedCount; i++) {
    const patientId = pick(users.patients.filter((p) => users.patientTherapistMap.has(String(p))))
    const therapistId = users.patientTherapistMap.get(String(patientId))!
    const mod = pick(modules)

    const startedAt = daysAgo(randInt(0, 14))
    const lastInteractionAt = minsAfter(startedAt, randInt(1, 5))
    const iteration = getIteration(patientId, mod.doc._id as Types.ObjectId)

    const attemptData: Record<string, unknown> = {
      user: patientId,
      therapist: therapistId,
      program: mod.program._id,
      module: mod.doc._id,
      moduleType: mod.data.type,
      status: 'abandoned',
      startedAt,
      lastInteractionAt,
      iteration,
      contentVersion: 1,
    }

    if (mod.data.type === 'questionnaire' && mod.questions.length > 0) {
      const answeredCount = randInt(0, Math.max(1, mod.questions.length - 2))
      if (answeredCount > 0) {
        const partialAnswers = mod.questions.slice(0, answeredCount).map((q) => {
          const chosenIndex = randInt(0, q.choices.length - 1)
          const choice = q.choices[chosenIndex]
          return { question: q._id, chosenScore: choice.score, chosenIndex, chosenText: choice.text }
        })
        attemptData.answers = partialAnswers
      }
      attemptData.moduleSnapshot = buildSnapshot(mod.doc, mod.questions)
    }

    await ModuleAttempt.create(attemptData)
    totalCreated++
  }

  // --- Self-started attempts on open modules ---
  const openModules = modules.filter((m) => m.data.accessPolicy === 'open')

  // ~30-40 self-started attempts spread across patients (including unassigned)
  const selfStartCount = randInt(30, 40)
  for (let i = 0; i < selfStartCount; i++) {
    const patientId = pick(users.patients)
    const mod = pick(openModules)
    const therapistId = users.patientTherapistMap.get(String(patientId))

    // Status: 55% submitted, 20% started, 25% abandoned
    const statusRoll = rand()
    let status: string
    if (statusRoll < 0.55) status = 'submitted'
    else if (statusRoll < 0.75) status = 'started'
    else status = 'abandoned'

    const isSubmitted = status === 'submitted'
    const startDaysAgo = status === 'abandoned' || status === 'started'
      ? randInt(0, 14)
      : (rand() < 0.5 ? randInt(0, 14) : randInt(15, 60))
    const startedAt = daysAgo(startDaysAgo)

    let durationMins: number
    if (mod.data.type === 'questionnaire') durationMins = randInt(3, 20)
    else durationMins = randInt(2, 15)

    const completedAt = isSubmitted ? minsAfter(startedAt, durationMins) : undefined
    const lastInteractionAt = status === 'abandoned'
      ? minsAfter(startedAt, randInt(1, 5))
      : (completedAt ?? minsAfter(startedAt, randInt(1, 5)))
    const durationSecs = isSubmitted ? durationMins * 60 : undefined

    const iteration = getIteration(patientId, mod.doc._id as Types.ObjectId)

    const attemptData: Record<string, unknown> = {
      user: patientId,
      ...(therapistId ? { therapist: therapistId } : {}),
      program: mod.program._id,
      module: mod.doc._id,
      moduleType: mod.data.type,
      status,
      startedAt,
      completedAt,
      lastInteractionAt,
      durationSecs,
      iteration,
      contentVersion: 1,
    }

    if (mod.data.type === 'questionnaire' && mod.questions.length > 0) {
      if (isSubmitted) {
        const { answers, totalScore, scoreBandLabel } = generateAnswers(mod.questions, mod.bands)
        attemptData.answers = answers
        attemptData.totalScore = totalScore
        attemptData.scoreBandLabel = scoreBandLabel
        attemptData.weekStart = getWeekStart(startedAt)
      } else if (status === 'started') {
        const answeredCount = randInt(1, Math.max(1, mod.questions.length - 1))
        const partialAnswers = mod.questions.slice(0, answeredCount).map((q) => {
          const chosenIndex = randInt(0, q.choices.length - 1)
          const choice = q.choices[chosenIndex]
          return {
            question: q._id,
            chosenScore: choice.score,
            chosenIndex,
            chosenText: choice.text,
          }
        })
        attemptData.answers = partialAnswers
      }
      attemptData.moduleSnapshot = buildSnapshot(mod.doc, mod.questions)
    }

    await ModuleAttempt.create(attemptData)
    totalCreated++
  }

  // Count by status
  const allAttempts = await ModuleAttempt.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])
  const statusCounts = Object.fromEntries(allAttempts.map((a) => [a._id, a.count]))
  console.log(`  Attempts: ${totalCreated}`, statusCounts)
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/seeds/seedAll.ts
git commit -m "feat(seeds): add attempt seeding with scoring, snapshots, and diary entries"
```

---

### Task 8: Add main entry point and summary logging

Wire everything together with the main function, DB connection, drop, and summary output.

**Files:**
- Modify: `src/seeds/seedAll.ts`

- [ ] **Step 1: Add the main function and entry point**

Append to `src/seeds/seedAll.ts`:

```typescript
// ─── MAIN ─────────────────────────────────────────────────────────

const main = async () => {
  const start = Date.now()

  console.log('\n--- Dropping database ---')
  await mongoose.connection.dropDatabase()
  console.log('  Database dropped')

  console.log('\n--- Seeding content ---')
  const modules = await seedContent()

  console.log('\n--- Seeding users ---')
  const users = await seedUsers()

  console.log('\n--- Seeding assignments ---')
  const assignments = await seedAssignments(users, modules)

  console.log('\n--- Seeding attempts ---')
  await seedAttempts(users, modules, assignments)

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\n--- Seed complete in ${elapsed}s ---`)
  console.log('\nExample credentials:')
  console.log('  patient1@test.com  / 12345678')
  console.log('  therapist1@test.com / 12345678')
  console.log('  admin1@test.com    / 12345678')
}

if (require.main === module) {
  import('../config/database').then((connectDB) =>
    connectDB
      .default()
      .then(async () => {
        console.log('Connected to DB')
        await main()
        process.exit(0)
      })
      .catch((err) => {
        console.error('Seed failed:', err)
        process.exit(1)
      })
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/seeds/seedAll.ts
git commit -m "feat(seeds): add main entry point with drop, orchestration, and summary"
```

---

### Task 9: Run the seed and verify

Execute the full seed against a local database and verify the output.

**Files:**
- No file changes — verification only

- [ ] **Step 1: Run the seed**

Run: `npm run seed-all`

Expected output (approximate):
```
Connected to DB

--- Dropping database ---
  Database dropped

--- Seeding content ---
  Program: Depression
    Module: PHQ-9 (questionnaire, assigned) — 9q, 5b
    Module: GAD-7 (questionnaire, assigned) — 7q, 4b
    Module: PSS-10 (questionnaire, open) — 10q, 3b
    Module: AUDIT-C (questionnaire, assigned) — 3q, 4b
    Module: ISI (questionnaire, assigned) — 7q, 4b
    Module: Activity Diary (activity_diary, assigned) — 0q, 0b
  Program: Resilience & Coping
    Module: Resilience Snapshot (6-item) (questionnaire, assigned) — 6q, 3b
    Module: Values Clarification (exercise, assigned) — 0q, 0b
  Program: Sleep Health
    Module: Sleep Hygiene Basics (psychoeducation, open) — 0q, 0b

--- Seeding users ---
  Admins: 5
  Therapists: 25 (18 verified)
  Patients: 60 (55 assigned, 5 unassigned)

--- Seeding assignments ---
  Assignments: ~170 { completed: ~76, assigned: ~42, in_progress: ~25, cancelled: ~25 }

--- Seeding attempts ---
  Attempts: ~200 { submitted: ~110, started: ~40, abandoned: ~50 }

--- Seed complete in Xs ---

Example credentials:
  patient1@test.com  / 12345678
  therapist1@test.com / 12345678
  admin1@test.com    / 12345678
```

- [ ] **Step 2: Verify data integrity with quick DB checks**

Run the following to verify data relationships:

```bash
npx ts-node -e "
import('../src/config/database').then(c => c.default().then(async () => {
  const mongoose = require('mongoose');
  const db = mongoose.connection.db;
  const users = await db.collection('users-data').countDocuments();
  const programs = await db.collection('programs').countDocuments();
  const modules = await db.collection('modules').countDocuments();
  const questions = await db.collection('questions').countDocuments();
  const bands = await db.collection('scoreBands').countDocuments();
  const assignments = await db.collection('moduleAssignments').countDocuments();
  const attempts = await db.collection('moduleAttempts').countDocuments();
  const assignedPatients = await db.collection('users-data').countDocuments({ therapist: { \$exists: true } });
  console.log({ users, programs, modules, questions, bands, assignments, attempts, assignedPatients });
  process.exit(0);
}))
"
```

Expected: `{ users: 90, programs: 3, modules: 9, questions: 42, bands: 23, assignments: ~170, attempts: ~200, assignedPatients: 55 }`

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(seeds): unified seed-all script complete and verified"
```
