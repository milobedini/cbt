import express from 'express'
import dotenv from 'dotenv'
import authRouter from './routes/authRoute'
import userRouter from './routes/userRoute'
import moduleRouter from './routes/moduleRoute'
import connectDB from './config/database'
import cookieParser from 'cookie-parser'
import authenticateUser from './middleware/authMiddleware'
import cors from 'cors'

const allowedOrigins = [
  'http://localhost:8081', // Local
  'https://bwell--8b1gx70fk3.expo.app/', // Web Version
  process.env.CLIENT_URL, // Optional dynamic
].filter(Boolean) // remove falsy values

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

connectDB()

app.use(express.json())
app.use(cookieParser())
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true)
      }
      return callback(new Error('Not allowed by CORS'))
    },
    credentials: true,
  })
)
app.use('/api', authRouter)
app.use('/api/user', authenticateUser, userRouter)
app.use('/api/modules', moduleRouter)

app.get('/', (req, res) => {
  res.send('JWT Authentication System is running!')
})

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`)
})
