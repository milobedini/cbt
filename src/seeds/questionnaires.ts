// seeds/seedQuestionnaires.ts
import Module, { IModule } from '../models/moduleModel'
import Program, { IProgram } from '../models/programModel'
import Question from '../models/questionModel'
import ScoreBand from '../models/scoreBandModel'

/** Ensure a program has a module id in modules[] (no duplicates) */
async function ensureProgramHasModule(programId: string, moduleId: string) {
  const program = (await Program.findById(programId)) as IProgram | null
  if (!program) return
  const has = program.modules?.some(
    (m) => String((m as any)?._id ?? m) === String(moduleId)
  )
  if (!has) {
    await Program.findByIdAndUpdate(programId, {
      $addToSet: { modules: moduleId },
    })
    console.log('✅ Module added to program.modules[]:', moduleId)
  }
}

/** Upsert a questionnaire module, its questions and bands */
async function upsertQuestionnaire(opts: {
  programId: string
  title: string
  description: string
  disclaimer: string
  accessPolicy: 'open' | 'enrolled' | 'assigned' // NEW
  imageUrl?: string // optional, for nicer demo
  questions: { text: string; choices: { text: string; score: number }[] }[]
  bands: { min: number; max: number; label: string; interpretation: string }[]
}) {
  const {
    programId,
    title,
    description,
    disclaimer,
    accessPolicy,
    imageUrl,
    questions,
    bands,
  } = opts

  const moduleDoc = (await Module.findOneAndUpdate(
    { title, program: programId },
    {
      title,
      description,
      program: programId,
      type: 'questionnaire',
      disclaimer,
      accessPolicy, // 👈 NEW
      ...(imageUrl ? { imageUrl } : {}),
    },
    { upsert: true, new: true }
  )) as IModule

  console.log(`✅ Module created/updated (${title}):`, moduleDoc._id)
  await ensureProgramHasModule(programId as any, moduleDoc._id as any)

  await Promise.all(
    questions.map((q, i) =>
      Question.findOneAndUpdate(
        { module: moduleDoc._id, order: i + 1 },
        {
          module: moduleDoc._id,
          order: i + 1,
          text: q.text,
          choices: q.choices,
        },
        { upsert: true }
      )
    )
  )
  const qCount = await Question.countDocuments({ module: moduleDoc._id })
  console.log(`✅ ${title} questions count:`, qCount)

  await Promise.all(
    bands.map((b) =>
      ScoreBand.findOneAndUpdate(
        { module: moduleDoc._id, min: b.min },
        { module: moduleDoc._id, ...b },
        { upsert: true }
      )
    )
  )
  const bCount = await ScoreBand.countDocuments({ module: moduleDoc._id })
  console.log(`✅ ${title} score bands count:`, bCount)
}

/** Seed all (all under the Depression program, varied accessPolicy) */
export async function seedQuestionnaires() {
  // Single program for all modules
  const depression = (await Program.findOneAndUpdate(
    { title: 'Depression' },
    {
      title: 'Depression',
      description: 'Step-by-step CBT programme for low mood.',
    },
    { upsert: true, new: true }
  )) as IProgram
  console.log('✅ Program created/updated (Depression):', depression._id)

  // --- GAD-7 (Anxiety) 0–21  → ASSIGNED (therapist-directed)
  await upsertQuestionnaire({
    programId: depression._id as any,
    title: 'GAD-7',
    description: 'Generalized Anxiety Disorder 7-item (anxiety severity)',
    disclaimer:
      'This screener helps monitor anxiety but does not provide a diagnosis. If you are in crisis or feel unsafe, seek immediate support.',
    accessPolicy: 'assigned',
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
      {
        min: 0,
        max: 4,
        label: 'Minimal',
        interpretation: 'No or minimal anxiety',
      },
      {
        min: 5,
        max: 9,
        label: 'Mild',
        interpretation: 'Mild symptoms; monitor and consider self-help',
      },
      {
        min: 10,
        max: 14,
        label: 'Moderate',
        interpretation: 'Consider structured support (e.g., CBT)',
      },
      {
        min: 15,
        max: 21,
        label: 'Severe',
        interpretation: 'Active treatment recommended',
      },
    ],
  })

  // --- PSS-10 (Perceived Stress) 0–40 → OPEN (self-serve)
  await upsertQuestionnaire({
    programId: depression._id as any,
    title: 'PSS-10',
    description: 'Perceived Stress Scale (10-item)',
    disclaimer:
      'This scale measures how stressful you find your life. It is a self-report measure, not a diagnosis.',
    accessPolicy: 'open',
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
      {
        min: 14,
        max: 26,
        label: 'Moderate',
        interpretation: 'Moderate stress; consider coping skills',
      },
      {
        min: 27,
        max: 40,
        label: 'High',
        interpretation: 'High stress; consider structured support',
      },
    ],
  })

  // --- AUDIT-C (Alcohol use) 0–12 → ENROLLED (library but controlled)
  await upsertQuestionnaire({
    programId: depression._id as any,
    title: 'AUDIT-C',
    description: 'Alcohol Use Disorders Identification Test (Consumption)',
    disclaimer:
      'This screening tool provides an indicator of alcohol use risk. For medical advice, consult a clinician.',
    accessPolicy: 'enrolled',
    imageUrl: 'https://placehold.co/600x400?text=AUDIT-C',
    questions: [
      {
        text: 'How often do you have a drink containing alcohol?',
        choices: [
          { text: 'Never', score: 0 },
          { text: 'Monthly or less', score: 1 },
          { text: '2–4 times a month', score: 2 },
          { text: '2–3 times a week', score: 3 },
          { text: '4+ times a week', score: 4 },
        ],
      },
      {
        text: 'How many standard drinks do you have on a typical day when drinking?',
        choices: [
          { text: '1–2', score: 0 },
          { text: '3–4', score: 1 },
          { text: '5–6', score: 2 },
          { text: '7–9', score: 3 },
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
      {
        min: 0,
        max: 3,
        label: 'Low risk',
        interpretation: 'Alcohol use within lower-risk range',
      },
      {
        min: 4,
        max: 5,
        label: 'Medium risk',
        interpretation: 'Consider reducing intake',
      },
      {
        min: 6,
        max: 7,
        label: 'High risk',
        interpretation: 'Risky use; consider brief intervention',
      },
      {
        min: 8,
        max: 12,
        label: 'Very high risk',
        interpretation: 'Strongly consider clinical support',
      },
    ],
  })

  // --- ISI (Insomnia) 0–28 → ENROLLED (self-serve after enrolment)
  await upsertQuestionnaire({
    programId: depression._id as any,
    title: 'ISI',
    description: 'Insomnia Severity Index',
    disclaimer:
      'This tool estimates insomnia severity. It does not replace clinical evaluation. Seek help if symptoms persist.',
    accessPolicy: 'enrolled',
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
      {
        min: 0,
        max: 7,
        label: 'No clinically significant insomnia',
        interpretation: 'Maintain sleep hygiene',
      },
      {
        min: 8,
        max: 14,
        label: 'Subthreshold insomnia',
        interpretation: 'Consider behavioral sleep strategies',
      },
      {
        min: 15,
        max: 21,
        label: 'Moderate insomnia',
        interpretation: 'Structured intervention recommended',
      },
      {
        min: 22,
        max: 28,
        label: 'Severe insomnia',
        interpretation: 'Active treatment recommended',
      },
    ],
  })
}

if (require.main === module) {
  import('../config/database').then((connectDB) =>
    connectDB
      .default()
      .then(async () => {
        console.log('🔌 Connected to DB')
        await seedQuestionnaires()
        console.log('✅ Questionnaire seeds complete')
        process.exit(0)
      })
      .catch((err) => {
        console.error('❌ DB connection or seeding failed:', err)
        process.exit(1)
      })
  )
}
