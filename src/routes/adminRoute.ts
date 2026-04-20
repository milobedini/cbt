import express from "express";
import authorizeAdmin from "../middleware/authorizeAdmin";
import {
  getAdminOverview,
  getAdminSystemHealth,
} from "../controllers/adminController";
import { getAdminOutcomes } from "../controllers/adminOutcomesController";
import { getAdminProgrammeDetail } from "../controllers/adminProgrammesController";
import { getAdminAudit } from "../controllers/adminAuditController";

const router = express.Router();

router.use(authorizeAdmin);

router.get("/overview", getAdminOverview);
router.get("/outcomes", getAdminOutcomes);
router.get("/programmes/:id", getAdminProgrammeDetail);
router.get("/audit", getAdminAudit);
router.get("/system/health", getAdminSystemHealth);

export default router;
