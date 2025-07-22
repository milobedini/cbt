import express from 'express'
import { getPrograms } from '../controllers/programController'

const router = express.Router()

router.get('/', getPrograms)

export default router
