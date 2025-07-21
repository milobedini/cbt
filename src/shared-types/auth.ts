export interface AuthUser {
  _id: string
  username: string
  email: string
  roles: string[]
}

export const UserRole = {
  THERAPIST: 'therapist',
  PATIENT: 'patient',
  ADMIN: 'admin',
} as const

export type UserRole = (typeof UserRole)[keyof typeof UserRole]

export interface AuthResponse {
  success: boolean
  message: string
  user: AuthUser
}

export interface RegisterInput {
  username: string
  email: string
  password: string
  roles: UserRole[]
}

export interface LoginInput {
  identifier: string
  password: string
}

export interface VerifyInput {
  verificationCode: string
}
