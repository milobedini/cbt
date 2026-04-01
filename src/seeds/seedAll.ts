import dotenv from 'dotenv'
dotenv.config()

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

/** Minutes after a given date */
const minsAfter = (date: Date, mins: number): Date =>
  new Date(date.getTime() + mins * 60 * 1000)

/** Get Monday 00:00 London time for a given date, returned as UTC */
const getWeekStart = (date: Date): Date => {
  const dt = DateTime.fromJSDate(date, { zone: LONDON_TZ })
  const monday = dt.startOf('week') // Luxon weeks start on Monday
  return monday.toUTC().toJSDate()
}

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
  type: 'questionnaire' | 'reading' | 'activity_diary'
  accessPolicy: 'open' | 'assigned'
  disclaimer?: string
  imageUrl?: string
  content?: string
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
        type: 'reading',
        accessPolicy: 'assigned',
        disclaimer:
          'Coaching-style exercise. Not a substitute for therapy or crisis care.',
        imageUrl: 'https://placehold.co/600x400?text=Values+Clarification',
        content: `## What Are Values?

![Values illustration](https://images.unsplash.com/photo-1506784983877-45594efa4cbe?w=800&h=400&fit=crop)

Values are the things that matter most to you — the principles and qualities you want to guide your life. They are different from goals: goals can be achieved, but values are ongoing directions.

### Why Values Matter in Therapy

When we feel low or anxious, we often lose touch with what matters to us. Reconnecting with your values can help you make choices that improve your wellbeing.

### Life Domains to Consider

Think about what matters to you in each of these areas:

- **Relationships** — What kind of partner, friend, or family member do you want to be?
- **Work & Education** — What matters to you about how you spend your working time?
- **Leisure & Fun** — What activities bring you genuine enjoyment?
- **Health & Wellbeing** — How do you want to care for your body and mind?
- **Community** — How do you want to contribute to the world around you?

### Next Steps

For each domain, write down one small action you could take this week that moves you closer to living by your values. It does not need to be big — small steps count.`,
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
        type: 'reading',
        accessPolicy: 'open',
        imageUrl: 'https://placehold.co/600x400?text=Sleep+Hygiene+Basics',
        content: `## Why Sleep Matters

Sleep has a powerful effect on mood, concentration, and physical health. When we are not sleeping well, everything feels harder.

### Common Sleep Disruptors

- **Screens before bed** — Blue light from phones and laptops suppresses melatonin production
- **Caffeine after midday** — Caffeine has a half-life of 5-6 hours and can disrupt sleep even if you feel tired
- **Irregular schedule** — Going to bed and waking at different times confuses your body clock
- **Worrying in bed** — The bed becomes associated with stress rather than rest

### Practical Tips

1. **Set a consistent wake time** — even on weekends. This is more important than bedtime.
2. **Create a wind-down routine** — 30-60 minutes before bed, do something calm (reading, stretching, a warm drink).
3. **Keep the bedroom cool and dark** — your body temperature needs to drop to fall asleep.
4. **If you cannot sleep after 20 minutes, get up** — go to another room, do something boring, and return when sleepy.
5. **Limit naps** — if you must nap, keep it under 20 minutes before 3pm.

### When to Seek Help

If sleep problems persist for more than a few weeks and affect your daily life, speak to your therapist or GP. There are effective treatments for insomnia that do not involve medication.`,
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
          ...(modData.content ? { content: modData.content } : {}),
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
      lastLogin: i === 1 ? daysAgo(0) : daysAgo(randInt(0, 30)),
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
  // Enrichment: therapist1 (index 0) gets 10 patients for rich test data
  patientCounts[0] = 10

  // Unverified therapists: the 3 with 0 patients + 4 random others
  const zeroPatientIndices = patientCounts.reduce<number[]>(
    (acc, count, i) => (count === 0 ? [...acc, i] : acc), []
  )
  const verifiedCandidates = shuffle(
    Array.from({ length: 25 }, (_, i) => i).filter(
      (i) => !zeroPatientIndices.includes(i)
    )
  )
  const unverifiedIndices = new Set([
    ...zeroPatientIndices,
    ...verifiedCandidates.slice(0, 4),
  ])
  // Enrichment: therapist1 (index 0) is always verified
  unverifiedIndices.delete(0)

  for (let i = 0; i < 25; i++) {
    const user = await User.create({
      username: `therapist${i + 1}`,
      email: `therapist${i + 1}@test.com`,
      password: hashedPassword,
      name: generateName(),
      roles: [UserRole.THERAPIST],
      isVerified: true,
      isVerifiedTherapist: !unverifiedIndices.has(i),
      lastLogin: i === 0 ? daysAgo(0) : daysAgo(randInt(0, 14)),
    })
    therapists.push(user._id as Types.ObjectId)
  }
  console.log(`  Therapists: ${therapists.length} (${25 - unverifiedIndices.size} verified)`)

  // --- Patients (60) ---
  // Build assignment list: which therapist gets how many patients
  // Then pad/cap at exactly 55 so we get 55 assigned + 5 unassigned = 60
  const allSlots = patientCounts.flatMap((count, therapistIdx) =>
    Array.from({ length: count }, () => ({ therapistIdx }))
  )
  // Pad to at least 55 if bell curve produced fewer
  while (allSlots.length < 55) {
    const therapistIdx = randInt(0, 24)
    if (patientCounts[therapistIdx] > 0) allSlots.push({ therapistIdx })
  }
  const patientSlots = shuffle(allSlots).slice(0, 55)
  // Enrichment: patient1 (index 0) always assigned to therapist1 (index 0)
  patientSlots[0] = { therapistIdx: 0 }

  for (let i = 1; i <= 60; i++) {
    // Enrichment: patient1 always has a recent login
    const lastLogin = i === 1
      ? daysAgo(0)
      : (() => {
          const loginVariant = rand()
          return loginVariant < 0.3
            ? daysAgo(randInt(0, 3))
            : loginVariant < 0.7
              ? daysAgo(randInt(4, 21))
              : daysAgo(randInt(22, 60))
        })()

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

    // Assign therapist if within the assigned range (first 55 patients)
    const slot = patientSlots[i - 1]
    if (slot) {
      const therapistId = therapists[slot.therapistIdx]
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

// ─── SEED ASSIGNMENTS ─────────────────────────────────────────────

interface SeededAssignment {
  _id: Types.ObjectId
  userId: Types.ObjectId
  therapistId: Types.ObjectId
  moduleDoc: IModule
  moduleData: ModuleData
  programId: Types.ObjectId
  status: string
  dueAt?: Date
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

  // Enrichment: find patient1 in assignedPatients and give them many assignments
  const patient1Id = users.patients[0]
  const therapist1Id = users.therapists[0]
  const patient1Idx = assignedPatients.findIndex((p) => String(p) === String(patient1Id))
  if (patient1Idx !== -1) {
    // patient1 gets one per module + extras = ~15 total (handled via dedicated loop below)
    patientAssignmentCounts[patient1Idx] = 0 // Skip in main loop, handled separately
  }

  // Enrichment: boost therapist1's other patients to 4-6 assignments each
  const therapist1PatientIds = new Set(
    assignedPatients
      .filter((p) => String(users.patientTherapistMap.get(String(p))) === String(therapist1Id))
      .map(String)
  )
  for (let i = 0; i < assignedPatients.length; i++) {
    if (String(assignedPatients[i]) === String(patient1Id)) continue
    if (therapist1PatientIds.has(String(assignedPatients[i]))) {
      patientAssignmentCounts[i] = Math.max(patientAssignmentCounts[i], randInt(4, 6))
    }
  }

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
      const status = statusRoll < 0.45 ? 'completed'
        : statusRoll < 0.70 ? 'assigned'
        : statusRoll < 0.85 ? 'in_progress'
        : 'cancelled'

      // Due date: 60% have one
      const dueAt = rand() < 0.6
        ? (() => {
            const dueRoll = rand()
            return dueRoll < 0.3 ? daysAgo(randInt(1, 14))
              : dueRoll < 0.6 ? daysAgo(-randInt(1, 5))
              : daysAgo(-randInt(6, 14))
          })()
        : undefined

      // Recurrence: 15% (mostly weekly for questionnaires)
      const recurrence = rand() < 0.15 && mod.data.type === 'questionnaire'
        ? { freq: (rand() < 0.8 ? 'weekly' : 'monthly') as 'weekly' | 'monthly', interval: 1 }
        : undefined

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
        source: 'therapist' as const,
        ...(dueAt ? { dueAt } : {}),
        ...(recurrence ? { recurrence } : {}),
        ...(notes ? { notes } : {}),
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
        dueAt,
        questions: mod.questions,
        bands: mod.bands,
      })
    }
  }

  // ── Enrichment: dedicated patient1 assignments covering every module ──
  if (patient1Idx !== -1) {
    // One assignment per module (guaranteed full coverage)
    const patient1Modules = [...modules]
    // Add extra random modules for repeat assignments (score history), excluding diary (handled separately)
    const extraCount = randInt(4, 7)
    for (let i = 0; i < extraCount; i++) {
      let mod = pickModule()
      while (mod.data.type === 'activity_diary') mod = pickModule()
      patient1Modules.push(mod)
    }

    // Add 2 extra activity diary assignments (so patient1 has 3 total: 2 completed + 1 in_progress)
    const diaryModule = modules.find((m) => m.data.type === 'activity_diary')
    if (diaryModule) {
      patient1Modules.push(diaryModule, diaryModule)
    }

    const patient1Statuses = ['completed', 'completed', 'completed', 'completed', 'completed',
      'completed', 'assigned', 'assigned', 'in_progress', 'in_progress', 'cancelled']

    // Build a status override map for activity diary assignments to guarantee 2 completed + 1 in_progress
    let diarySeenCount = 0
    const getDiaryStatus = (): string => {
      diarySeenCount++
      if (diarySeenCount <= 2) return 'completed'
      return 'in_progress' // 3rd diary = halfway through
    }

    for (let j = 0; j < patient1Modules.length; j++) {
      const mod = patient1Modules[j]
      // Activity diary gets explicit status control
      const status = mod.data.type === 'activity_diary'
        ? getDiaryStatus()
        : j < patient1Statuses.length
          ? patient1Statuses[j]
          : (rand() < 0.7 ? 'completed' : pick(['assigned', 'in_progress', 'cancelled']))

      const dueAt = rand() < 0.7
        ? (() => {
            const dueRoll = rand()
            return dueRoll < 0.3 ? daysAgo(randInt(1, 14))
              : dueRoll < 0.6 ? daysAgo(-randInt(1, 5))
              : daysAgo(-randInt(6, 14))
          })()
        : undefined

      const recurrence = rand() < 0.2 && mod.data.type === 'questionnaire'
        ? { freq: (rand() < 0.8 ? 'weekly' : 'monthly') as 'weekly' | 'monthly', interval: 1 }
        : undefined

      const notes = rand() < 0.5 ? pick(THERAPIST_NOTES) : undefined
      const createdAt = daysAgo(randInt(7, 60))

      const assignment = await ModuleAssignment.create({
        user: patient1Id,
        therapist: therapist1Id,
        program: mod.program._id,
        module: mod.doc._id,
        moduleType: mod.data.type,
        status,
        source: 'therapist' as const,
        ...(dueAt ? { dueAt } : {}),
        ...(recurrence ? { recurrence } : {}),
        ...(notes ? { notes } : {}),
        createdAt,
        updatedAt: status === 'assigned' ? createdAt : daysAgo(randInt(0, 6)),
      })

      seededAssignments.push({
        _id: assignment._id as Types.ObjectId,
        userId: patient1Id,
        therapistId: therapist1Id,
        moduleDoc: mod.doc,
        moduleData: mod.data,
        programId: mod.program._id as Types.ObjectId,
        status,
        dueAt,
        questions: mod.questions,
        bands: mod.bands,
      })
    }
  }

  // ── Recurring assignment chain (weekly PHQ-9 for patient2) ──
  const phq9Module = modules.find((m) => m.data.title === 'PHQ-9')!
  const patient2Id = users.patients[1]
  const patient2TherapistId = users.patientTherapistMap.get(String(patient2Id))
  // If patient2 has a therapist, build a recurring chain; otherwise use therapist1
  const recurringTherapistId = patient2TherapistId ?? therapist1Id
  const recurrenceGroupId = new Types.ObjectId()

  for (let w = 0; w < 3; w++) {
    const createdAt = daysAgo(28 - w * 7)
    const completedAt = daysAgo(26 - w * 7)
    const recurringAssignment = await ModuleAssignment.create({
      user: patient2Id,
      therapist: recurringTherapistId,
      program: phq9Module.program._id,
      module: phq9Module.doc._id,
      moduleType: 'questionnaire',
      status: 'completed',
      source: 'therapist' as const,
      recurrence: { freq: 'weekly' as const, interval: 1 },
      recurrenceGroupId,
      dueAt: daysAgo(27 - w * 7),
      createdAt,
      updatedAt: completedAt,
    })
    seededAssignments.push({
      _id: recurringAssignment._id as Types.ObjectId,
      userId: patient2Id,
      therapistId: recurringTherapistId,
      moduleDoc: phq9Module.doc,
      moduleData: phq9Module.data,
      programId: phq9Module.program._id as Types.ObjectId,
      status: 'completed',
      dueAt: daysAgo(27 - w * 7),
      questions: phq9Module.questions,
      bands: phq9Module.bands,
    })
  }

  // Current active occurrence in the chain
  const recurringActiveAssignment = await ModuleAssignment.create({
    user: patient2Id,
    therapist: recurringTherapistId,
    program: phq9Module.program._id,
    module: phq9Module.doc._id,
    moduleType: 'questionnaire',
    status: 'assigned',
    source: 'therapist' as const,
    recurrence: { freq: 'weekly' as const, interval: 1 },
    recurrenceGroupId,
    dueAt: daysAgo(-2), // due in 2 days
    createdAt: daysAgo(7),
    updatedAt: daysAgo(7),
  })
  seededAssignments.push({
    _id: recurringActiveAssignment._id as Types.ObjectId,
    userId: patient2Id,
    therapistId: recurringTherapistId,
    moduleDoc: phq9Module.doc,
    moduleData: phq9Module.data,
    programId: phq9Module.program._id as Types.ObjectId,
    status: 'assigned',
    dueAt: daysAgo(-2),
    questions: phq9Module.questions,
    bands: phq9Module.bands,
  })
  console.log('  Recurring chain: 3 completed + 1 active PHQ-9 for patient2')

  // ── Self-initiated assignments (source: 'self', therapist: null) ──
  const openModulesForSelf = modules.filter((m) => m.data.accessPolicy === 'open')
  const selfPatientId = users.patients[2] // patient3
  const selfMod1 = openModulesForSelf[0] ?? phq9Module
  const selfMod2 = openModulesForSelf.length > 1 ? openModulesForSelf[1] : selfMod1

  // Self-initiated: completed with submitted attempt
  const selfCompletedAssignment = await ModuleAssignment.create({
    user: selfPatientId,
    therapist: null,
    program: selfMod1.program._id,
    module: selfMod1.doc._id,
    moduleType: selfMod1.data.type,
    status: 'completed',
    source: 'self' as const,
    createdAt: daysAgo(10),
    updatedAt: daysAgo(9),
  })
  seededAssignments.push({
    _id: selfCompletedAssignment._id as Types.ObjectId,
    userId: selfPatientId,
    therapistId: null as unknown as Types.ObjectId,
    moduleDoc: selfMod1.doc,
    moduleData: selfMod1.data,
    programId: selfMod1.program._id as Types.ObjectId,
    status: 'completed',
    questions: selfMod1.questions,
    bands: selfMod1.bands,
  })

  // Self-initiated: in-progress with started attempt
  const selfInProgressAssignment = await ModuleAssignment.create({
    user: selfPatientId,
    therapist: null,
    program: selfMod2.program._id,
    module: selfMod2.doc._id,
    moduleType: selfMod2.data.type,
    status: 'in_progress',
    source: 'self' as const,
    createdAt: daysAgo(3),
    updatedAt: daysAgo(2),
  })
  seededAssignments.push({
    _id: selfInProgressAssignment._id as Types.ObjectId,
    userId: selfPatientId,
    therapistId: null as unknown as Types.ObjectId,
    moduleDoc: selfMod2.doc,
    moduleData: selfMod2.data,
    programId: selfMod2.program._id as Types.ObjectId,
    status: 'in_progress',
    questions: selfMod2.questions,
    bands: selfMod2.bands,
  })

  // Self-initiated: another completed for patient4
  const selfPatient4Id = users.patients[3]
  const selfCompletedAssignment2 = await ModuleAssignment.create({
    user: selfPatient4Id,
    therapist: null,
    program: selfMod1.program._id,
    module: selfMod1.doc._id,
    moduleType: selfMod1.data.type,
    status: 'completed',
    source: 'self' as const,
    createdAt: daysAgo(5),
    updatedAt: daysAgo(4),
  })
  seededAssignments.push({
    _id: selfCompletedAssignment2._id as Types.ObjectId,
    userId: selfPatient4Id,
    therapistId: null as unknown as Types.ObjectId,
    moduleDoc: selfMod1.doc,
    moduleData: selfMod1.data,
    programId: selfMod1.program._id as Types.ObjectId,
    status: 'completed',
    questions: selfMod1.questions,
    bands: selfMod1.bands,
  })
  console.log('  Self-initiated: 3 assignments (2 completed, 1 in-progress)')

  // ── Needs-attention scenarios ──
  // Use therapist1's patients for needs-attention so they show up in their dashboard
  const attentionPatients = users.patients.filter(
    (p) => String(users.patientTherapistMap.get(String(p))) === String(therapist1Id)
      && String(p) !== String(patient1Id)
  )

  // 1. Severe PHQ-9 (score 20+) — patient with severe depression
  const severePatientId = attentionPatients[0] ?? users.patients[4]
  const severeAssignment = await ModuleAssignment.create({
    user: severePatientId,
    therapist: therapist1Id,
    program: phq9Module.program._id,
    module: phq9Module.doc._id,
    moduleType: 'questionnaire',
    status: 'completed',
    source: 'therapist' as const,
    dueAt: daysAgo(2),
    createdAt: daysAgo(10),
    updatedAt: daysAgo(1),
  })
  seededAssignments.push({
    _id: severeAssignment._id as Types.ObjectId,
    userId: severePatientId,
    therapistId: therapist1Id,
    moduleDoc: phq9Module.doc,
    moduleData: phq9Module.data,
    programId: phq9Module.program._id as Types.ObjectId,
    status: 'completed',
    dueAt: daysAgo(2),
    questions: phq9Module.questions,
    bands: phq9Module.bands,
  })

  // 2. Regression — patient with score going up (8 then 14)
  const regressionPatientId = attentionPatients[1] ?? users.patients[5]
  const regressionAssignment1 = await ModuleAssignment.create({
    user: regressionPatientId,
    therapist: therapist1Id,
    program: phq9Module.program._id,
    module: phq9Module.doc._id,
    moduleType: 'questionnaire',
    status: 'completed',
    source: 'therapist' as const,
    createdAt: daysAgo(21),
    updatedAt: daysAgo(19),
  })
  const regressionAssignment2 = await ModuleAssignment.create({
    user: regressionPatientId,
    therapist: therapist1Id,
    program: phq9Module.program._id,
    module: phq9Module.doc._id,
    moduleType: 'questionnaire',
    status: 'completed',
    source: 'therapist' as const,
    createdAt: daysAgo(7),
    updatedAt: daysAgo(5),
  })
  seededAssignments.push(
    {
      _id: regressionAssignment1._id as Types.ObjectId,
      userId: regressionPatientId,
      therapistId: therapist1Id,
      moduleDoc: phq9Module.doc,
      moduleData: phq9Module.data,
      programId: phq9Module.program._id as Types.ObjectId,
      status: 'completed',
      questions: phq9Module.questions,
      bands: phq9Module.bands,
    },
    {
      _id: regressionAssignment2._id as Types.ObjectId,
      userId: regressionPatientId,
      therapistId: therapist1Id,
      moduleDoc: phq9Module.doc,
      moduleData: phq9Module.data,
      programId: phq9Module.program._id as Types.ObjectId,
      status: 'completed',
      questions: phq9Module.questions,
      bands: phq9Module.bands,
    },
  )

  // 3. Overdue assignment (5 days overdue, still 'assigned')
  const overduePatientId = attentionPatients[2] ?? users.patients[6]
  const overdueAssignment = await ModuleAssignment.create({
    user: overduePatientId,
    therapist: therapist1Id,
    program: phq9Module.program._id,
    module: phq9Module.doc._id,
    moduleType: 'questionnaire',
    status: 'assigned',
    source: 'therapist' as const,
    dueAt: daysAgo(5), // 5 days overdue
    notes: 'Please complete before our next session',
    createdAt: daysAgo(12),
    updatedAt: daysAgo(12),
  })
  seededAssignments.push({
    _id: overdueAssignment._id as Types.ObjectId,
    userId: overduePatientId,
    therapistId: therapist1Id,
    moduleDoc: phq9Module.doc,
    moduleData: phq9Module.data,
    programId: phq9Module.program._id as Types.ObjectId,
    status: 'assigned',
    dueAt: daysAgo(5),
    questions: phq9Module.questions,
    bands: phq9Module.bands,
  })

  // 4. First submission trigger — patient with exactly one submitted attempt
  const firstSubmitPatientId = attentionPatients[3] ?? users.patients[7]
  const firstSubmitAssignment = await ModuleAssignment.create({
    user: firstSubmitPatientId,
    therapist: therapist1Id,
    program: phq9Module.program._id,
    module: phq9Module.doc._id,
    moduleType: 'questionnaire',
    status: 'completed',
    source: 'therapist' as const,
    dueAt: daysAgo(1),
    createdAt: daysAgo(7),
    updatedAt: daysAgo(1),
  })
  seededAssignments.push({
    _id: firstSubmitAssignment._id as Types.ObjectId,
    userId: firstSubmitPatientId,
    therapistId: therapist1Id,
    moduleDoc: phq9Module.doc,
    moduleData: phq9Module.data,
    programId: phq9Module.program._id as Types.ObjectId,
    status: 'completed',
    dueAt: daysAgo(1),
    questions: phq9Module.questions,
    bands: phq9Module.bands,
  })
  console.log('  Needs-attention: severe, regression, overdue, first-submission scenarios')

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

/** Zero-padded slot label matching FE format: "06:00–08:00" */
const pad2 = (n: number) => String(n).padStart(2, '0')
const slotLabel = (h: number) =>
  `${pad2(h)}:00\u2013${pad2(Math.min(24, h + SLOT_STEP_HOURS))}:00`

/** Build a single diary entry at the given UTC slot */
const buildDiaryEntry = (weekStart: Date, dayOffset: number, slotHour: number) => {
  const entryDate = new Date(weekStart)
  entryDate.setUTCDate(entryDate.getUTCDate() + dayOffset)
  entryDate.setUTCHours(slotHour, 0, 0, 0)
  return {
    at: entryDate,
    label: slotLabel(slotHour),
    activity: pick(ACTIVITIES),
    mood: randInt(0, 100),
    achievement: randInt(0, 10),
    closeness: randInt(0, 10),
    enjoyment: randInt(0, 10),
  }
}

/** Generate diary entries spread across the week anchored by weekStart (Monday) */
const generateDiaryEntries = (weekStart: Date, entryCount?: number) => {
  const slotCount = Math.floor((SLOT_END_HOUR - SLOT_START_HOUR) / SLOT_STEP_HOURS)
  const count = entryCount ?? randInt(3, 10)
  return Array.from({ length: count }, () =>
    buildDiaryEntry(weekStart, randInt(0, 6), SLOT_START_HOUR + randInt(0, slotCount - 1) * SLOT_STEP_HOURS)
  )
}

/** Generate a full week of diary entries — every 2-hour slot, every day (63 entries) */
const generateFullDiaryWeek = (weekStart: Date) => {
  const slotsPerDay = Math.floor((SLOT_END_HOUR - SLOT_START_HOUR) / SLOT_STEP_HOURS)
  const entries: ReturnType<typeof generateDiaryEntries> = []
  for (let day = 0; day < 7; day++) {
    for (let slot = 0; slot < slotsPerDay; slot++) {
      entries.push(buildDiaryEntry(weekStart, day, SLOT_START_HOUR + slot * SLOT_STEP_HOURS))
    }
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

    const durationMins = assignment.moduleData.type === 'questionnaire' ? randInt(3, 20)
      : assignment.moduleData.type === 'activity_diary' ? randInt(5, 30)
      : randInt(2, 15)

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
      ...(assignment.dueAt ? { dueAt: assignment.dueAt } : {}),
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

    // Activity diary entries (full for submitted, partial for in-progress)
    if (assignment.moduleData.type === 'activity_diary') {
      const weekStart = getWeekStart(startedAt)
      attemptData.weekStart = weekStart
      const isPatient1 = String(assignment.userId) === String(users.patients[0])
      if (isSubmitted) {
        // Enrichment: patient1's completed diaries have every slot filled
        attemptData.diaryEntries = isPatient1
          ? generateFullDiaryWeek(weekStart)
          : generateDiaryEntries(weekStart)
      } else {
        attemptData.diaryEntries = generateDiaryEntries(weekStart, randInt(1, 3))
      }
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
    const status = statusRoll < 0.55 ? 'submitted'
      : statusRoll < 0.75 ? 'started'
      : 'abandoned'

    const isSubmitted = status === 'submitted'
    const startDaysAgo = status === 'abandoned' || status === 'started'
      ? randInt(0, 14)
      : (rand() < 0.5 ? randInt(0, 14) : randInt(15, 60))
    const startedAt = daysAgo(startDaysAgo)

    const durationMins = mod.data.type === 'questionnaire' ? randInt(3, 20) : randInt(2, 15)

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

  // ── Enrichment: extra abandoned attempts for patient1 ──
  const patient1Id = users.patients[0]
  const therapist1Id = users.therapists[0]
  const patient1AbandonedCount = randInt(5, 8)
  for (let i = 0; i < patient1AbandonedCount; i++) {
    const mod = pick(modules)
    const startedAt = daysAgo(randInt(0, 30))
    const lastInteractionAt = minsAfter(startedAt, randInt(1, 5))
    const iteration = getIteration(patient1Id, mod.doc._id as Types.ObjectId)

    const attemptData: Record<string, unknown> = {
      user: patient1Id,
      therapist: therapist1Id,
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

  // ── Enrichment: extra self-started attempts for patient1 on open modules ──
  const patient1SelfStartCount = randInt(5, 8)
  for (let i = 0; i < patient1SelfStartCount; i++) {
    const mod = pick(openModules)
    const statusRoll = rand()
    const status = statusRoll < 0.6 ? 'submitted' : statusRoll < 0.8 ? 'started' : 'abandoned'
    const isSubmitted = status === 'submitted'

    const startDaysAgo = isSubmitted
      ? (rand() < 0.5 ? randInt(0, 14) : randInt(15, 60))
      : randInt(0, 14)
    const startedAt = daysAgo(startDaysAgo)
    const durationMins = mod.data.type === 'questionnaire' ? randInt(3, 20) : randInt(2, 15)

    const completedAt = isSubmitted ? minsAfter(startedAt, durationMins) : undefined
    const lastInteractionAt = status === 'abandoned'
      ? minsAfter(startedAt, randInt(1, 5))
      : (completedAt ?? minsAfter(startedAt, randInt(1, 5)))
    const durationSecs = isSubmitted ? durationMins * 60 : undefined

    const iteration = getIteration(patient1Id, mod.doc._id as Types.ObjectId)

    const attemptData: Record<string, unknown> = {
      user: patient1Id,
      therapist: therapist1Id,
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
          return { question: q._id, chosenScore: choice.score, chosenIndex, chosenText: choice.text }
        })
        attemptData.answers = partialAnswers
      }
      attemptData.moduleSnapshot = buildSnapshot(mod.doc, mod.questions)
    }

    await ModuleAttempt.create(attemptData)
    totalCreated++
  }

  // ── Enrichment: therapist1 dashboard — submitted attempts THIS WEEK ──
  // Creates pairs of attempts (old + recent) for 4 of therapist1's clients
  // so the dashboard shows: "Completed This Week" bucket, score deltas, and ✓
  const therapist1Patients = users.patients.filter(
    (p) => String(users.patientTherapistMap.get(String(p))) === String(therapist1Id)
      && String(p) !== String(patient1Id)
  )

  const questionnaireMods = modules.filter((m) => m.data.type === 'questionnaire' && m.questions.length > 0)

  // Pick 4 clients (or fewer if therapist1 has fewer)
  const dashboardClients = therapist1Patients.slice(0, Math.min(4, therapist1Patients.length))

  for (let ci = 0; ci < dashboardClients.length; ci++) {
    const clientId = dashboardClients[ci]
    const mod = questionnaireMods[ci % questionnaireMods.length]

    // --- Older attempt (8-14 days ago) → establishes baseline score ---
    const olderStartedAt = daysAgo(randInt(8, 14))
    const olderDurationMins = randInt(5, 15)
    const olderCompletedAt = minsAfter(olderStartedAt, olderDurationMins)
    const olderIteration = getIteration(clientId, mod.doc._id as Types.ObjectId)
    const olderResult = generateAnswers(mod.questions, mod.bands)

    await ModuleAttempt.create({
      user: clientId,
      therapist: therapist1Id,
      program: mod.program._id,
      module: mod.doc._id,
      moduleType: mod.data.type,
      status: 'submitted',
      startedAt: olderStartedAt,
      completedAt: olderCompletedAt,
      lastInteractionAt: olderCompletedAt,
      durationSecs: olderDurationMins * 60,
      iteration: olderIteration,
      contentVersion: 1,
      answers: olderResult.answers,
      totalScore: olderResult.totalScore,
      scoreBandLabel: olderResult.scoreBandLabel,
      weekStart: getWeekStart(olderStartedAt),
      moduleSnapshot: buildSnapshot(mod.doc, mod.questions),
    })
    totalCreated++

    // --- Recent attempt (0-3 days ago, this week) → triggers delta ---
    const recentStartedAt = daysAgo(randInt(0, 3))
    const recentDurationMins = randInt(5, 15)
    const recentCompletedAt = minsAfter(recentStartedAt, recentDurationMins)
    const recentIteration = getIteration(clientId, mod.doc._id as Types.ObjectId)

    // Alternate: first 2 clients improve (lower score), next 2 worsen (higher score)
    const improving = ci < 2
    const maxPossible = mod.questions.reduce((sum, q) => sum + Math.max(...q.choices.map((c) => c.score)), 0)
    const targetScore = improving
      ? Math.max(0, olderResult.totalScore - randInt(2, 5))
      : Math.min(maxPossible, olderResult.totalScore + randInt(2, 5))

    // Generate answers that land close to targetScore
    const recentAnswers = mod.questions.map((q) => {
      const chosenIndex = randInt(0, q.choices.length - 1)
      const choice = q.choices[chosenIndex]
      return {
        question: q._id,
        chosenScore: choice.score,
        chosenIndex,
        chosenText: choice.text,
      }
    })
    // Adjust first answer to hit target
    const currentTotal = recentAnswers.reduce((sum, a) => sum + a.chosenScore, 0)
    const diff = targetScore - currentTotal
    if (diff !== 0 && recentAnswers.length > 0) {
      const firstQ = mod.questions[0]
      const adjusted = recentAnswers[0].chosenScore + diff
      const clamped = Math.max(0, Math.min(firstQ.choices[firstQ.choices.length - 1].score, adjusted))
      recentAnswers[0].chosenScore = clamped
      const closestChoice = firstQ.choices.reduce((prev, curr) =>
        Math.abs(curr.score - clamped) < Math.abs(prev.score - clamped) ? curr : prev
      )
      recentAnswers[0].chosenIndex = firstQ.choices.indexOf(closestChoice)
      recentAnswers[0].chosenText = closestChoice.text
    }

    const recentTotal = recentAnswers.reduce((sum, a) => sum + a.chosenScore, 0)
    const recentBand = mod.bands.find((b) => recentTotal >= b.min && recentTotal <= b.max)

    await ModuleAttempt.create({
      user: clientId,
      therapist: therapist1Id,
      program: mod.program._id,
      module: mod.doc._id,
      moduleType: mod.data.type,
      status: 'submitted',
      startedAt: recentStartedAt,
      completedAt: recentCompletedAt,
      lastInteractionAt: recentCompletedAt,
      durationSecs: recentDurationMins * 60,
      iteration: recentIteration,
      contentVersion: 1,
      answers: recentAnswers,
      totalScore: recentTotal,
      scoreBandLabel: recentBand?.label ?? 'Unknown',
      weekStart: getWeekStart(recentStartedAt),
      moduleSnapshot: buildSnapshot(mod.doc, mod.questions),
    })
    totalCreated++
  }

  // Mark one client's assignments as all completed (for ✓ display)
  if (dashboardClients.length > 0) {
    await ModuleAssignment.updateMany(
      { user: dashboardClients[0], therapist: therapist1Id },
      { $set: { status: 'completed' } }
    )
  }

  // ── Attempts for new unified-practice scenarios ──
  const phq9Module = modules.find((m) => m.data.title === 'PHQ-9')!
  const openModulesForAttempts = modules.filter((m) => m.data.accessPolicy === 'open')

  // --- Recurring chain attempts (3 completed PHQ-9 for patient2 with varying scores) ---
  const patient2Id = users.patients[1]
  const patient2TherapistId = users.patientTherapistMap.get(String(patient2Id))
  const recurringTherapistId = patient2TherapistId ?? therapist1Id
  const recurringScores = [14, 12, 10] // improvement over 3 weeks

  // Find recurring chain assignments for patient2
  const recurringAssignments = assignments.filter(
    (a) => String(a.userId) === String(patient2Id)
      && a.moduleData.title === 'PHQ-9'
      && a.status === 'completed'
  ).slice(-3) // last 3 are the recurring ones we just created

  for (let w = 0; w < Math.min(3, recurringAssignments.length); w++) {
    const ra = recurringAssignments[w]
    const targetScore = recurringScores[w]
    const startedAt = daysAgo(26 - w * 7)
    const durationMins = randInt(5, 12)
    const completedAt = minsAfter(startedAt, durationMins)
    const iteration = getIteration(patient2Id, phq9Module.doc._id as Types.ObjectId)

    // Build answers that sum to the target score
    const answers = phq9Module.questions.map((q, qi) => {
      // Distribute score roughly evenly, with remainder on first questions
      const perQuestion = Math.floor(targetScore / phq9Module.questions.length)
      const remainder = targetScore - perQuestion * phq9Module.questions.length
      const qScore = Math.min(
        q.choices[q.choices.length - 1].score,
        perQuestion + (qi < remainder ? 1 : 0),
      )
      const closestChoice = q.choices.reduce((prev, curr) =>
        Math.abs(curr.score - qScore) < Math.abs(prev.score - qScore) ? curr : prev
      )
      return {
        question: q._id,
        chosenScore: closestChoice.score,
        chosenIndex: q.choices.indexOf(closestChoice),
        chosenText: closestChoice.text,
      }
    })
    const actualScore = answers.reduce((sum, a) => sum + a.chosenScore, 0)
    const band = phq9Module.bands.find((b) => actualScore >= b.min && actualScore <= b.max)

    const attempt = await ModuleAttempt.create({
      user: patient2Id,
      therapist: recurringTherapistId,
      program: phq9Module.program._id,
      module: phq9Module.doc._id,
      moduleType: 'questionnaire',
      status: 'submitted',
      startedAt,
      completedAt,
      lastInteractionAt: completedAt,
      durationSecs: durationMins * 60,
      iteration,
      contentVersion: 1,
      answers,
      totalScore: actualScore,
      scoreBandLabel: band?.label ?? 'Unknown',
      weekStart: getWeekStart(startedAt),
      moduleSnapshot: buildSnapshot(phq9Module.doc, phq9Module.questions),
    })
    await ModuleAssignment.findByIdAndUpdate(ra._id, { latestAttempt: attempt._id })
    totalCreated++
  }
  console.log('  Recurring chain attempts: 3 submitted PHQ-9 (scores ~14, ~12, ~10)')

  // --- Self-initiated attempts ---
  const selfPatientId = users.patients[2]
  const selfMod1 = openModulesForAttempts[0] ?? phq9Module
  const selfMod2 = openModulesForAttempts.length > 1 ? openModulesForAttempts[1] : selfMod1

  // Self-initiated completed attempt
  const selfCompletedAssignments = assignments.filter(
    (a) => String(a.userId) === String(selfPatientId) && a.status === 'completed'
      && a.therapistId === null
  )
  if (selfCompletedAssignments.length > 0) {
    const sca = selfCompletedAssignments[0]
    const startedAt = daysAgo(9)
    const durationMins = randInt(5, 15)
    const completedAt = minsAfter(startedAt, durationMins)
    const iteration = getIteration(selfPatientId, sca.moduleDoc._id as Types.ObjectId)

    const attemptData: Record<string, unknown> = {
      user: selfPatientId,
      program: sca.programId,
      module: sca.moduleDoc._id,
      moduleType: sca.moduleData.type,
      status: 'submitted',
      startedAt,
      completedAt,
      lastInteractionAt: completedAt,
      durationSecs: durationMins * 60,
      iteration,
      contentVersion: 1,
    }
    if (sca.moduleData.type === 'questionnaire' && sca.questions.length > 0) {
      const { answers, totalScore, scoreBandLabel } = generateAnswers(sca.questions, sca.bands)
      attemptData.answers = answers
      attemptData.totalScore = totalScore
      attemptData.scoreBandLabel = scoreBandLabel
      attemptData.weekStart = getWeekStart(startedAt)
      attemptData.moduleSnapshot = buildSnapshot(sca.moduleDoc, sca.questions)
    }
    const attempt = await ModuleAttempt.create(attemptData)
    await ModuleAssignment.findByIdAndUpdate(sca._id, { latestAttempt: attempt._id })
    totalCreated++
  }

  // Self-initiated in-progress attempt
  const selfInProgressAssignments = assignments.filter(
    (a) => String(a.userId) === String(selfPatientId) && a.status === 'in_progress'
      && a.therapistId === null
  )
  if (selfInProgressAssignments.length > 0) {
    const sia = selfInProgressAssignments[0]
    const startedAt = daysAgo(2)
    const iteration = getIteration(selfPatientId, sia.moduleDoc._id as Types.ObjectId)

    const attemptData: Record<string, unknown> = {
      user: selfPatientId,
      program: sia.programId,
      module: sia.moduleDoc._id,
      moduleType: sia.moduleData.type,
      status: 'started',
      startedAt,
      lastInteractionAt: minsAfter(startedAt, randInt(1, 5)),
      iteration,
      contentVersion: 1,
    }
    if (sia.moduleData.type === 'questionnaire' && sia.questions.length > 0) {
      const answeredCount = randInt(1, Math.max(1, sia.questions.length - 1))
      const partialAnswers = sia.questions.slice(0, answeredCount).map((q) => {
        const chosenIndex = randInt(0, q.choices.length - 1)
        const choice = q.choices[chosenIndex]
        return { question: q._id, chosenScore: choice.score, chosenIndex, chosenText: choice.text }
      })
      attemptData.answers = partialAnswers
      attemptData.moduleSnapshot = buildSnapshot(sia.moduleDoc, sia.questions)
    }
    const attempt = await ModuleAttempt.create(attemptData)
    await ModuleAssignment.findByIdAndUpdate(sia._id, { latestAttempt: attempt._id })
    totalCreated++
  }
  console.log('  Self-initiated attempts: 1 submitted + 1 started')

  // --- Needs-attention attempts ---
  const attentionPatients = users.patients.filter(
    (p) => String(users.patientTherapistMap.get(String(p))) === String(therapist1Id)
      && String(p) !== String(patient1Id)
  )

  // 1. Severe PHQ-9 (score 22 — in Severe band 20-27)
  const severePatientId = attentionPatients[0] ?? users.patients[4]
  const severeAssignmentMatch = assignments.find(
    (a) => String(a.userId) === String(severePatientId)
      && a.moduleData.title === 'PHQ-9'
      && a.status === 'completed'
  )
  if (severeAssignmentMatch) {
    const startedAt = daysAgo(1)
    const durationMins = randInt(8, 15)
    const completedAt = minsAfter(startedAt, durationMins)
    const iteration = getIteration(severePatientId, phq9Module.doc._id as Types.ObjectId)

    // Build answers that sum to 22 (Severe band)
    const severeAnswers = phq9Module.questions.map((q, qi) => {
      // 22 / 9 ≈ 2.4 per question; use 3 for first 4 questions, 2 for remaining 5
      const qScore = qi < 4 ? 3 : 2
      const closestChoice = q.choices.reduce((prev, curr) =>
        Math.abs(curr.score - qScore) < Math.abs(prev.score - qScore) ? curr : prev
      )
      return {
        question: q._id,
        chosenScore: closestChoice.score,
        chosenIndex: q.choices.indexOf(closestChoice),
        chosenText: closestChoice.text,
      }
    })
    const severeTotal = severeAnswers.reduce((sum, a) => sum + a.chosenScore, 0)
    const severeBand = phq9Module.bands.find((b) => severeTotal >= b.min && severeTotal <= b.max)

    const attempt = await ModuleAttempt.create({
      user: severePatientId,
      therapist: therapist1Id,
      program: phq9Module.program._id,
      module: phq9Module.doc._id,
      moduleType: 'questionnaire',
      status: 'submitted',
      startedAt,
      completedAt,
      lastInteractionAt: completedAt,
      durationSecs: durationMins * 60,
      iteration,
      contentVersion: 1,
      answers: severeAnswers,
      totalScore: severeTotal,
      scoreBandLabel: severeBand?.label ?? 'Severe',
      weekStart: getWeekStart(startedAt),
      moduleSnapshot: buildSnapshot(phq9Module.doc, phq9Module.questions),
    })
    await ModuleAssignment.findByIdAndUpdate(severeAssignmentMatch._id, { latestAttempt: attempt._id })
    totalCreated++
  }

  // 2. Regression — two attempts: score 8 then 14
  const regressionPatientId = attentionPatients[1] ?? users.patients[5]
  const regressionAssignmentMatches = assignments.filter(
    (a) => String(a.userId) === String(regressionPatientId)
      && a.moduleData.title === 'PHQ-9'
      && a.status === 'completed'
  ).slice(-2)

  const regressionScores = [8, 14]
  for (let ri = 0; ri < Math.min(2, regressionAssignmentMatches.length); ri++) {
    const ra = regressionAssignmentMatches[ri]
    const targetScore = regressionScores[ri]
    const startedAt = daysAgo(ri === 0 ? 19 : 5)
    const durationMins = randInt(5, 12)
    const completedAt = minsAfter(startedAt, durationMins)
    const iteration = getIteration(regressionPatientId, phq9Module.doc._id as Types.ObjectId)

    const answers = phq9Module.questions.map((q, qi) => {
      const perQ = Math.floor(targetScore / phq9Module.questions.length)
      const remainder = targetScore - perQ * phq9Module.questions.length
      const qScore = Math.min(
        q.choices[q.choices.length - 1].score,
        perQ + (qi < remainder ? 1 : 0),
      )
      const closestChoice = q.choices.reduce((prev, curr) =>
        Math.abs(curr.score - qScore) < Math.abs(prev.score - qScore) ? curr : prev
      )
      return {
        question: q._id,
        chosenScore: closestChoice.score,
        chosenIndex: q.choices.indexOf(closestChoice),
        chosenText: closestChoice.text,
      }
    })
    const actualScore = answers.reduce((sum, a) => sum + a.chosenScore, 0)
    const band = phq9Module.bands.find((b) => actualScore >= b.min && actualScore <= b.max)

    const attempt = await ModuleAttempt.create({
      user: regressionPatientId,
      therapist: therapist1Id,
      program: phq9Module.program._id,
      module: phq9Module.doc._id,
      moduleType: 'questionnaire',
      status: 'submitted',
      startedAt,
      completedAt,
      lastInteractionAt: completedAt,
      durationSecs: durationMins * 60,
      iteration,
      contentVersion: 1,
      answers,
      totalScore: actualScore,
      scoreBandLabel: band?.label ?? 'Unknown',
      weekStart: getWeekStart(startedAt),
      moduleSnapshot: buildSnapshot(phq9Module.doc, phq9Module.questions),
    })
    await ModuleAssignment.findByIdAndUpdate(ra._id, { latestAttempt: attempt._id })
    totalCreated++
  }

  // 3. First submission — exactly one submitted attempt for a patient
  const firstSubmitPatientId = attentionPatients[3] ?? users.patients[7]
  const firstSubmitMatch = assignments.find(
    (a) => String(a.userId) === String(firstSubmitPatientId)
      && a.moduleData.title === 'PHQ-9'
      && a.status === 'completed'
  )
  if (firstSubmitMatch) {
    const startedAt = daysAgo(1)
    const durationMins = randInt(6, 12)
    const completedAt = minsAfter(startedAt, durationMins)
    const iteration = getIteration(firstSubmitPatientId, phq9Module.doc._id as Types.ObjectId)
    const { answers, totalScore, scoreBandLabel } = generateAnswers(phq9Module.questions, phq9Module.bands)

    const attempt = await ModuleAttempt.create({
      user: firstSubmitPatientId,
      therapist: therapist1Id,
      program: phq9Module.program._id,
      module: phq9Module.doc._id,
      moduleType: 'questionnaire',
      status: 'submitted',
      startedAt,
      completedAt,
      lastInteractionAt: completedAt,
      durationSecs: durationMins * 60,
      iteration,
      contentVersion: 1,
      answers,
      totalScore,
      scoreBandLabel,
      weekStart: getWeekStart(startedAt),
      moduleSnapshot: buildSnapshot(phq9Module.doc, phq9Module.questions),
    })
    await ModuleAssignment.findByIdAndUpdate(firstSubmitMatch._id, { latestAttempt: attempt._id })
    totalCreated++
  }
  console.log('  Needs-attention attempts: severe, regression (8→14), first-submission')

  // Count by status
  const allAttempts = await ModuleAttempt.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])
  const statusCounts = Object.fromEntries(allAttempts.map((a) => [a._id, a.count]))
  console.log(`  Attempts: ${totalCreated}`, statusCounts)
}

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

  // Consolidated summary
  const db = mongoose.connection.db!
  const [userCount, programCount, moduleCount, questionCount, bandCount, assignmentCount, attemptCount] =
    await Promise.all([
      db.collection('users-data').countDocuments(),
      db.collection('programs').countDocuments(),
      db.collection('modules').countDocuments(),
      db.collection('questions').countDocuments(),
      db.collection('scoreBands').countDocuments(),
      db.collection('moduleAssignments').countDocuments(),
      db.collection('moduleAttempts').countDocuments(),
    ])

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\n--- Seed complete in ${elapsed}s ---`)
  console.log('\nSummary:')
  console.log(`  Users:       ${userCount} (5 admins, 25 therapists, 60 patients)`)
  console.log(`  Programs:    ${programCount}`)
  console.log(`  Modules:     ${moduleCount}`)
  console.log(`  Questions:   ${questionCount}`)
  console.log(`  Score Bands: ${bandCount}`)
  console.log(`  Assignments: ${assignmentCount}`)
  console.log(`  Attempts:    ${attemptCount}`)
  console.log('\nExample credentials:')
  console.log('  patient1@test.com   / 12345678')
  console.log('  therapist1@test.com / 12345678')
  console.log('  admin1@test.com     / 12345678')
}

if (require.main === module) {
  ;(async () => {
    try {
      const { default: connectDB } = await import('../config/database')
      await connectDB()
      console.log('Connected to DB')
      await main()
      process.exit(0)
    } catch (err) {
      console.error('Seed failed:', err)
      process.exit(1)
    }
  })()
}
