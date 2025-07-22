import mongoose from 'mongoose'

if (require.main === module) {
  import('../config/database').then((connectDB) =>
    connectDB
      .default()
      .then(async () => {
        console.log('🔌 Connected to DB')
        await mongoose.connection.dropDatabase()
        console.log('✅ Database dropped')
        process.exit(0)
      })
      .catch((err) => {
        console.error('❌ DB connection or dropping failed:', err)
        process.exit(1)
      })
  )
}
