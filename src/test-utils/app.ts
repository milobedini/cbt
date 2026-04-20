import express from "express";
import cookieParser from "cookie-parser";
import authRouter from "../routes/authRoute";
import userRouter from "../routes/userRoute";
import adminRouter from "../routes/adminRoute";
import authenticateUser from "../middleware/authMiddleware";

export const buildTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", authRouter);
  app.use("/api/user", authenticateUser, userRouter);
  app.use("/api/admin", authenticateUser, adminRouter);
  return app;
};
