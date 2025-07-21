export interface AuthUser {
  _id: string
  username: string
  email: string
  roles: UserRole[]
}

export enum UserRole {
  THERAPIST = 'therapist',
  PATIENT = 'patient',
  ADMIN = 'admin',
}

export interface AuthResponse {
  success: boolean
  message: string
  user: AuthUser
}

export interface RegisterInput {
  username: string
  email: string
  password: string
}

export interface LoginInput {
  identifier: string
  password: string
}

export interface RegisterInput {
  email: string
  username: string
  password: string
}

export interface VerifyInput {
  verificationCode: string
}
