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

router.get('/', authenticateUser, getModules)
// ⚠️ Order matters: detail before :id
router.get('/detail/:id', authenticateUser, getDetailedModuleById)
router.get('/:id', authenticateUser, getModuleById)

router.post('/', authenticateUser, createModule)
router.post('/assign', authenticateUser, enrollUnenrollUserInModule)

// ✅ Start a new attempt for a module (patient)
router.post('/:moduleId/attempts', authenticateUser, startAttempt)

export default router
