// ----------------------------------
// Program + Module + Questionnaire Types
// ----------------------------------

export type Module = {
  _id: string
  title: string
  description: string
  program: Program
  type: 'questionnaire' | 'psychoeducation' | 'exercise'
  disclaimer?: string
  imageUrl?: string
  createdAt: string
  updatedAt: string
}

export type ProgramBase = {
  _id: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
}

export type Program = ProgramBase & {
  modules: string[]
}

export type ProgramWithModules = ProgramBase & {
  modules: Module[]
}

// ----------------------------------
// Questionnaires (PHQ‑9, GAD‑7, etc.)
// ----------------------------------

export type Choice = {
  text: string
  score: number
}

export type Question = {
  _id: string
  module: string // ObjectId reference
  order: number
  text: string
  choices: Choice[]
}

export type ScoreBand = {
  _id: string
  module: string // ObjectId reference
  min: number
  max: number
  label: string
  interpretation: string
}

// ----------------------------------
// Assessment (User submission)
// ----------------------------------

export type AssessmentAnswer = {
  question: string // question _id
  chosenScore: number
}

export type AssessmentResponse = {
  _id: string
  user: string
  program: string
  module: string
  answers: AssessmentAnswer[]
  totalScore: number
  weekStart: string // ISO date string (Monday)
  createdAt: string
  updatedAt: string
}

// ----------------------------------
// API Payloads
// ----------------------------------

// GET /programs/:id
export type ProgramResponse = {
  program: ProgramWithModules
}

// GET /programs
export type ProgramsResponse = {
  programs: Program[]
}

// GET /programs/:id/modules
export type ModulesResponse = {
  modules: Module[]
}

// GET /modules/:id
export type ModuleResponse = {
  module: Module
}

export type ModuleDetailResponse = {
  success: boolean
  module: Module
  questions: Question[]
  scoreBands: ScoreBand[]
}

// GET /modules/:id/questions
export type QuestionListResponse = {
  questions: Question[]
}

// GET /modules/:id/score-bands
export type ScoreBandListResponse = {
  scoreBands: ScoreBand[]
}

// POST /assessments
export type AssessmentSubmitInput = {
  moduleId: string
  answers: AssessmentAnswer[]
}

// Response after submitting assessment
export type AssessmentSubmitResponse = {
  totalScore: number
  scoreBand: string
  interpretation: string
  weekStart: string
}

// GET /assessments?moduleId=...
export type AssessmentHistoryResponse = {
  assessments: AssessmentResponse[]
}

// ----------------------------------
// Input types (admin/admin panel)
// ----------------------------------

export type CreateModuleInput = {
  title: string
  description: string
  type: 'questionnaire' | 'psychoeducation' | 'exercise'
  program: string
  disclaimer?: string
  imageUrl?: string
}

export type CreateQuestionInput = {
  moduleId: string
  text: string
  order: number
  choices: Choice[]
}

export type CreateScoreBandInput = {
  moduleId: string
  min: number
  max: number
  label: string
  interpretation: string
}

export type EnrolInput = {
  patientId: string
  moduleId: string
}

export type EnrolResponse = {
  success: boolean
  message: string
}
