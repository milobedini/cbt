export interface Module {
  _id: string
  title: string
  description: string
  imageUrl?: string
  createdAt: string
  updatedAt: string
}

export interface ModulesResponse {
  modules: Module[]
}

export interface ModuleResponse {
  module: Module
}

export interface CreateModuleInput {
  title: string
  description?: string
}
