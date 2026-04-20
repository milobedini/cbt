import express from "express";
import authorizeAdmin from "../middleware/authorizeAdmin";
import { getAdminOverview } from "../controllers/adminController";

const router = express.Router();

router.use(authorizeAdmin);

router.get("/overview", getAdminOverview);

export default router;
