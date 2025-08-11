import Module, { IModule } from '../models/moduleModel'
import Program, { IProgram } from '../models/programModel'
import Question from '../models/questionModel'
import ScoreBand from '../models/scoreBandModel'

export async function seedPhq9() {
  // 1) Program
  const program = (await Program.findOneAndUpdate(
    { title: 'Depression' },
    {
      title: 'Depression',
      description: 'Step-by-step CBT programme for low mood.',
    },
    { upsert: true, new: true }
  )) as IProgram
  console.log('✅ Program created/updated:', program._id)

  // 2) PHQ-9 module (accessPolicy: enrolled)
  const phq9 = (await Module.findOneAndUpdate(
    { title: 'PHQ-9', program: program._id },
    {
      title: 'PHQ-9',
      description: 'Patient Health Questionnaire-9 (depression severity)',
      program: program._id,
      type: 'questionnaire',
      accessPolicy: 'enrolled',
      disclaimer:
        'The PHQ-9 is a screening tool and does **not** replace professional diagnosis. ' +
        'If you have thoughts of self-harm, seek help immediately.',
    },
    { upsert: true, new: true }
  )) as IModule
  console.log('✅ Module created/updated:', phq9._id)

  // Always safe with $addToSet (dedup)
  await Program.findByIdAndUpdate(program._id, {
    $addToSet: { modules: phq9._id },
  })
  console.log('✅ PHQ-9 added to program.modules[] (dedup)')

  // 3) Questions
  const phqText = [
    'Little interest or pleasure in doing things',
    'Feeling down, depressed, or hopeless',
    'Trouble falling or staying asleep, or sleeping too much',
    'Feeling tired or having little energy',
    'Poor appetite or overeating',
    'Feeling bad about yourself — or that you are a failure or have let yourself or your family down',
    'Trouble concentrating on things, such as reading the newspaper or watching television',
    'Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual',
    'Thoughts that you would be better off dead, or of hurting yourself in some way',
  ]
  const defaultChoices = [
    { text: 'Not at all', score: 0 },
    { text: 'Several days', score: 1 },
    { text: 'More than half the days', score: 2 },
    { text: 'Nearly every day', score: 3 },
  ]
  await Promise.all(
    phqText.map((text, i) =>
      Question.findOneAndUpdate(
        { module: phq9._id, order: i + 1 },
        { module: phq9._id, order: i + 1, text, choices: defaultChoices },
        { upsert: true }
      )
    )
  )
  const questions = await Question.find({ module: phq9._id })
  console.log(`✅ PHQ-9 questions count: ${questions.length}`)

  // 4) Score bands (0-27)
  const bands = [
    {
      min: 0,
      max: 4,
      label: 'Minimal',
      interpretation: 'No or minimal depression',
    },
    {
      min: 5,
      max: 9,
      label: 'Mild',
      interpretation: 'Watchful waiting; repeat soon',
    },
    {
      min: 10,
      max: 14,
      label: 'Moderate',
      interpretation: 'Consider counselling or CBT',
    },
    {
      min: 15,
      max: 19,
      label: 'Moderately severe',
      interpretation: 'Active treatment recommended',
    },
    {
      min: 20,
      max: 27,
      label: 'Severe',
      interpretation: 'Immediate intensive treatment',
    },
  ]
  await Promise.all(
    bands.map((b) =>
      ScoreBand.findOneAndUpdate(
        { module: phq9._id, min: b.min },
        { module: phq9._id, ...b },
        { upsert: true }
      )
    )
  )
  const bandsCreated = await ScoreBand.find({ module: phq9._id })
  console.log(`✅ PHQ-9 bands count: ${bandsCreated.length}`)
}

if (require.main === module) {
  import('../config/database').then((connectDB) =>
    connectDB
      .default()
      .then(async () => {
        console.log('🔌 Connected to DB')
        await seedPhq9()
        console.log('✅ PHQ-9 seed complete')
        process.exit(0)
      })
      .catch((err) => {
        console.error('❌ DB connection or seeding failed:', err)
        process.exit(1)
      })
  )
}
