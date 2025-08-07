import { getAllPatients, getUser } from '../controllers/userController'
import express from 'express'
const router = express.Router()

router.get('/', getUser)
router.get('/patients', getAllPatients)

export default router
