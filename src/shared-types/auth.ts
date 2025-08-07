export interface AuthUser {
  _id: string
  username: string
  email: string
  roles: string[]
  isVerifiedTherapist: boolean
}

export type UserRole = 'therapist' | 'admin' | 'patient'

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
