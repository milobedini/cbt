import { UserRole } from '../models/userModel'

export const isAdmin = (user: { roles?: UserRole[] }): boolean =>
  user.roles?.includes(UserRole.ADMIN) ?? false

export const isTherapist = (user: { roles?: UserRole[] }): boolean =>
  user.roles?.includes(UserRole.THERAPIST) ?? false

export const isVerifiedTherapist = (user: {
  roles?: UserRole[]
  isVerifiedTherapist?: boolean
}): boolean => isTherapist(user) && !!user.isVerifiedTherapist
