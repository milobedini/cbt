export interface AuthUser {
  _id: string
  username: string
  email: string
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
