// seeds/seedNewPrograms.ts
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

/** Upsert a non-questionnaire module (exercise/psychoeducation) */
async function upsertContentModule(opts: {
  programId: string
  title: string
  description: string
  type: 'psychoeducation' | 'exercise'
  accessPolicy: 'open' | 'assigned'
  disclaimer?: string
  imageUrl?: string
}) {
  const {
    programId,
    title,
    description,
    type,
    accessPolicy,
    disclaimer,
    imageUrl,
  } = opts
  const m = (await Module.findOneAndUpdate(
    { title, program: programId },
    {
      title,
      description,
      program: programId,
      type,
      accessPolicy,
      ...(disclaimer ? { disclaimer } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    },
    { upsert: true, new: true }
  )) as IModule
  console.log(`✅ Module created/updated (${title}):`, m._id)
  await ensureProgramHasModule(programId, String(m._id))
  return m
}

/** Upsert a questionnaire module with questions + bands */
async function upsertQuestionnaire(opts: {
  programId: string
  title: string
  description: string
  accessPolicy: 'open' | 'assigned'
  disclaimer: string
  imageUrl?: string
  questions: { text: string; choices: { text: string; score: number }[] }[]
  bands: { min: number; max: number; label: string; interpretation: string }[]
}) {
  const {
    programId,
    title,
    description,
    accessPolicy,
    disclaimer,
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
      accessPolicy,
      disclaimer,
      ...(imageUrl ? { imageUrl } : {}),
    },
    { upsert: true, new: true }
  )) as IModule
  console.log(`✅ Questionnaire created/updated (${title}):`, moduleDoc._id)
  await ensureProgramHasModule(programId, String(moduleDoc._id))

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
  console.log(`   └─ Questions count: ${qCount}`)

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
  console.log(`   └─ Score bands count: ${bCount}`)

  return moduleDoc
}

export async function seedNewPrograms() {
  // ===== Program A: Resilience & Coping =====
  const resilience = (await Program.findOneAndUpdate(
    { title: 'Resilience & Coping' },
    {
      title: 'Resilience & Coping',
      description: 'Build psychological flexibility and values-aligned action.',
    },
    { upsert: true, new: true }
  )) as IProgram
  console.log(
    '✅ Program created/updated (Resilience & Coping):',
    resilience._id
  )

  // 1) Resilience Snapshot (questionnaire, ASSIGNED)
  await upsertQuestionnaire({
    programId: String(resilience._id),
    title: 'Resilience Snapshot (6-item)',
    description: 'A brief self-check on resilience and bounce-back capacity.',
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
    // 6 items, 0–24
    bands: [
      {
        min: 0,
        max: 8,
        label: 'Low',
        interpretation: 'Consider structured coping support.',
      },
      {
        min: 9,
        max: 16,
        label: 'Moderate',
        interpretation: 'Keep practicing skills; consider coaching.',
      },
      {
        min: 17,
        max: 24,
        label: 'High',
        interpretation: 'Strong resilience; maintain helpful routines.',
      },
    ],
  })

  // 2) Values Clarification (exercise, ASSIGNED)
  await upsertContentModule({
    programId: String(resilience._id),
    title: 'Values Clarification',
    description:
      'Identify your core values across life domains and define small next actions.',
    type: 'exercise',
    accessPolicy: 'assigned', // therapist-directed
    disclaimer:
      'Coaching-style exercise. Not a substitute for therapy or crisis care.',
    imageUrl: 'https://placehold.co/600x400?text=Values+Clarification',
  })

  // ===== Program B: Sleep Health =====
  const sleep = (await Program.findOneAndUpdate(
    { title: 'Sleep Health' },
    {
      title: 'Sleep Health',
      description: 'Knowledge and routines for better sleep quality.',
    },
    { upsert: true, new: true }
  )) as IProgram
  console.log('✅ Program created/updated (Sleep Health):', sleep._id)

  // 3) Sleep Hygiene Basics (psychoeducation, OPEN)
  await upsertContentModule({
    programId: String(sleep._id),
    title: 'Sleep Hygiene Basics',
    description:
      'Learn practical sleep hygiene tips and when to seek further support.',
    type: 'psychoeducation',
    accessPolicy: 'open', // self-serve
    imageUrl: 'https://placehold.co/600x400?text=Sleep+Hygiene+Basics',
  })
}

if (require.main === module) {
  import('../config/database').then((connectDB) =>
    connectDB
      .default()
      .then(async () => {
        console.log('🔌 Connected to DB')
        await seedNewPrograms()
        console.log('✅ New programs seed complete')
        process.exit(0)
      })
      .catch((err) => {
        console.error('❌ DB connection or seeding failed:', err)
        process.exit(1)
      })
  )
}
