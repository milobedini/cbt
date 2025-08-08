import { ObjectId } from 'mongoose'

export type User = {
  _id: string
  username: string
  email: string
}

export type AuthUser = User & {
  roles: string[]
  isVerifiedTherapist?: boolean
  patients?: string[]
  therapist?: string
}

export type UserRole = 'therapist' | 'admin' | 'patient'

export type AuthResponse = {
  success: boolean
  message: string
  user: AuthUser
}

export type RegisterInput = {
  username: string
  email: string
  password: string
  roles: UserRole[]
}

export type LoginInput = {
  identifier: string
  password: string
}

export type VerifyInput = {
  verificationCode: string
}

export type PatientsResponse = User[]

export type AddRemoveTherapistResponse = {
  message: string
  patient: AuthUser
  therapistPatients: string[]
}

export type AddRemoveTherapistInput = {
  therapistId: string
  patientId: string
}
