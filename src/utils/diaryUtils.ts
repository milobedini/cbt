import { DateTime } from 'luxon'
import {
  SLOT_END_HOUR,
  SLOT_START_HOUR,
  SLOT_STEP_HOURS,
  LONDON_TZ,
} from '../shared-types/constants'
import { computeWeekStart } from './attemptUtils'

type DiaryEntryInput = {
  at: string | Date
  label?: string
  activity?: string
  mood?: number
  achievement?: number
  closeness?: number
  enjoyment?: number
}

const clampInt = (
  n: unknown,
  min: number,
  max: number
): number | undefined => {
  if (typeof n !== 'number' || Number.isNaN(n)) return undefined
  return Math.min(max, Math.max(min, Math.round(n)))
}

export const sanitizeDiaryEntries = (
  list: DiaryEntryInput[] | undefined
): Record<string, unknown>[] => {
  if (!Array.isArray(list)) return []
  return list
    .map((e) => {
      const at = new Date(e.at as string)
      if (isNaN(at.getTime())) return null

      const label =
        typeof e.label === 'string' ? e.label.trim().slice(0, 100) : undefined

      const activity =
        typeof e.activity === 'string' ? e.activity.trim().slice(0, 1000) : ''

      const mood = clampInt(e.mood, 0, 100)
      const achievement = clampInt(e.achievement, 0, 10)
      const closeness = clampInt(e.closeness, 0, 10)
      const enjoyment = clampInt(e.enjoyment, 0, 10)

      return {
        at,
        ...(label ? { label } : {}),
        activity,
        ...(mood != null ? { mood } : {}),
        ...(achievement != null ? { achievement } : {}),
        ...(closeness != null ? { closeness } : {}),
        ...(enjoyment != null ? { enjoyment } : {}),
      }
    })
    .filter(Boolean) as Record<string, unknown>[]
}

type DiaryEntry = {
  at: string | Date
  label?: string
  activity?: string
  mood?: number
  achievement?: number
  closeness?: number
  enjoyment?: number
}

export const decorateDiaryDetail = (attempt: {
  diaryEntries?: DiaryEntry[]
}) => {
  const entries = Array.isArray(attempt.diaryEntries)
    ? [...attempt.diaryEntries]
    : []

  entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  const byDay = new Map<string, DiaryEntry[]>()
  for (const e of entries) {
    const dt = DateTime.fromJSDate(new Date(e.at), { zone: LONDON_TZ })
    const key: string = dt.toISODate() ?? dt.toFormat('yyyy-LL-dd')
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key)!.push(e)
  }

  const avg = (arr: number[]) =>
    arr.length
      ? Math.round(
          (arr.reduce((s, n) => s + n, 0) / arr.length + Number.EPSILON) * 10
        ) / 10
      : null

  const days = Array.from(byDay.entries()).map(([dateISO, items]) => {
    const nums = (k: 'mood' | 'achievement' | 'closeness' | 'enjoyment') =>
      items
        .map((x) => x[k])
        .filter((x): x is number => typeof x === 'number')
    return {
      dateISO,
      entries: items,
      avgMood: avg(nums('mood')),
      avgAchievement: avg(nums('achievement')),
      avgCloseness: avg(nums('closeness')),
      avgEnjoyment: avg(nums('enjoyment')),
    }
  })

  const all = (k: 'mood' | 'achievement' | 'closeness' | 'enjoyment') =>
    entries.map((x) => x[k]).filter((x): x is number => typeof x === 'number')

  const totals = {
    count: entries.length,
    avgMood: avg(all('mood')),
    avgAchievement: avg(all('achievement')),
    avgCloseness: avg(all('closeness')),
    avgEnjoyment: avg(all('enjoyment')),
  }

  return { days, totals }
}

export const computeDiaryPercentComplete = (
  attempt: {
    diaryEntries?: DiaryEntry[]
    weekStart?: Date | string
  },
  now = new Date()
): number => {
  try {
    const entries = Array.isArray(attempt?.diaryEntries)
      ? attempt.diaryEntries
      : []
    if (!entries.length) return 0

    const anchor =
      attempt.weekStart &&
      !Number.isNaN(new Date(attempt.weekStart).getTime())
        ? new Date(attempt.weekStart)
        : computeWeekStart(now)

    const weekStart = DateTime.fromJSDate(anchor, { zone: LONDON_TZ }).startOf(
      'day'
    )
    const weekEnd = weekStart.plus({ days: 7 })

    const slotsPerDay = Math.floor(
      (SLOT_END_HOUR - SLOT_START_HOUR) / SLOT_STEP_HOURS
    )
    if (slotsPerDay <= 0) return 0
    const totalSlots = 7 * slotsPerDay

    const filled = new Set<string>()

    for (const raw of entries) {
      const at = new Date(raw.at)
      if (Number.isNaN(at.getTime())) continue

      const dt = DateTime.fromJSDate(at, { zone: LONDON_TZ })
      if (dt < weekStart || dt >= weekEnd) continue

      const hasAny =
        (raw.activity && raw.activity.trim().length > 0) ||
        typeof raw.mood === 'number' ||
        typeof raw.achievement === 'number' ||
        typeof raw.closeness === 'number' ||
        typeof raw.enjoyment === 'number'
      if (!hasAny) continue

      const hour = dt.hour
      if (hour < SLOT_START_HOUR || hour >= SLOT_END_HOUR) continue

      const dayIndex = Math.floor(dt.diff(weekStart, 'days').days)
      const slotIndex = Math.floor(
        (hour - SLOT_START_HOUR) / SLOT_STEP_HOURS
      )

      if (dayIndex < 0 || dayIndex >= 7) continue
      if (slotIndex < 0 || slotIndex >= slotsPerDay) continue

      filled.add(`${dayIndex}|${slotIndex}`)
    }

    return Math.round((filled.size / totalSlots) * 100)
  } catch {
    return 0
  }
}

export const computePercentCompleteForAttempt = (attempt: {
  moduleType?: string
  moduleSnapshot?: { questions?: unknown[] }
  answers?: { chosenScore?: number | null }[]
  diaryEntries?: DiaryEntry[]
  weekStart?: Date | string
}): number => {
  if (!attempt) return 0
  if (attempt.moduleType === 'questionnaire') {
    const total = attempt?.moduleSnapshot?.questions?.length || 0
    if (!total) return 0
    const answered = (attempt.answers || []).filter(
      (a) => a?.chosenScore != null
    ).length
    return Math.round((answered / total) * 100)
  }
  if (attempt.moduleType === 'activity_diary') {
    return computeDiaryPercentComplete(attempt)
  }
  return 0
}

export { DiaryEntryInput }
