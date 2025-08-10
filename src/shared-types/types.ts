export type ApiError = {
  data: {
    message: string
  }
}

// ==================================
// Users & Auth
// ==================================
export type User = {
  _id: string
  username: string
  email: string
  name?: string
}

export type UserRole = 'therapist' | 'admin' | 'patient'

export type AuthUser = User & {
  roles: UserRole[]
  isVerifiedTherapist?: boolean
  patients?: string[] // patient _ids
  therapist?: string // therapist _id
}

export type AuthResponse = {
  success: boolean
  message: string
  user: AuthUser
}

export type RegisterInput = {
  username: string
  email: string
  password: string
  roles: UserRole[] // if backend allows passing this
}

export type LoginInput = {
  identifier: string // email or username
  password: string
}

export type UpdateNameInput = {
  newName: string
  userId: string
}

export type VerifyInput = { verificationCode: string }

export type PatientsResponse = AuthUser[]

export type AddRemoveTherapistInput = {
  therapistId: string
  patientId: string
}

export type AddRemoveTherapistResponse = {
  message: string
  patient: AuthUser
  therapistPatients: string[] // patient ids on therapist
}

export type ProfileResponse = {
  _id: string
  username: string
  email: string
  roles: UserRole[]
  isVerifiedTherapist: boolean
  patients: string[]
  therapist: User | null
}

// ==================================
// Program & Module
// ==================================
export type ProgramBase = {
  _id: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
}

export type Program = ProgramBase & {
  modules: string[] // module ids
}

export type ProgramWithModules = ProgramBase & {
  modules: Module[]
}

export type ModuleType = 'questionnaire' | 'psychoeducation' | 'exercise'

export type Module = {
  _id: string
  title: string
  description: string
  program: Program // populated in detail route
  type: ModuleType
  disclaimer?: string
  imageUrl?: string
  createdAt: string
  updatedAt: string
  enrolled?: string[] // user ids (if you keep this)
}

// ==================================
// Questionnaire authoring
// ==================================
export type Choice = { text: string; score: number }

export type Question = {
  _id: string
  module: string
  order: number
  text: string
  choices: Choice[]
}

export type ScoreBand = {
  _id: string
  module: string
  min: number
  max: number
  label: string
  interpretation: string
}

// For join-at-read results (no schema change)
export type ScoreBandSummary = {
  _id: string
  label: string
  interpretation: string
  min: number
  max: number
}

// ==================================
// Attempts (user runs of a module)
// ==================================
export type AttemptStatus = 'started' | 'submitted' | 'abandoned'

export type AttemptAnswer = {
  question: string // question _id
  chosenScore: number
}

export type ModuleSnapshotQuestion = {
  _id: string
  text: string
  choices: Choice[]
}

export type ModuleSnapshot = {
  title: string
  disclaimer?: string
  questions?: ModuleSnapshotQuestion[]
}

export type ModuleAttempt = {
  _id: string
  user: string
  therapist?: string
  program: string
  module: string
  moduleType: ModuleType

  status: AttemptStatus
  startedAt: string
  completedAt?: string
  lastInteractionAt: string
  durationSecs?: number
  iteration?: number
  dueAt?: string

  answers?: AttemptAnswer[]
  totalScore?: number
  scoreBandLabel?: string
  // When using Option B (join at read-time), aggregations add this:
  band?: ScoreBandSummary

  weekStart?: string // ISO (computed in Europe/London, stored UTC)
  contentVersion?: number
  moduleSnapshot?: ModuleSnapshot

  userNote?: string
  therapistNote?: string
  createdAt: string
  updatedAt: string
}

// Light list item (what most list endpoints actually return)
export type AttemptListItem = Pick<
  ModuleAttempt,
  | '_id'
  | 'module'
  | 'program'
  | 'moduleType'
  | 'totalScore'
  | 'scoreBandLabel'
  | 'band'
  | 'weekStart'
  | 'completedAt'
  | 'iteration'
>

// ==================================
// Assignments (optional feature)
// ==================================
export type AssignmentStatus =
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
export type AssignmentRecurrence = {
  freq: 'weekly' | 'monthly' | 'none'
  interval?: number
}

export type ModuleAssignment = {
  _id: string
  user: string
  therapist: string
  program: string
  module: string
  moduleType: ModuleType
  status: AssignmentStatus
  dueAt?: string
  recurrence?: AssignmentRecurrence
  latestAttempt?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

// ==================================
// API: Programs & Modules
// ==================================
export type ProgramResponse = { program: ProgramWithModules }
export type ProgramsResponse = { programs: Program[] }

export type ModulesResponse = { success: boolean; modules: Module[] }
export type ModuleResponse = { success: boolean; module: Module }

export type ModuleDetailResponse = {
  success: boolean
  module: Module
  questions: Question[]
  scoreBands: ScoreBand[]
}

// ==================================
// API: Attempts
// ==================================
export type StartAttemptResponse = { success: boolean; attempt: ModuleAttempt }

export type SaveProgressInput = {
  answers?: AttemptAnswer[]
  userNote?: string
}
export type SaveProgressResponse = { success: boolean; attempt: ModuleAttempt }

export type SubmitAttemptInput = { assignmentId?: string }
export type SubmitAttemptResponse = { success: boolean; attempt: ModuleAttempt }

// Cursor can be an ISO string (current impl) or an object if you adopt a 2-field cursor
export type Cursor = string | { completedAt: string; id: string }

export type MyAttemptsQuery = {
  moduleId?: string
  limit?: number
  cursor?: Cursor
}

export type MyAttemptsResponse = {
  success: boolean
  attempts: AttemptListItem[]
  // current controller returns ISO string or null
  nextCursor: string | null
}

// ==================================
// API: Therapist views (join at read-time)
// ==================================
export type TherapistUserPreview = Pick<AuthUser, '_id' | 'username' | 'email'>
export type TherapistModulePreview = Pick<Module, '_id' | 'title'>

export type TherapistLatestRow = {
  user: TherapistUserPreview
  module: TherapistModulePreview
  // lastAttempt includes band (ScoreBandSummary) via $lookup
  lastAttempt: AttemptListItem & { band?: ScoreBandSummary }
}

export type TherapistLatestResponse = {
  success: boolean
  rows: TherapistLatestRow[]
}

export type PatientModuleTimelineResponse = {
  success: boolean
  attempts: (AttemptListItem & { band?: ScoreBandSummary })[]
}

// ==================================
// API: Assignments (optional)
// ==================================
export type CreateAssignmentInput = {
  userId: string
  moduleId: string
  dueAt?: string
  notes?: string
  recurrence?: AssignmentRecurrence
}
export type CreateAssignmentResponse = {
  success: boolean
  assignment: ModuleAssignment
}

export type ListAssignmentsResponse = {
  success: boolean
  assignments: ModuleAssignment[]
}

export type UpdateAssignmentStatusInput = { status: AssignmentStatus }
export type UpdateAssignmentStatusResponse = {
  success: boolean
  assignment: ModuleAssignment
}

// ==================================
// Admin authoring inputs
// ==================================
export type CreateModuleInput = {
  title: string
  description: string
  type: ModuleType
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

export type EnrolInput = { patientId: string; moduleId: string }
export type EnrolResponse = { success: boolean; message: string }
