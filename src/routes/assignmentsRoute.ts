import express from "express";
import {
  createAssignment,
  listAssignmentsForTherapist,
  removeAssignment,
  updateAssignment,
} from "../controllers/assignmentsController";
import authorizeTherapistOrAdmin from "../middleware/authorizeTherapistOrAdmin";

const router = express.Router();

// POST /api/assignments
router.post("/", authorizeTherapistOrAdmin, createAssignment);

// GET /api/assignments/mine
router.get("/mine", authorizeTherapistOrAdmin, listAssignmentsForTherapist);

// PATCH /api/assignments/:assignmentId — update any combination of fields
router.patch("/:assignmentId", authorizeTherapistOrAdmin, updateAssignment);

// PATCH /api/assignments/:assignmentId/status — kept for backwards compat
router.patch(
  "/:assignmentId/status",
  authorizeTherapistOrAdmin,
  updateAssignment,
);

// DELETE /api/assignments/:assignmentId
router.delete("/:assignmentId", authorizeTherapistOrAdmin, removeAssignment);

export default router;
