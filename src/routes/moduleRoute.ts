import express from 'express'
import {
  getModules,
  createModule,
  getModuleById,
  getDetailedModuleById,
  enrollUnenrollUserInModule,
} from '../controllers/moduleController'
import authenticateUser from '../middleware/authMiddleware'

const router = express.Router()

router.get('/', getModules)
router.get('/:id', getModuleById)
router.get('/detail/:id', getDetailedModuleById)
router.post('/', authenticateUser, createModule)
router.post('/assign', authenticateUser, enrollUnenrollUserInModule)

export default router
