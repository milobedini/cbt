import {
  addRemoveTherapist,
  getAllPatients,
  getClients,
  getUser,
} from '../controllers/userController'
import express from 'express'
import {
  getMyAttempts,
  getTherapistLatest,
  getPatientModuleTimeline,
} from '../controllers/attemptsController'

const router = express.Router()

router.get('/', getUser)
router.get('/patients', getAllPatients)
router.get('/clients', getClients)
router.post('/assign', addRemoveTherapist)

// ✅ Patient: my submitted attempts (cursor-paginated)
router.get('/attempts', getMyAttempts)

// ✅ Therapist: latest per (patient,module)
router.get('/therapist/attempts/latest', getTherapistLatest)

// ✅ Therapist: one patient’s timeline for one module
router.get(
  '/therapist/patients/:patientId/modules/:moduleId/attempts',
  getPatientModuleTimeline
)

export default router
