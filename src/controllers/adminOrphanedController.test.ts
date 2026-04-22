import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { buildTestApp } from "../test-utils/app";
import {
  createProgram,
  createQuestionnaireModule,
  createUser,
} from "../test-utils/factories";
import ModuleAssignment from "../models/moduleAssignmentModel";

const signToken = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_SECRET || "test-secret", {
    expiresIn: "7d",
  });

const makeAssignment = async (args: {
  userId: mongoose.Types.ObjectId;
  therapistId: mongoose.Types.ObjectId | null;
  programId: mongoose.Types.ObjectId;
  moduleId: mongoose.Types.ObjectId;
  createdAt?: Date;
}) =>
  ModuleAssignment.create({
    user: args.userId,
    therapist: args.therapistId,
    program: args.programId,
    module: args.moduleId,
    moduleType: "questionnaire",
    status: "assigned",
    source: "therapist",
    ...(args.createdAt && {
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    }),
  });

describe("GET /api/admin/assignments/orphaned", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret";
  });

  it("returns only assignments whose therapist is missing or unverified", async () => {
    const admin = await createUser({ role: "admin" });
    const verifiedTherapist = await createUser({
      role: "therapist",
      isVerifiedTherapist: true,
      therapistTier: "cbt",
    });
    const unverifiedTherapist = await createUser({
      role: "therapist",
      isVerifiedTherapist: false,
    });
    const missingTherapistId = new mongoose.Types.ObjectId();
    const patient = await createUser({ role: "patient" });
    const program = await createProgram();
    const mod = await createQuestionnaireModule({
      programId: program._id,
      title: "PHQ-9",
    });

    // verified — not orphaned
    await makeAssignment({
      userId: patient._id,
      therapistId: verifiedTherapist._id,
      programId: program._id,
      moduleId: mod._id,
    });
    // unverified — orphaned
    await makeAssignment({
      userId: patient._id,
      therapistId: unverifiedTherapist._id,
      programId: program._id,
      moduleId: mod._id,
    });
    // missing user — orphaned
    await makeAssignment({
      userId: patient._id,
      therapistId: missingTherapistId,
      programId: program._id,
      moduleId: mod._id,
    });

    const res = await request(buildTestApp())
      .get("/api/admin/assignments/orphaned")
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    const reasons = res.body.items
      .map((r: { reason: string }) => r.reason)
      .sort();
    expect(reasons).toEqual(["therapist_missing", "therapist_unverified"]);
  });

  it("filters by reason but reports facets for both reasons", async () => {
    const admin = await createUser({ role: "admin" });
    const unverifiedA = await createUser({
      role: "therapist",
      isVerifiedTherapist: false,
    });
    const unverifiedB = await createUser({
      role: "therapist",
      isVerifiedTherapist: false,
    });
    const missing1 = new mongoose.Types.ObjectId();
    const patient = await createUser({ role: "patient" });
    const program = await createProgram();
    const mod = await createQuestionnaireModule({
      programId: program._id,
      title: "PHQ-9",
    });

    await makeAssignment({
      userId: patient._id,
      therapistId: unverifiedA._id,
      programId: program._id,
      moduleId: mod._id,
    });
    await makeAssignment({
      userId: patient._id,
      therapistId: unverifiedB._id,
      programId: program._id,
      moduleId: mod._id,
    });
    await makeAssignment({
      userId: patient._id,
      therapistId: missing1,
      programId: program._id,
      moduleId: mod._id,
    });

    const res = await request(buildTestApp())
      .get("/api/admin/assignments/orphaned?reason=therapist_missing")
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].reason).toBe("therapist_missing");
    const byReason = new Map<string, number>(
      res.body.facets.reasons.map((r: { reason: string; count: number }) => [
        r.reason,
        r.count,
      ]),
    );
    expect(byReason.get("therapist_unverified")).toBe(2);
    expect(byReason.get("therapist_missing")).toBe(1);
  });

  it("paginates newest-first via createdAt cursor", async () => {
    const admin = await createUser({ role: "admin" });
    const unverified = await createUser({
      role: "therapist",
      isVerifiedTherapist: false,
    });
    const patient = await createUser({ role: "patient" });
    const program = await createProgram();
    const mod = await createQuestionnaireModule({
      programId: program._id,
      title: "PHQ-9",
    });

    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      await makeAssignment({
        userId: patient._id,
        therapistId: unverified._id,
        programId: program._id,
        moduleId: mod._id,
        createdAt: new Date(now - i * 60_000),
      });
    }

    const first = await request(buildTestApp())
      .get("/api/admin/assignments/orphaned?limit=2")
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const next = await request(buildTestApp())
      .get(
        `/api/admin/assignments/orphaned?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      )
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);
    expect(next.status).toBe(200);
    expect(next.body.items).toHaveLength(2);
    expect(next.body.nextCursor).toBeNull();
  });
});
