import {
  addRemoveTherapist,
  adminStats,
  adminVerifyTherapist,
  adminUnverifyTherapist,
  getAllPatients,
  getClients,
  getUser,
  getUsers,
} from "../controllers/userController";
import express from "express";
import {
  getMyAttempts,
  getMyScoreTrends,
  getTherapistAttemptModules,
  getTherapistLatest,
  getPatientModuleTimeline,
  getPatientModules,
} from "../controllers/attemptsController";
import { getAvailableModules } from "../controllers/moduleController";
import { getMyAssignments } from "../controllers/assignmentsController";
import { getTherapistDashboard } from "../controllers/therapistDashboardController";
import { getProfileStats } from "../controllers/profileStatsController";
import {
  getMyPractice,
  getMyPracticeHistory,
  getPatientPractice,
} from "../controllers/practiceController";
import { getTherapistReview } from "../controllers/reviewController";

const router = express.Router();

router.get("/", getUser);
router.get("/users", getUsers);
router.get("/patients", getAllPatients);
router.get("/clients", getClients);
router.get("/admin/stats", adminStats);
router.post("/assign", addRemoveTherapist);
router.post("/verify", adminVerifyTherapist);
router.post("/unverify", adminUnverifyTherapist);

// ✅ Patient: my submitted attempts (cursor-paginated)
router.get("/attempts", getMyAttempts);
router.get("/available", getAvailableModules);
router.get("/assignments", getMyAssignments); // ?status=active|completed|all

// ✅ Patient: score trends for dashboard sparklines
router.get("/score-trends", getMyScoreTrends);

// ✅ Patient: profile stats (latest score, sessions this week, assignments due)
router.get("/profile-stats", getProfileStats);

// ✅ Therapist: dashboard (triage buckets + stats)
router.get("/therapist/dashboard", getTherapistDashboard);

// ✅ Therapist: distinct modules attempted by patients
router.get("/therapist/attempts/modules", getTherapistAttemptModules);

// ✅ Therapist: latest per (patient,module)
router.get("/therapist/attempts/latest", getTherapistLatest);

// ✅ Therapist: one patient’s timeline for one module
router.get("/therapist/patients/:patientId/timeline", getPatientModuleTimeline);

// ✅ Therapist: distinct modules a patient has attempts for
router.get("/therapist/patients/:patientId/modules", getPatientModules);

// ✅ Patient: unified practice view
router.get("/practice", getMyPractice);
router.get("/practice/history", getMyPracticeHistory);

// ✅ Therapist: patient practice view
router.get("/therapist/patients/:patientId/practice", getPatientPractice);

// ✅ Therapist: review feed
router.get("/therapist/review", getTherapistReview);

export default router;
