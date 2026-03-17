import { Types } from 'mongoose'
import ModuleAssignment from '../models/moduleAssignmentModel'

type AccessMeta = {
  canStart: boolean | undefined
  canStartReason: 'ok' | 'requires_assignment' | 'unauthenticated'
  source: Array<'open' | 'assigned'>
  activeAssignmentId: string | undefined
  assignmentStatus: 'assigned' | 'in_progress' | undefined
  dueAt: Date | undefined
}

type ActiveAssignment = {
  _id: Types.ObjectId
  module: Types.ObjectId
  status: string
  dueAt?: Date
}

/**
 * Pick the best assignment per module from a list (prefer in_progress, then earliest due).
 */
const pickBestAssignmentPerModule = (
  assignments: ActiveAssignment[]
): Map<string, ActiveAssignment> => {
  const byModule = new Map<string, ActiveAssignment>()
  const rank = (s: string) => (s === 'in_progress' ? 1 : 2)

  for (const a of assignments) {
    const k = String(a.module)
    const prev = byModule.get(k)
    if (
      !prev ||
      rank(a.status) < rank(prev.status) ||
      (a.dueAt && (!prev.dueAt || a.dueAt < prev.dueAt))
    ) {
      byModule.set(k, a)
    }
  }

  return byModule
}

/**
 * Resolve access metadata for a single module given user context.
 */
const resolveModuleAccessMeta = (
  accessPolicy: string,
  assignment: ActiveAssignment | undefined,
  authenticated: boolean
): AccessMeta => {
  if (!authenticated) {
    return {
      canStart: undefined,
      canStartReason: 'unauthenticated',
      source: [],
      activeAssignmentId: undefined,
      assignmentStatus: undefined,
      dueAt: undefined,
    }
  }

  const source: Array<'open' | 'assigned'> = []
  if (accessPolicy === 'open') source.push('open')
  if (assignment) source.push('assigned')

  const canStart = accessPolicy === 'open' ? true : !!assignment
  const canStartReason = canStart ? 'ok' : 'requires_assignment'

  return {
    canStart,
    canStartReason,
    source,
    activeAssignmentId: assignment?._id?.toString(),
    assignmentStatus: assignment?.status as
      | 'assigned'
      | 'in_progress'
      | undefined,
    dueAt: assignment?.dueAt,
  }
}

/**
 * Fetch active assignments for a user across given module IDs, returning the best per module.
 */
const fetchActiveAssignmentsByModule = async (
  userId: Types.ObjectId,
  moduleIds?: Types.ObjectId[]
): Promise<Map<string, ActiveAssignment>> => {
  const query: Record<string, unknown> = {
    user: userId,
    status: { $in: ['assigned', 'in_progress'] },
  }
  if (moduleIds) {
    query.module = { $in: moduleIds }
  }

  const activeAsgs = await ModuleAssignment.find(query)
    .select('_id module status dueAt')
    .lean()

  return pickBestAssignmentPerModule(
    activeAsgs as unknown as ActiveAssignment[]
  )
}

export {
  AccessMeta,
  ActiveAssignment,
  resolveModuleAccessMeta,
  fetchActiveAssignmentsByModule,
  pickBestAssignmentPerModule,
}
