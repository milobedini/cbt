import express from 'express'
import { getProgramById, getPrograms } from '../controllers/programController'

const router = express.Router()

router.get('/', getPrograms)
router.get('/:id', getProgramById)

export default router
