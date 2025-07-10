export interface ModuleDTO {
  _id: string
  title: string
  description: string
  imageUrl?: string
  createdAt: string
  updatedAt: string
}

export interface ModulesResponse {
  modules: ModuleDTO[]
}

export interface ModuleResponse {
  module: ModuleDTO
}

export interface CreateModuleInput {
  title: string
  description?: string
}

export type AuthResponse = {
  success: boolean
  message: string
  user: {
    _id: string
    username: string
    email: string
  }
}

export type RegisterInput = {
  username: string
  email: string
  password: string
}

export type LoginInput = {
  identifier: string
  password: string
}
