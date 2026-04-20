export type ApiError = {
  data: {
    message: string;
  };
};

// ==================================
// Users & Auth
// ==================================
export type User = {
  _id: string;
  username: string;
  email: string;
  name?: string;
};

export type UserRole = "therapist" | "admin" | "patient";

export type AuthUser = User & {
  roles: UserRole[];
  isVerifiedTherapist?: boolean;
  therapistTier?: TherapistTier;
  patients?: string[]; // patient _ids
  therapist?: string; // therapist _id
};

export type AuthResponse = {
  success: boolean;
  message: string;
  user: AuthUser;
};

export type RegisterInput = {
  username: string;
  email: string;
  password: string;
  roles: UserRole[]; // if backend allows passing this
};

export type LoginInput = {
  identifier: string; // email or username
  password: string;
};

// New
export type UpdateNameInput = {
  newName: string;
  userId: string;
};

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

export type VerifyInput = { verificationCode: string };

export type PatientsResponse = AuthUser[];

export type AddRemoveTherapistInput = {
  therapistId: string;
  patientId: string;
};

export type AddRemoveTherapistResponse = {
  message: string;
  patient: AuthUser;
  therapistPatients: string[]; // patient ids on therapist
};

export type ProfileResponse = {
  _id: string;
  username: string;
  email: string;
  name?: string;
  roles: UserRole[];
  isVerifiedTherapist: boolean;
  patients: string[];
  therapist: (User & { isVerifiedTherapist?: boolean }) | null;
  createdAt: string;
};

export type VerifyTherapistInput = {
  therapistId: string;
  therapistTier: TherapistTier;
};

export type VerifyTherapistResponse = {
  message: string;
  therapist: AuthUser;
};

export type UnverifyTherapistInput = {
  therapistId: string;
};

export type UnverifyTherapistResponse = {
  message: string;
  therapist: AuthUser;
};

// ==================================
// Program & Module
// ==================================
export type ProgramBase = {
  _id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type Program = ProgramBase & {
  modules: string[]; // module ids
};

export type ProgramWithModules = ProgramBase & {
  modules: Module[];
};

export type ProgramRef = Pick<Program, "_id" | "title" | "description">;

export type ModuleType =
  | "questionnaire"
  | "reading"
  | "activity_diary"
  | "five_areas_model"
  | "general_goals"
  | "weekly_goals";

export type FiveAreasData = {
  situation: string;
  thoughts: string;
  emotions: string;
  behaviours: string;
  physical: string;
  reflection: string;
};

export type GeneralGoalEntry = {
  goalText: string;
  rating: number | null;
};

export type PreviousRating = {
  date: string;
  ratings: number[];
};

export type GeneralGoalsData = {
  goals: GeneralGoalEntry[];
  reflection: string;
  isReRating: boolean;
  previousRatings: PreviousRating[];
};

export type WeeklyGoalPlannedDiaryRef = {
  at: string; // ISO datetime
  label?: string;
};

export type WeeklyGoalEntry = {
  goalText: string;
  completed: boolean;
  masteryRating: number | null;
  pleasureRating: number | null;
  plannedDiaryEntryRef: WeeklyGoalPlannedDiaryRef | null;
  completionNotes: string | null;
};

export type WeeklyGoalsReflection = {
  moodImpact: string;
  takeaway: string;
  balance: string;
  barriers: string;
};

export type WeeklyGoalsData = {
  goals: WeeklyGoalEntry[];
  reflection: WeeklyGoalsReflection;
};

export type Module = {
  _id: string;
  title: string;
  description: string;
  program: ProgramRef; // populated in detail route
  type: ModuleType;
  disclaimer?: string;
  imageUrl?: string;
  content?: string; // markdown body for reading modules
  createdAt: string;
  updatedAt: string;
  accessPolicy: "open" | "assigned";
  // Admin v1 additions
  instrument?: Instrument;
  clinicalCutoff?: number;
  reliableChangeDelta?: number;
};

// ==================================
// Questionnaire authoring
// ==================================
export type Choice = { text: string; score: number };

export type Question = {
  _id: string;
  module: string;
  order: number;
  text: string;
  choices: Choice[];
};

export type ScoreBand = {
  _id: string;
  module: string;
  min: number;
  max: number;
  label: string;
  interpretation: string;
};

// For join-at-read results (no schema change)
export type ScoreBandSummary = {
  _id: string;
  label: string;
  interpretation: string;
  min: number;
  max: number;
};

// ==================================
// Attempts (user runs of a module)
// ==================================
export type AttemptStatus = "started" | "submitted" | "abandoned";

export type AttemptAnswer = {
  question: string; // question _id
  chosenScore: number;
  chosenIndex?: number; // NEW
  chosenText?: string; // NEW
};

export type ModuleSnapshotQuestion = {
  _id: string;
  text: string;
  choices: Choice[];
};

export type ModuleSnapshot = {
  title: string;
  disclaimer?: string;
  content?: string; // preserved for reading modules
  questions?: ModuleSnapshotQuestion[];
};

export type ModuleAttempt = {
  _id: string;
  user: string;
  therapist?: string;
  program: string;
  module: {
    _id: string;
    title: string;
  };
  moduleType: ModuleType;

  status: AttemptStatus;
  startedAt: string;
  completedAt?: string;
  lastInteractionAt: string;
  durationSecs?: number;
  iteration?: number;
  dueAt?: string;

  answers?: AttemptAnswer[];
  totalScore?: number;
  scoreBandLabel?: string;
  // When using Option B (join at read-time), aggregations add this:
  band?: ScoreBandSummary;

  weekStart?: string; // ISO (computed in Europe/London, stored UTC)
  contentVersion?: number;
  moduleSnapshot?: ModuleSnapshot;

  userNote?: string;
  therapistNote?: string;
  readerNote?: string;
  fiveAreas?: FiveAreasData;
  generalGoals?: GeneralGoalsData;
  weeklyGoals?: WeeklyGoalsData;
  createdAt: string;
  updatedAt: string;
};

// Light list item (what most list endpoints actually return)
export type AttemptListItem = Pick<
  ModuleAttempt,
  | "_id"
  | "module"
  | "program"
  | "moduleType"
  | "iteration"
  | "status"
  | "totalScore"
  | "scoreBandLabel"
  | "band"
  | "weekStart"
  | "completedAt"
  | "startedAt"
  | "lastInteractionAt"
  | "dueAt"
  | "userNote"
> & {
  percentComplete?: number;
};

// ==================================
// Assignments (optional feature)
// ==================================
export type AssignmentStatus =
  | "assigned"
  | "in_progress"
  | "completed"
  | "cancelled";
export type AssignmentRecurrence = {
  freq: "weekly" | "monthly" | "none";
  interval?: number;
};
export type AssignmentSource = "therapist" | "self";

export type ModuleAssignment = {
  _id: string;
  user: string;
  therapist?: string; // null for self-initiated
  program: string;
  module: string;
  moduleType: ModuleType;
  status: AssignmentStatus;
  source: AssignmentSource;
  dueAt?: string;
  recurrence?: AssignmentRecurrence;
  recurrenceGroupId?: string;
  latestAttempt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

// ==================================
// API: Programs & Modules
// ==================================
export type ProgramResponse = { program: ProgramWithModules };
export type ProgramsResponse = { programs: Program[] };

export type ModulesPlainResponse = { success: boolean; modules: Module[] };
export type ModulesWithMetaResponse = {
  success: boolean;
  modules: AvailableModulesItem[];
};
export type ModulesResponse = ModulesPlainResponse | ModulesWithMetaResponse;

export type ModuleResponse = { success: boolean; module: Module };

export type ModuleDetailResponse = {
  success: boolean;
  module: Module;
  questions: Question[];
  scoreBands: ScoreBand[];
  meta?: {
    canStart?: boolean;
    canStartReason?: "ok" | "requires_assignment" | "unauthenticated";
    activeAssignmentId?: string;
  };
};

// ==================================
// API: Attempts
// ==================================
export type StartAttemptResponse = { success: boolean; attempt: ModuleAttempt };

export type SaveProgressInput = {
  // questionnaire
  answers?: AttemptAnswer[];
  // diary
  diaryEntries?: DiaryEntryInput[];
  merge?: boolean;
  // reading
  readerNote?: string;
  // five areas model
  fiveAreas?: Partial<FiveAreasData>;
  // general goals
  generalGoals?: Partial<GeneralGoalsData>;
  // weekly goals
  weeklyGoals?: Partial<{
    goals: Array<Partial<WeeklyGoalEntry>>;
    reflection: Partial<WeeklyGoalsReflection>;
  }>;
  // common
  userNote?: string;
};
export type SaveProgressResponse = { success: boolean; attempt: ModuleAttempt };

export type SubmitAttemptInput = { assignmentId?: string; readerNote?: string };
export type SubmitAttemptResponse = {
  success: boolean;
  attempt: ModuleAttempt;
};

// Cursor can be an ISO string (current impl) or an object if you adopt a 2-field cursor
export type Cursor = string | { completedAt: string; id: string };

export type MyAttemptsQuery = {
  moduleId?: string;
  limit?: number;
  cursor?: Cursor;
  status?: "submitted" | "active";
};

export type MyAttemptsResponse = {
  success: boolean;
  attempts: AttemptListItem[];
  // current controller returns ISO string or null
  nextCursor: string | null;
};

// ==================================
// API: Therapist views (join at read-time)
// ==================================
export type TherapistUserPreview = Pick<
  AuthUser,
  "_id" | "username" | "email" | "name"
>;
export type TherapistModulePreview = Pick<Module, "_id" | "title">;

export type TherapistLatestRow = {
  _id: string;
  user: TherapistUserPreview;
  module: TherapistModulePreview;

  // fields from the latest attempt (flattened)
  moduleType?: ModuleType;
  iteration?: number;
  completedAt?: string;
  totalScore?: number;
  scoreBandLabel?: string;
  weekStart?: string;
  band?: ScoreBandSummary;

  percentComplete?: number;
};

export type TherapistLatestResponse = {
  success: boolean;
  rows: TherapistLatestRow[];
  nextCursor: string | null;
  totalCount: number;
};

export type SeverityOption = "severe" | "moderate" | "mild";
export type SortOption = "newest" | "oldest" | "severity";

export type TherapistLatestFilters = {
  patientId?: string;
  moduleId?: string;
  severity?: SeverityOption;
  status?: string;
  sort?: SortOption;
  limit?: number;
};

export type TherapistAttemptModule = {
  _id: string;
  title: string;
  moduleType: ModuleType;
};

export type TherapistAttemptModulesResponse = {
  success: boolean;
  modules: TherapistAttemptModule[];
};

// ==================================
// API: Assignments (optional)
// ==================================
export type CreateAssignmentInput = {
  userId: string;
  moduleId: string;
  dueAt?: string;
  notes?: string;
  recurrence?: AssignmentRecurrence;
};
export type CreateAssignmentResponse = {
  success: boolean;
  assignment: ModuleAssignment;
};

export type ListAssignmentsResponse = {
  success: boolean;
  assignments: ModuleAssignment[];
};

export type UpdateAssignmentStatusInput = { status: AssignmentStatus };
export type UpdateAssignmentStatusResponse = {
  success: boolean;
  assignment: ModuleAssignment;
};

// ==================================
// Admin authoring inputs
// ==================================
export type CreateModuleInput = {
  title: string;
  description: string;
  type: ModuleType;
  program: string;
  disclaimer?: string;
  imageUrl?: string;
  content?: string;
  accessPolicy?: "open" | "assigned";
};

export type CreateQuestionInput = {
  moduleId: string;
  text: string;
  order: number;
  choices: Choice[];
};

export type CreateScoreBandInput = {
  moduleId: string;
  min: number;
  max: number;
  label: string;
  interpretation: string;
};

export type AvailableSourceTag = "open" | "assigned";

export type AvailableModulesItem = {
  module: Module;
  meta: {
    // unauthenticated, non-open can be undefined
    canStart: boolean | undefined;
    // unauthenticated can appear (esp. when user not logged in)
    canStartReason: "ok" | "requires_assignment" | "unauthenticated";
    source: AvailableSourceTag[];
    activeAssignmentId?: string;
    assignmentStatus?: "assigned" | "in_progress";
    dueAt?: string;
  };
};

export type AvailableModulesResponse = {
  success: boolean;
  modules: AvailableModulesItem[];
};

export type AssignmentLatestAttemptPreview = {
  _id: string;
  completedAt?: string;
  totalScore?: number;
  scoreBandLabel?: string;
  percentComplete?: number;
};

export type ModulePreviewForAssignment = Pick<
  Module,
  "_id" | "title" | "type" | "accessPolicy"
> & { program?: never }; // prevent confusion—program is provided separately

export type ProgramPreviewForAssignment = Pick<Program, "_id" | "title">;

export type MyAssignmentView = {
  _id: string;
  user: {
    _id: string;
    name: string;
    username: string;
  };
  therapist: {
    _id: string;
    name: string;
  };
  status: AssignmentStatus;
  dueAt?: string;
  recurrence?: AssignmentRecurrence;
  notes?: string;
  module: ModulePreviewForAssignment;
  program: ProgramPreviewForAssignment;
  latestAttempt?: AssignmentLatestAttemptPreview;
  createdAt: string;
  updatedAt: string;
  percentComplete?: number;
  attemptCount?: number;
};

export type MyAssignmentsResponse = {
  success: boolean;
  assignments: MyAssignmentView[];
};

// ==================================
// API: Unified Practice
// ==================================
export type PracticeItemStatus = "not_started" | "in_progress" | "completed";

export type PracticeLatestAttempt = {
  attemptId: string;
  status: AttemptStatus;
  totalScore?: number;
  scoreBandLabel?: string;
  completedAt?: string;
  iteration: number;
};

export type PracticeItem = {
  assignmentId: string;
  moduleId: string;
  moduleTitle: string;
  moduleType: ModuleType;
  programTitle: string;
  source: AssignmentSource;
  therapistName?: string;
  status: PracticeItemStatus;
  dueAt?: string;
  recurrence?: AssignmentRecurrence;
  notes?: string;
  percentComplete: number;
  attemptCount: number;
  latestAttempt?: PracticeLatestAttempt;
};

export type PracticeResponse = {
  success: boolean;
  today: PracticeItem[];
  thisWeek: PracticeItem[];
  upcoming: PracticeItem[];
  recentlyCompleted: PracticeItem[];
};

export type PracticeHistoryQuery = {
  moduleId?: string;
  moduleType?: ModuleType;
  cursor?: string;
  limit?: number;
};

export type PracticeHistoryResponse = {
  success: boolean;
  items: PracticeItem[];
  nextCursor: string | null;
};

// ==================================
// API: Patient Practice for Therapist
// ==================================
export type SparklineMap = Record<string, number[]>; // moduleId to last 5 scores

export type PatientPracticeResponse = PracticeResponse & {
  sparklines: SparklineMap;
};

// ==================================
// API: Therapist Review
// ==================================
export type AttentionReason =
  | "severe_score"
  | "score_regression"
  | "overdue"
  | "first_submission";
export type AttentionPriority = "high" | "medium" | "low";

export type ReviewItem = PracticeItem & {
  patientId: string;
  patientName: string;
  attentionReason?: AttentionReason;
  attentionPriority?: AttentionPriority;
};

export type ReviewGroupBy = "date" | "patient" | "module";

export type ReviewFilters = {
  sort?: SortOption;
  groupBy?: ReviewGroupBy;
  patientId?: string;
  moduleId?: string;
  severity?: SeverityOption;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
};

export type ReviewResponse = {
  success: boolean;
  needsAttention: ReviewItem[];
  submissions: {
    items: ReviewItem[];
    nextCursor: string | null;
    total: number;
  };
};

export type UpdateAssignmentInput = {
  status?: AssignmentStatus;
  dueAt?: string | null;
  notes?: string;
  recurrence?: AssignmentRecurrence;
};

export type TherapistAssignmentsResponse = {
  success: boolean;
  items: MyAssignmentView[];
  page: number;
  totalPages: number;
  totalItems: number;
};

export type AssignmentSortOption = "urgency" | "newest" | "oldest" | "module";
export type AssignmentUrgencyFilter =
  | "overdue"
  | "due_soon"
  | "on_track"
  | "no_due_date";

export type TherapistAssignmentFilters = {
  patientId?: string;
  moduleId?: string;
  status?: string;
  urgency?: AssignmentUrgencyFilter;
  sortBy?: AssignmentSortOption;
  page?: number;
  limit?: number;
};

export type ModulesQuery = {
  program?: string;
  withMeta?: boolean | string; // server treats presence/truthy values as true
};

export type AdminStats = {
  totalUsers: number;
  totalTherapists: number;
  totalPatients: number;
  unverifiedTherapists: AuthUser[];
  completedAttempts: number;
};

export type AttemptDetailItem = {
  order: number;
  questionId: string;
  questionText: string;
  choices: Choice[]; // [{ text, score }]
  chosenScore?: number | null;
  chosenIndex?: number | null;
  chosenText?: string | null;
};

export type AttemptDetail = {
  items: AttemptDetailItem[];
  answeredCount: number;
  totalQuestions: number;
  percentComplete: number;
};

export type DiaryEntry = {
  at: string; // ISO datetime
  label?: string; // e.g., "7–8am"
  activity: string; // free text (can be empty string)
  mood?: number; // 0..100
  achievement?: number; // 0..10
  closeness?: number; // 0..10
  enjoyment?: number; // 0..10
};

export type DiaryEntryInput = {
  at: string; // ISO datetime
  label?: string;
  activity?: string;
  mood?: number;
  achievement?: number;
  closeness?: number;
  enjoyment?: number;
};

export type DiaryDay = {
  dateISO: string; // YYYY-MM-DD in Europe/London
  entries: DiaryEntry[];
  avgMood: number | null;
  avgAchievement: number | null;
  avgCloseness: number | null;
  avgEnjoyment: number | null;
};

export type DiaryTotals = {
  count: number;
  avgMood: number | null;
  avgAchievement: number | null;
  avgCloseness: number | null;
  avgEnjoyment: number | null;
};

export type DiaryDetail = {
  days: DiaryDay[];
  totals: DiaryTotals;
};

export type AttemptDetailResponseItem = ModuleAttempt & {
  band?: ScoreBandSummary;
  detail?: AttemptDetail;
  diary?: DiaryDetail;
  fiveAreas?: FiveAreasData;
  generalGoals?: GeneralGoalsData;
  weeklyGoals?: WeeklyGoalsData;
  patient?: Pick<AuthUser, "_id" | "name" | "username" | "email">;
  module?: Pick<Module, "_id" | "title" | "type">;
};

export type AttemptDetailResponse = {
  success: boolean;
  attempt: AttemptDetailResponseItem;
};

export type MongoId = string;

export type TherapistPreview = Pick<
  User,
  "_id" | "username" | "email" | "name"
>;

export type UsersSort = `${string}:${"asc" | "desc"}` | string;
// Server supports multi-field via comma: "lastLogin:desc,name:asc"
export type UsersSortMulti =
  | UsersSort
  | `${UsersSort},${UsersSort}`
  | `${UsersSort},${UsersSort},${string}`;

export type GetUsersQuery = {
  page?: number;
  limit?: number;
  q?: string;

  // Filters (server accepts csv strings or arrays; booleans can be "true"/"false")
  roles?: UserRole[] | string;
  ids?: string[] | string;
  isVerified?: boolean | string;
  isVerifiedTherapist?: boolean | string;
  hasTherapist?: boolean | string;
  therapistId?: string;

  // Date ranges (ISO strings)
  createdFrom?: string;
  createdTo?: string;
  lastLoginFrom?: string;
  lastLoginTo?: string;

  // Sorting & field selection
  sort?: UsersSortMulti;
  select?: string[] | string;
};

export type UsersListItem = {
  _id: MongoId;
  username: string;
  email: string;
  name?: string;
  roles: UserRole[];

  // Verification flags
  isVerified?: boolean;
  isVerifiedTherapist?: boolean;
  therapistTier?: TherapistTier;

  // Relations
  therapist?: MongoId | null;
  // Present only if requested via `select` (controller can project this)
  therapistInfo?: TherapistPreview | null;
  // Returned as ids by default (you can change server proj to a count if preferred)
  patients?: MongoId[];

  // Timestamps
  createdAt: string;
  updatedAt: string;
  lastLogin?: string;
};

export type FacetCount<T = string | boolean | null> = {
  _id: T;
  count: number;
};

export type UsersFacets = {
  roles: FacetCount<UserRole>[];
  isVerified: FacetCount<boolean>[];
  isVerifiedTherapist: FacetCount<boolean>[];
  hasTherapist: FacetCount<boolean>[];
};

export type GetUsersResponse = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: UsersListItem[];
  facets: UsersFacets;
};

// ==================================
// API: Therapist patient timeline (this endpoint)
// ==================================

export type PatientModuleTimelineQuery = {
  moduleId?: string;
  limit?: number;
  cursor?: Cursor;
  severity?: SeverityOption;
  /**
   * Status filter:
   * - 'submitted' (default) = completed timeline (sorted by completedAt)
   * - 'active' = alias for in-progress (maps to ['started'])
   * - 'started' | 'abandoned' | csv (e.g. "started,abandoned")
   * - 'all' = no status filter (sorted by lastInteractionAt)
   */
  status?:
    | "submitted"
    | "active"
    | AttemptStatus
    | `${AttemptStatus},${string}`
    | "all"
    | string;
};

export type PatientModulesResponse = {
  success: boolean;
  modules: { _id: string; title: string }[];
};

export type PatientModuleTimelineResponse = {
  success: boolean;
  attempts: (AttemptListItem & { band?: ScoreBandSummary })[];
  nextCursor: string | null;
};

export type BasicMutationResponse = {
  success: boolean;
  message?: string;
  data?: any;
};

// ==================================
// API: Therapist Dashboard
// ==================================

export type DashboardScorePreview = {
  moduleTitle: string;
  moduleId: string;
  score: number;
  band: string;
  scoreBandLabel: string;
  submittedAt: string;
};

export type DashboardAssignmentSummary = {
  completedThisWeek: number;
  overdueTotal: number;
  pendingThisWeek: number;
};

export type DashboardClientItem = {
  patient: Pick<User, "_id" | "username" | "email" | "name">;
  latestScore: DashboardScorePreview | null;
  previousScore: { score: number } | null;
  assignments: DashboardAssignmentSummary;
  lastActive: string | null;
  reasons: Array<"severe_score" | "worsening" | "overdue">;
};

export type DashboardStats = {
  totalClients: number;
  needsAttention: number;
  submittedThisWeek: number;
  overdueAssignments: number;
};

export type TherapistDashboardResponse = {
  weekStart: string;
  stats: DashboardStats;
  needsAttention: DashboardClientItem[];
  completedThisWeek: DashboardClientItem[];
  noActivity: DashboardClientItem[];
};

// ==================================
// API: Patient Score Trends
// ==================================

export type ScoreTrendItem = {
  moduleTitle: string;
  moduleId: string;
  latestScore: number;
  previousScore: number | null;
  sparkline: number[]; // last 5 scores, oldest first
};

export type ScoreTrendsResponse = {
  success: boolean;
  trends: ScoreTrendItem[];
};

// ==================================
// API: Patient Profile Stats
// ==================================

export type PatientProfileStatsResponse = {
  latestCompletion: {
    attemptId: string;
    moduleTitle: string;
    completedAt: string;
  } | null;
  sessionsThisWeek: number;
  assignmentsDue: number;
};

// ==================================
// Admin — primitives (v1)
// ==================================
export type Instrument = "phq9" | "gad7" | "pdss";

export type CareTier = "self_help" | "cbt_guided" | "pwp_guided";
export type TherapistTier = "cbt" | "pwp";

export type AuditedAction =
  | "therapist.verified"
  | "therapist.unverified"
  | "user.viewed"
  | "patient.attemptsViewed"
  | "module.created"
  | "admin.loggedIn";

export type MetricName =
  | "recovery"
  | "reliable_improvement"
  | "reliable_recovery";

export type PrivacyMode = "production" | "reduced";

export type Granularity = "week" | "month";

export type OutcomeResult = {
  rate: number | null;
  n: number;
  suppressed: boolean;
  reason: "below_k" | "below_min_n" | null;
};

// ==================================
// Admin — response shapes (v2)
// ==================================
export type AdminOverviewResponse = {
  asOf: string;
  rollupAsOf: string | null;
  privacyMode: PrivacyMode;
  operational: {
    users: {
      total: number;
      patients: number;
      therapists: {
        total: number;
        verified: number;
        unverified: number;
        zeroPatients: number;
      };
      newThisWeek: number;
      newLastWeek: number;
      activeLast30d: number;
      activeLast30dPrevious: number;
    };
    work: {
      completedAttemptsLast7d: number;
      completedAttemptsPreviousWeek: number;
      stalledAttempts7d: number;
      orphanedAssignments: number;
      byType: Array<{ moduleType: ModuleType; count: number }>;
    };
    audit: { eventsLast7d: number };
  };
  programmes: Array<{
    programmeId: string;
    title: string;
    enrolledUsers: number;
    outcomes: {
      window: "last_90d";
      instrument: Instrument;
      recovery: OutcomeResult;
      reliableImprovement: OutcomeResult;
      reliableRecovery: OutcomeResult;
    } | null;
  }>;
  verificationQueue: {
    count: number;
    oldest: Array<{
      userId: string;
      username: string;
      email: string;
      name?: string;
      createdAt: string;
      therapistTier: TherapistTier | null;
    }>;
  };
};

export type AdminOutcomesResponse = {
  asOf: string;
  rollupAsOf: string | null;
  privacyMode: PrivacyMode;
  dimension: {
    programmeId: string | null;
    careTier: CareTier | null;
    instrument: Instrument;
  };
  range: { from: string; to: string; granularity: Granularity };
  series: Array<{
    bucket: { startsAt: string; endsAt: string };
    recovery: OutcomeResult;
    reliableImprovement: OutcomeResult;
    reliableRecovery: OutcomeResult;
  }>;
};

export type AdminProgrammeDetailResponse = {
  asOf: string;
  rollupAsOf: string | null;
  privacyMode: PrivacyMode;
  programme: { _id: string; title: string; description: string };
  enrolment: {
    total: number;
    byCareTier: Array<{ careTier: CareTier; count: number }>;
  };
  outcomesByInstrument: Array<{
    instrument: Instrument;
    cutoff: number;
    reliableChangeDelta: number | null;
    window: "last_90d";
    overall: {
      recovery: OutcomeResult;
      reliableImprovement: OutcomeResult;
      reliableRecovery: OutcomeResult;
    };
    byCareTier: Array<{
      careTier: CareTier;
      recovery: OutcomeResult;
      reliableImprovement: OutcomeResult;
      reliableRecovery: OutcomeResult;
    }>;
  }>;
  work: {
    completedAttemptsLast7d: number;
    stalledAttempts7d: number;
    byType: Array<{ moduleType: ModuleType; count: number }>;
  };
};

export type AdminAuditEvent = {
  _id: string;
  actorId: string;
  actor: { _id: string; username: string; name?: string };
  actorRole: "admin";
  impersonatorId: string | null;
  action: AuditedAction;
  resourceType: string;
  resourceId: string | null;
  outcome: "success" | "failure";
  context?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  at: string;
};

export type AdminAuditResponse = {
  success: true;
  events: Array<AdminAuditEvent>;
  nextCursor: string | null;
};

export type AdminSystemHealthResponse = {
  rollupLastRun: {
    startedAt: string;
    completedAt: string | null;
    status: "success" | "partial" | "failure";
    rowsWritten: number;
  } | null;
  auditEventsTotal: number;
};
