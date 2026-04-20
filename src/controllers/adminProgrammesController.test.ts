import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { buildTestApp } from "../test-utils/app";
import {
  createUser,
  createProgram,
  createQuestionnaireModule,
} from "../test-utils/factories";

const signToken = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_SECRET || "test-secret", {
    expiresIn: "7d",
  });

describe("GET /api/admin/programmes/:id", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret";
  });

  it("404s unknown programme", async () => {
    const admin = await createUser({ role: "admin" });
    const fake = new mongoose.Types.ObjectId().toString();
    const res = await request(buildTestApp())
      .get(`/api/admin/programmes/${fake}`)
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);
    expect(res.status).toBe(404);
  });

  it("returns programme detail with empty outcomes for new programme", async () => {
    const admin = await createUser({ role: "admin" });
    const prog = await createProgram("Depression");
    await createQuestionnaireModule({
      programId: prog._id,
      title: "PHQ-9",
      instrument: "phq9",
      clinicalCutoff: 10,
      reliableChangeDelta: 6,
    });
    const res = await request(buildTestApp())
      .get(`/api/admin/programmes/${prog._id.toString()}`)
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);
    expect(res.status).toBe(200);
    expect(res.body.programme.title).toBe("Depression");
    expect(res.body.outcomesByInstrument.length).toBe(1);
    expect(res.body.outcomesByInstrument[0].instrument).toBe("phq9");
    expect(res.body.outcomesByInstrument[0].overall.recovery.n).toBe(0);
    expect(res.body.outcomesByInstrument[0].overall.recovery.suppressed).toBe(
      true,
    );
  });
});
