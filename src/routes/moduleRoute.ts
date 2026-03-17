import express from 'express'
import {
  getModules,
  createModule,
  getModuleById,
  getDetailedModuleById,
} from '../controllers/moduleController'
import { startAttempt } from '../controllers/attemptsController'
import authorizeAdmin from '../middleware/authorizeAdmin'

const router = express.Router()

router.get('/', getModules)
router.get('/detail/:id', getDetailedModuleById)
router.get('/:id', getModuleById)

router.post('/', authorizeAdmin, createModule)

router.post('/:moduleId/attempts', startAttempt)

export default router
