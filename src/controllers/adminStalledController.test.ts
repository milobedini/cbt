import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { buildTestApp } from "../test-utils/app";
import {
  createProgram,
  createQuestionnaireModule,
  createUser,
} from "../test-utils/factories";
import ModuleAttempt from "../models/moduleAttemptModel";

const signToken = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_SECRET || "test-secret", {
    expiresIn: "7d",
  });

const makeStaleAttempt = async (args: {
  userId: mongoose.Types.ObjectId;
  therapistId?: mongoose.Types.ObjectId;
  programId: mongoose.Types.ObjectId;
  moduleId: mongoose.Types.ObjectId;
  moduleType?:
    | "questionnaire"
    | "reading"
    | "activity_diary"
    | "five_areas_model"
    | "general_goals"
    | "weekly_goals";
  daysStale?: number;
}) => {
  const daysStale = args.daysStale ?? 10;
  const last = new Date(Date.now() - daysStale * 24 * 60 * 60 * 1000);
  return ModuleAttempt.create({
    user: args.userId,
    therapist: args.therapistId,
    program: args.programId,
    module: args.moduleId,
    moduleType: args.moduleType ?? "questionnaire",
    status: "started",
    startedAt: last,
    lastInteractionAt: last,
  });
};

describe("GET /api/admin/attempts/stalled", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret";
  });

  it("returns only attempts stalled ≥ 7 days, oldest first", async () => {
    const admin = await createUser({ role: "admin" });
    const patient = await createUser({ role: "patient" });
    const program = await createProgram();
    const mod = await createQuestionnaireModule({
      programId: program._id,
      title: "PHQ-9",
    });

    await makeStaleAttempt({
      userId: patient._id,
      programId: program._id,
      moduleId: mod._id,
      daysStale: 12,
    });
    await makeStaleAttempt({
      userId: patient._id,
      programId: program._id,
      moduleId: mod._id,
      daysStale: 30,
    });
    // not stale: 3 days
    await makeStaleAttempt({
      userId: patient._id,
      programId: program._id,
      moduleId: mod._id,
      daysStale: 3,
    });

    const res = await request(buildTestApp())
      .get("/api/admin/attempts/stalled")
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    // ascending by lastInteractionAt: 30-days-stale first
    const [first, second] = res.body.items;
    expect(new Date(first.lastInteractionAt).getTime()).toBeLessThan(
      new Date(second.lastInteractionAt).getTime(),
    );
  });

  it("paginates via cursor and returns nextCursor when more remain", async () => {
    const admin = await createUser({ role: "admin" });
    const patient = await createUser({ role: "patient" });
    const program = await createProgram();
    const mod = await createQuestionnaireModule({
      programId: program._id,
      title: "PHQ-9",
    });

    for (let i = 0; i < 4; i++) {
      await makeStaleAttempt({
        userId: patient._id,
        programId: program._id,
        moduleId: mod._id,
        daysStale: 10 + i,
      });
    }

    const first = await request(buildTestApp())
      .get("/api/admin/attempts/stalled?limit=2")
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const next = await request(buildTestApp())
      .get(
        `/api/admin/attempts/stalled?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      )
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);
    expect(next.status).toBe(200);
    expect(next.body.items).toHaveLength(2);
    expect(next.body.nextCursor).toBeNull();
  });

  it("returns moduleType facets keyed off the base filter, not the active type filter", async () => {
    const admin = await createUser({ role: "admin" });
    const patient = await createUser({ role: "patient" });
    const program = await createProgram();
    const modQ = await createQuestionnaireModule({
      programId: program._id,
      title: "PHQ-9",
    });
    const modR = await createQuestionnaireModule({
      programId: program._id,
      title: "Reading",
    });

    await makeStaleAttempt({
      userId: patient._id,
      programId: program._id,
      moduleId: modQ._id,
      moduleType: "questionnaire",
    });
    await makeStaleAttempt({
      userId: patient._id,
      programId: program._id,
      moduleId: modQ._id,
      moduleType: "questionnaire",
    });
    await makeStaleAttempt({
      userId: patient._id,
      programId: program._id,
      moduleId: modR._id,
      moduleType: "reading",
    });

    const res = await request(buildTestApp())
      .get("/api/admin/attempts/stalled?moduleType=reading")
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    // facets show both types even though we filtered by reading
    const byType = new Map<string, number>(
      res.body.facets.moduleTypes.map(
        (f: { moduleType: string; count: number }) => [f.moduleType, f.count],
      ),
    );
    expect(byType.get("questionnaire")).toBe(2);
    expect(byType.get("reading")).toBe(1);
  });

  it("embeds user, therapist and module summaries per row", async () => {
    const admin = await createUser({ role: "admin" });
    const therapist = await createUser({
      role: "therapist",
      isVerifiedTherapist: true,
      therapistTier: "cbt",
    });
    const patient = await createUser({ role: "patient" });
    const program = await createProgram();
    const mod = await createQuestionnaireModule({
      programId: program._id,
      title: "PHQ-9",
    });

    await makeStaleAttempt({
      userId: patient._id,
      therapistId: therapist._id,
      programId: program._id,
      moduleId: mod._id,
    });

    const res = await request(buildTestApp())
      .get("/api/admin/attempts/stalled")
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const row = res.body.items[0];
    expect(row.user._id).toBe(patient._id.toString());
    expect(row.therapist._id).toBe(therapist._id.toString());
    expect(row.therapist.isVerifiedTherapist).toBe(true);
    expect(row.module.title).toBe("PHQ-9");
    expect(row.moduleType).toBe("questionnaire");
  });
});
