import express from 'express'
import {
  getAttemptDetailForTherapist,
  getMyAttemptDetail,
  saveProgress,
  submitAttempt,
} from '../controllers/attemptsController'

const router = express.Router()

router.get('/therapist/:attemptId', getAttemptDetailForTherapist)
router.get('/:attemptId', getMyAttemptDetail)

// PATCH /api/attempts/:attemptId
router.patch('/:attemptId', saveProgress)

// POST /api/attempts/:attemptId/submit
router.post('/:attemptId/submit', submitAttempt)

export default router
