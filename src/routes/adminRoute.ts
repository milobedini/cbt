import express from "express";
import authorizeAdmin from "../middleware/authorizeAdmin";

const router = express.Router();

router.use(authorizeAdmin);

// Routes added in subsequent tasks

export default router;
