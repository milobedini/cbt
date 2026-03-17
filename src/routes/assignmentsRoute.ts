import express from 'express'
import {
  createAssignment,
  listAssignmentsForTherapist,
  removeAssignment,
  updateAssignmentStatus,
} from '../controllers/assignmentsController'
import authorizeTherapistOrAdmin from '../middleware/authorizeTherapistOrAdmin'

const router = express.Router()

// POST /api/assignments
router.post('/', authorizeTherapistOrAdmin, createAssignment)

// GET /api/assignments/mine
router.get('/mine', authorizeTherapistOrAdmin, listAssignmentsForTherapist)

// PATCH /api/assignments/:assignmentId/status
router.patch(
  '/:assignmentId/status',
  authorizeTherapistOrAdmin,
  updateAssignmentStatus
)

// DELETE /api/assignments/:assignmentId
router.delete('/:assignmentId', authorizeTherapistOrAdmin, removeAssignment)

export default router
