import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFilesAfterEnv: ['<rootDir>/src/test-utils/setup.ts'],
  testTimeout: 30000, // in-memory Mongo startup
  clearMocks: true,
  verbose: false,
}

export default config
