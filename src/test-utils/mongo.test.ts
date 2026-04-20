import mongoose from 'mongoose'

describe('test-db harness', () => {
  it('connects to in-memory Mongo', () => {
    expect(mongoose.connection.readyState).toBe(1)
  })
})
