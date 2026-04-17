export type WeeklyGoalPlannedDiaryRefDb = {
  at: Date
  label?: string
}

export type WeeklyGoalEntryDb = {
  goalText: string
  completed: boolean
  masteryRating: number | null
  pleasureRating: number | null
  plannedDiaryEntryRef: WeeklyGoalPlannedDiaryRefDb | null
  completionNotes: string | null
}

export type WeeklyGoalsReflectionDb = {
  moodImpact: string
  takeaway: string
  balance: string
  barriers: string
}

export const emptyReflection = (): WeeklyGoalsReflectionDb => ({
  moodImpact: '',
  takeaway: '',
  balance: '',
  barriers: '',
})

export const coerceRating = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : null
}

export const coercePlannedRef = (
  v: unknown
): WeeklyGoalPlannedDiaryRefDb | null => {
  if (!v || typeof v !== 'object') return null
  const rec = v as Record<string, unknown>
  if (rec.at === null || rec.at === undefined) return null
  const at = new Date(String(rec.at))
  if (isNaN(at.getTime())) return null
  const labelRaw = rec.label
  if (typeof labelRaw === 'string') {
    const label = labelRaw.trim().slice(0, 100)
    return label ? { at, label } : { at }
  }
  return { at }
}

export const sanitiseWeeklyGoalItems = (
  raw: unknown
): WeeklyGoalEntryDb[] => {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 7).map((item) => {
    const rec = (item ?? {}) as Record<string, unknown>
    const goalText = String(rec.goalText ?? '').trim().slice(0, 500)
    const completionNotesRaw = String(rec.completionNotes ?? '')
      .trim()
      .slice(0, 500)
    return {
      goalText,
      completed: Boolean(rec.completed),
      masteryRating: coerceRating(rec.masteryRating),
      pleasureRating: coerceRating(rec.pleasureRating),
      plannedDiaryEntryRef: coercePlannedRef(rec.plannedDiaryEntryRef),
      completionNotes: completionNotesRaw.length > 0 ? completionNotesRaw : null,
    }
  })
}

export const mergeReflection = (
  existing: Partial<WeeklyGoalsReflectionDb> | undefined,
  incoming: Partial<WeeklyGoalsReflectionDb> | undefined
): WeeklyGoalsReflectionDb => {
  const base = { ...emptyReflection(), ...(existing ?? {}) }
  if (!incoming) return base
  const normString = (v: unknown): string | undefined =>
    typeof v === 'string' ? v.slice(0, 2000) : undefined
  const patch: Partial<WeeklyGoalsReflectionDb> = {}
  const keys: (keyof WeeklyGoalsReflectionDb)[] = [
    'moodImpact',
    'takeaway',
    'balance',
    'barriers',
  ]
  for (const k of keys) {
    const next = normString(incoming[k])
    if (next !== undefined) patch[k] = next
  }
  return { ...base, ...patch }
}
