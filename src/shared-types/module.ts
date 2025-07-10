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
