import express from 'express'
import {
  getModules,
  createModule,
  getModuleById,
} from '../controllers/moduleController'
import authenticateUser from '../middleware/authMiddleware'

const router = express.Router()

router.get('/', getModules)
router.get('/:id', getModuleById)
router.post('/', authenticateUser, createModule)

export default router
