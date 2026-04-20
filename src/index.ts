import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import authRouter from "./routes/authRoute";
import userRouter from "./routes/userRoute";
import moduleRouter from "./routes/moduleRoute";
import programRouter from "./routes/programRoute";
import attemptRouter from "./routes/attemptsRoute";
import assignmentRouter from "./routes/assignmentsRoute";
import testRouter from "./routes/testRoute";
import connectDB from "./config/database";
import cookieParser from "cookie-parser";
import authenticateUser from "./middleware/authMiddleware";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { readThresholds } from "./utils/thresholds";
import { startScheduler, stopScheduler } from "./jobs/scheduler";
dotenv.config();

const thresholds = readThresholds();
console.log(
  `[boot] thresholds k=${thresholds.k} minN=${thresholds.minN} privacyMode=${thresholds.privacyMode}`,
);

const isDev = process.env.NODE_ENV !== "production";

const allowedOrigins = [
  "http://localhost:8081",
  "https://bwell--8b1gx70fk3.expo.app/",
  process.env.CLIENT_URL,
].filter(Boolean);

const app = express();
const PORT = process.env.PORT || 3000;

// Trust first proxy (Render) so express-rate-limit gets the real client IP
if (!isDev) {
  app.set("trust proxy", 1);
}

connectDB();
startScheduler();

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
if (isDev) {
  app.use((req, _res, next) => {
    console.log("Server hit", req.url);
    next();
  });
}
app.use(
  cors({
    origin: (origin, callback) => {
      if (isDev) {
        return callback(null, true);
      }

      // In prod, require a valid origin from the whitelist
      if (origin && allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { message: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", apiLimiter);
app.use("/api", authRouter);
app.use("/api/user", authenticateUser, userRouter);
app.use("/api/modules", authenticateUser, moduleRouter);
app.use("/api/programs", authenticateUser, programRouter);
app.use("/api/attempts", authenticateUser, attemptRouter);
app.use("/api/assignments", authenticateUser, assignmentRouter);

if (isDev) {
  app.use("/api/test", testRouter);
}

app.get("/", (_req, res) => {
  res.send("CBT API is running");
});

const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Graceful shutdown
const shutdown = async () => {
  stopScheduler();
  console.log("Shutting down gracefully...");
  server.close(async () => {
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
    process.exit(0);
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
