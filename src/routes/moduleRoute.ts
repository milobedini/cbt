import express from 'express'
import { getModules, createModule } from '../controllers/moduleController'
import authenticateUser from '../middleware/authMiddleware'

const router = express.Router()

router.get('/', getModules)
router.post('/', authenticateUser, createModule)

export default router
