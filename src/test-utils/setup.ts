import { connectTestDb, clearTestDb, disconnectTestDb } from './mongo'

beforeAll(async () => { await connectTestDb() })
afterEach(async () => { await clearTestDb() })
afterAll(async () => { await disconnectTestDb() })
