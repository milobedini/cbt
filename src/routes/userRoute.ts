import {
  addRemoveTherapist,
  adminStats,
  adminVerifyTherapist,
  getAllPatients,
  getClients,
  getUser,
  getUsers,
} from '../controllers/userController'
import express from 'express'
import {
  getMyAttempts,
  getTherapistLatest,
  getPatientModuleTimeline,
} from '../controllers/attemptsController'
import { getAvailableModules } from '../controllers/moduleController'
import { getMyAssignments } from '../controllers/assignmentsController'

const router = express.Router()

router.get('/', getUser)
router.get('/users', getUsers)
router.get('/patients', getAllPatients)
router.get('/clients', getClients)
router.get('/admin/stats', adminStats)
router.post('/assign', addRemoveTherapist)
router.post('/verify', adminVerifyTherapist)

// ✅ Patient: my submitted attempts (cursor-paginated)
router.get('/attempts', getMyAttempts)
router.get('/available', getAvailableModules)
router.get('/assignments', getMyAssignments) // ?status=active|completed|all

// ✅ Therapist: latest per (patient,module)
router.get('/therapist/attempts/latest', getTherapistLatest)

// ✅ Therapist: one patient’s timeline for one module
router.get('/therapist/patients/:patientId/timeline', getPatientModuleTimeline)

export default router
