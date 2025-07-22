// ----------------------------------
// Program + Module + Questionnaire Types
// ----------------------------------

export interface Module {
  _id: string
  title: string
  description: string
  program: string // ObjectId reference
  type: 'questionnaire' | 'psychoeducation' | 'exercise'
  disclaimer?: string
  imageUrl?: string
  createdAt: string
  updatedAt: string
}

export interface Program {
  _id: string
  title: string
  description: string
  modules: string[] // can be populated or just IDs
  createdAt: string
  updatedAt: string
}

// ----------------------------------
// Questionnaires (PHQ‑9, GAD‑7, etc.)
// ----------------------------------

export interface Choice {
  text: string
  score: number
}

export interface Question {
  _id: string
  module: string // ObjectId reference
  order: number
  text: string
  choices: Choice[]
}

export interface ScoreBand {
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

export interface AssessmentAnswer {
  question: string // question _id
  chosenScore: number
}

export interface AssessmentResponse {
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
export interface ProgramResponse {
  program: Program
}

// GET /programs
export interface ProgramsResponse {
  programs: Program[]
}

// GET /programs/:id/modules
export interface ModulesResponse {
  modules: Module[]
}

// GET /modules/:id
export interface ModuleResponse {
  module: Module
}

// GET /modules/:id/questions
export interface QuestionListResponse {
  questions: Question[]
}

// GET /modules/:id/score-bands
export interface ScoreBandListResponse {
  scoreBands: ScoreBand[]
}

// POST /assessments
export interface AssessmentSubmitInput {
  moduleId: string
  answers: AssessmentAnswer[]
}

// Response after submitting assessment
export interface AssessmentSubmitResponse {
  totalScore: number
  scoreBand: string
  interpretation: string
  weekStart: string
}

// GET /assessments?moduleId=...
export interface AssessmentHistoryResponse {
  assessments: AssessmentResponse[]
}

// ----------------------------------
// Input types (admin/admin panel)
// ----------------------------------

export interface CreateModuleInput {
  title: string
  description: string
  type: 'questionnaire' | 'psychoeducation' | 'exercise'
  program: string
  disclaimer?: string
  imageUrl?: string
}

export interface CreateQuestionInput {
  moduleId: string
  text: string
  order: number
  choices: Choice[]
}

export interface CreateScoreBandInput {
  moduleId: string
  min: number
  max: number
  label: string
  interpretation: string
}
