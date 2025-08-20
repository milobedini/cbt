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

// New
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
  name?: string
  roles: UserRole[]
  isVerifiedTherapist: boolean
  patients: string[]
  therapist: User | null
}

export type VerifyTherapistInput = {
  therapistId: string
}

export type VerifyTherapistResponse = {
  message: string
  therapist: AuthUser
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

export type ProgramRef = Pick<Program, '_id' | 'title' | 'description'>

export type ModuleType = 'questionnaire' | 'psychoeducation' | 'exercise'

export type Module = {
  _id: string
  title: string
  description: string
  program: ProgramRef // populated in detail route
  type: ModuleType
  disclaimer?: string
  imageUrl?: string
  createdAt: string
  updatedAt: string
  enrolled?: string[] // user ids (if you keep this)
  accessPolicy: 'open' | 'enrolled' | 'assigned'
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
  chosenIndex?: number // NEW
  chosenText?: string // NEW
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
  module: {
    _id: string
    title: string
  }
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
  | 'iteration'
  | 'status'
  | 'totalScore'
  | 'scoreBandLabel'
  | 'band'
  | 'weekStart'
  | 'completedAt'
  | 'startedAt'
  | 'lastInteractionAt'
  | 'dueAt'
  | 'userNote'
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

export type ModulesPlainResponse = { success: boolean; modules: Module[] }
export type ModulesWithMetaResponse = {
  success: boolean
  modules: AvailableModulesItem[]
}
export type ModulesResponse = ModulesPlainResponse | ModulesWithMetaResponse

export type ModuleResponse = { success: boolean; module: Module }

export type ModuleDetailResponse = {
  success: boolean
  module: Module
  questions: Question[]
  scoreBands: ScoreBand[]
  meta?: {
    canStart?: boolean
    canStartReason?:
      | 'ok'
      | 'not_enrolled'
      | 'requires_assignment'
      | 'unauthenticated'
    activeAssignmentId?: string
  }
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
  status?: 'submitted' | 'active'
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
export type TherapistUserPreview = Pick<
  AuthUser,
  '_id' | 'username' | 'email' | 'name'
>
export type TherapistModulePreview = Pick<Module, '_id' | 'title'>

export type TherapistLatestRow = {
  _id: string
  user: TherapistUserPreview
  module: TherapistModulePreview

  // fields from the latest attempt (flattened)
  iteration?: number
  completedAt?: string
  totalScore?: number
  scoreBandLabel?: string
  weekStart?: string
  band?: ScoreBandSummary
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
  accessPolicy?: 'open' | 'enrolled' | 'assigned'
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

export type AvailableSourceTag = 'open' | 'enrolled' | 'assigned'

export type AvailableModulesItem = {
  module: Module
  meta: {
    // unauthenticated, non-open can be undefined
    canStart: boolean | undefined
    // unauthenticated can appear (esp. when user not logged in)
    canStartReason:
      | 'ok'
      | 'not_enrolled'
      | 'requires_assignment'
      | 'unauthenticated'
    source: AvailableSourceTag[]
    activeAssignmentId?: string
    assignmentStatus?: 'assigned' | 'in_progress'
    dueAt?: string
  }
}

export type AvailableModulesResponse = {
  success: boolean
  modules: AvailableModulesItem[]
}

export type AssignmentLatestAttemptPreview = {
  _id: string
  completedAt?: string
  totalScore?: number
  scoreBandLabel?: string
}

export type ModulePreviewForAssignment = Pick<
  Module,
  '_id' | 'title' | 'type' | 'accessPolicy'
> & { program?: never } // prevent confusion—program is provided separately

export type ProgramPreviewForAssignment = Pick<Program, '_id' | 'title'>

export type MyAssignmentView = {
  _id: string
  user: {
    _id: string
    name: string
    username: string
  }
  therapist: {
    _id: string
    name: string
  }
  status: AssignmentStatus
  dueAt?: string
  recurrence?: AssignmentRecurrence
  notes?: string
  module: ModulePreviewForAssignment
  program: ProgramPreviewForAssignment
  latestAttempt?: AssignmentLatestAttemptPreview
  createdAt: string
  updatedAt: string
}

export type MyAssignmentsResponse = {
  success: boolean
  assignments: MyAssignmentView[]
}

export type ModulesQuery = {
  program?: string
  withMeta?: boolean | string // server treats presence/truthy values as true
}

export type AdminStats = {
  totalUsers: number
  totalTherapists: number
  totalPatients: number
  unverifiedTherapists: AuthUser[]
  completedAttempts: number
}

export type AttemptDetailItem = {
  order: number
  questionId: string
  questionText: string
  choices: Choice[] // [{ text, score }]
  chosenScore?: number | null
  chosenIndex?: number | null
  chosenText?: string | null
}

export type AttemptDetail = {
  items: AttemptDetailItem[]
  answeredCount: number
  totalQuestions: number
  percentComplete: number
}

export type AttemptDetailResponseItem = ModuleAttempt & {
  band?: ScoreBandSummary
  detail: AttemptDetail // <-- add this
  patient?: Pick<AuthUser, '_id' | 'name' | 'username' | 'email'>
  module?: Pick<Module, '_id' | 'title' | 'type'>
}

export type AttemptDetailResponse = {
  success: boolean
  attempt: AttemptDetailResponseItem
}

export type MongoId = string

export type TherapistPreview = Pick<User, '_id' | 'username' | 'email' | 'name'>

export type UsersSort = `${string}:${'asc' | 'desc'}` | string
// Server supports multi-field via comma: "lastLogin:desc,name:asc"
export type UsersSortMulti =
  | UsersSort
  | `${UsersSort},${UsersSort}`
  | `${UsersSort},${UsersSort},${string}`

export type GetUsersQuery = {
  page?: number
  limit?: number
  q?: string

  // Filters (server accepts csv strings or arrays; booleans can be "true"/"false")
  roles?: UserRole[] | string
  ids?: string[] | string
  isVerified?: boolean | string
  isVerifiedTherapist?: boolean | string
  hasTherapist?: boolean | string
  therapistId?: string

  // Date ranges (ISO strings)
  createdFrom?: string
  createdTo?: string
  lastLoginFrom?: string
  lastLoginTo?: string

  // Sorting & field selection
  sort?: UsersSortMulti
  select?: string[] | string
}

export type UsersListItem = {
  _id: MongoId
  username: string
  email: string
  name?: string
  roles: UserRole[]

  // Verification flags
  isVerified?: boolean
  isVerifiedTherapist?: boolean

  // Relations
  therapist?: MongoId | null
  // Present only if requested via `select` (controller can project this)
  therapistInfo?: TherapistPreview | null
  // Returned as ids by default (you can change server proj to a count if preferred)
  patients?: MongoId[]

  // Timestamps
  createdAt: string
  updatedAt: string
  lastLogin?: string
}

export type FacetCount<T = string | boolean | null> = {
  _id: T
  count: number
}

export type UsersFacets = {
  roles: FacetCount<UserRole>[]
  isVerified: FacetCount<boolean>[]
  isVerifiedTherapist: FacetCount<boolean>[]
  hasTherapist: FacetCount<boolean>[]
}

export type GetUsersResponse = {
  page: number
  limit: number
  total: number
  totalPages: number
  items: UsersListItem[]
  facets: UsersFacets
}
