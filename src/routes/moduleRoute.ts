import express from 'express'
import {
  getModules,
  createModule,
  getModuleById,
  getDetailedModuleById,
} from '../controllers/moduleController'
import authenticateUser from '../middleware/authMiddleware'

const router = express.Router()

router.get('/', getModules)
router.get('/:id', getModuleById)
router.get('/detail/:id', getDetailedModuleById)
router.post('/', authenticateUser, createModule)

export default router
