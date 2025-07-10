import express from 'express'
import dotenv from 'dotenv'
import authRouter from './routes/authRoute'
import userRouter from './routes/userRoute'
import moduleRouter from './routes/moduleRoute'
import connectDB from './config/database'
import cookieParser from 'cookie-parser'
import authenticateUser from './middleware/authMiddleware'
import cors from 'cors'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

connectDB()

app.use(express.json())
app.use(cookieParser())
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:8081',
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
