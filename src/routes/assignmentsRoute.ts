import express from 'express'
import {
  createAssignment,
  listAssignmentsForTherapist,
  updateAssignmentStatus,
} from '../controllers/assignmentsController'

const router = express.Router()

// POST /api/assignments
router.post('/', createAssignment)

// GET /api/assignments/mine
router.get('/mine', listAssignmentsForTherapist)

// PATCH /api/assignments/:assignmentId/status
router.patch('/:assignmentId/status', updateAssignmentStatus)

export default router
