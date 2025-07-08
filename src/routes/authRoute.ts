import {
  loginUser,
  logoutUser,
  registerUser,
  verifyEmail,
  forgotPassword,
  resetPassword,
} from '../controllers/authController'
import express from 'express'
const router = express.Router()

router.post('/register', registerUser)
router.post('/verify-email', verifyEmail)
router.post('/login', loginUser)
router.post('/logout', logoutUser)

router.post('/forgot-password', forgotPassword)
router.post('/reset-password/:token', resetPassword)

export default router
