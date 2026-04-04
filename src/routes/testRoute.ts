import express from 'express'
import User from '../models/userModel'

const router = express.Router()

// Delete a test user by email — only available in non-production
router.delete('/cleanup', async (req, res) => {
  const { email } = req.body
  if (!email || typeof email !== 'string') {
    res.status(400).json({ message: 'Email is required' })
    return
  }

  try {
    const result = await User.deleteOne({ email })
    res.status(200).json({
      success: true,
      deleted: result.deletedCount,
    })
  } catch (error) {
    res.status(500).json({ message: 'Cleanup failed' })
  }
})

export default router
