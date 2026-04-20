import express from "express";
import authorizeAdmin from "../middleware/authorizeAdmin";
import { getAdminOverview } from "../controllers/adminController";
import { getAdminOutcomes } from "../controllers/adminOutcomesController";
import { getAdminProgrammeDetail } from "../controllers/adminProgrammesController";

const router = express.Router();

router.use(authorizeAdmin);

router.get("/overview", getAdminOverview);
router.get("/outcomes", getAdminOutcomes);
router.get("/programmes/:id", getAdminProgrammeDetail);

export default router;
