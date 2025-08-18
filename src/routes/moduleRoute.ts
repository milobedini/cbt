import express from 'express'
import {
  getModules,
  createModule,
  getModuleById,
  getDetailedModuleById,
  enrollUnenrollUserInModule,
} from '../controllers/moduleController'
import {
  startAttempt, // <-- add
} from '../controllers/attemptsController' // <-- add
import authenticateUser from '../middleware/authMiddleware'

const router = express.Router()

router.get('/', getModules)
// ⚠️ Order matters: detail before :id
router.get('/detail/:id', getDetailedModuleById)
router.get('/:id', getModuleById)

router.post('/', createModule)
router.post('/assign', enrollUnenrollUserInModule)

// ✅ Start a new attempt for a module (patient)
router.post('/:moduleId/attempts', startAttempt)

export default router
