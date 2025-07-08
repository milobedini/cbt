import {
  loginUser,
  logoutUser,
  registerUser,
  verifyEmail,
} from '../controllers/authController'
import express from 'express'
const router = express.Router()

router.post('/register', registerUser)
router.post('/verify-email', verifyEmail)
router.post('/login', loginUser)
router.post('/logout', logoutUser)

export default router
