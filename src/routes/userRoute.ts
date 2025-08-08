import {
  addRemoveTherapist,
  getAllPatients,
  getClients,
  getUser,
} from '../controllers/userController'
import express from 'express'
const router = express.Router()

router.get('/', getUser)
router.get('/patients', getAllPatients)
router.get('/clients', getClients)
router.post('/assign', addRemoveTherapist)

export default router
