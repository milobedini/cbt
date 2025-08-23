import express from 'express'
import {
  createAssignment,
  listAssignmentsForTherapist,
  removeAssignment,
  updateAssignmentStatus,
} from '../controllers/assignmentsController'

const router = express.Router()

// POST /api/assignments
router.post('/', createAssignment)

// GET /api/assignments/mine
router.get('/mine', listAssignmentsForTherapist)

// PATCH /api/assignments/:assignmentId/status
router.patch('/:assignmentId/status', updateAssignmentStatus)

// DELETE /api/assignments/:assignmentId
router.delete('/:assignmentId', removeAssignment)

export default router
