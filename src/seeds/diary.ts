import Module, { IModule } from '../models/moduleModel'
import Program, { IProgram } from '../models/programModel'

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

export async function seedActivityDiary() {
  // 1) Upsert the "Depression" program (re-use existing if present)
  const depression = (await Program.findOneAndUpdate(
    { title: 'Depression' },
    {
      title: 'Depression',
      description: 'Step-by-step CBT programme for low mood.',
    },
    { upsert: true, new: true }
  )) as IProgram
  console.log('✅ Program created/updated (Depression):', depression._id)

  // 2) Upsert the Activity Diary module
  //    - No questions, no score bands
  //    - Access policy: choose 'assigned' (therapist-led) or 'open' (self-serve)
  const activityDiary = (await Module.findOneAndUpdate(
    { title: 'Activity Diary', program: depression._id },
    {
      title: 'Activity Diary',
      description:
        'Track your activities through the day alongside mood, achievement, closeness and enjoyment.',
      program: depression._id,
      type: 'activity_diary',
      accessPolicy: 'assigned', // change to 'open' if you want self-start
      disclaimer:
        'This diary is for self-monitoring and does not replace professional care. If you feel unsafe, seek immediate help.',
      imageUrl: 'https://placehold.co/600x400?text=Activity+Diary', // optional
    },
    { upsert: true, new: true }
  )) as IModule
  console.log('✅ Activity Diary module created/updated:', activityDiary._id)

  // 3) Ensure module is listed on the program
  await ensureProgramHasModule(depression._id as any, activityDiary._id as any)
  console.log('✅ Activity Diary added to Depression program')
}

if (require.main === module) {
  // Standalone runner: ts-node seeds/diary.ts
  import('../config/database').then((connectDB) =>
    connectDB
      .default()
      .then(async () => {
        console.log('🔌 Connected to DB')
        await seedActivityDiary()
        console.log('✅ Activity Diary seed complete')
        process.exit(0)
      })
      .catch((err) => {
        console.error('❌ DB connection or seeding failed:', err)
        process.exit(1)
      })
  )
}
