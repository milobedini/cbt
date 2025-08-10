import express from 'express'
import { saveProgress, submitAttempt } from '../controllers/attemptsController'

const router = express.Router()

// PATCH /api/attempts/:attemptId
router.patch('/:attemptId', saveProgress)

// POST /api/attempts/:attemptId/submit
router.post('/:attemptId/submit', submitAttempt)

export default router
