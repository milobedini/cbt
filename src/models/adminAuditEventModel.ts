import mongoose, { Document, Schema, Types } from "mongoose";

type AuditedAction =
  | "therapist.verified"
  | "therapist.unverified"
  | "user.viewed"
  | "patient.attemptsViewed"
  | "module.created"
  | "admin.loggedIn";

type ResourceType =
  | "user"
  | "therapist"
  | "patient"
  | "module"
  | "attempt"
  | "system";

type IAdminAuditEvent = Document & {
  actorId: Types.ObjectId;
  actorRole: "admin";
  impersonatorId: Types.ObjectId | null;
  action: AuditedAction;
  resourceType: ResourceType;
  resourceId: Types.ObjectId | null;
  outcome: "success" | "failure";
  context?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  at: Date;
};

const AdminAuditEventSchema = new Schema<IAdminAuditEvent>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorRole: {
      type: String,
      enum: ["admin"],
      required: true,
      default: "admin",
    },
    impersonatorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    action: {
      type: String,
      enum: [
        "therapist.verified",
        "therapist.unverified",
        "user.viewed",
        "patient.attemptsViewed",
        "module.created",
        "admin.loggedIn",
      ],
      required: true,
    },
    resourceType: {
      type: String,
      enum: ["user", "therapist", "patient", "module", "attempt", "system"],
      required: true,
    },
    resourceId: { type: Schema.Types.ObjectId, default: null },
    outcome: { type: String, enum: ["success", "failure"], required: true },
    context: { type: Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
    at: { type: Date, required: true, default: Date.now },
  },
  { collection: "adminAuditEvents" },
);

AdminAuditEventSchema.index({ actorId: 1, at: -1 });
AdminAuditEventSchema.index({ resourceType: 1, resourceId: 1, at: -1 });
AdminAuditEventSchema.index({ action: 1, at: -1 });
AdminAuditEventSchema.index({ at: -1 });

const AdminAuditEvent = mongoose.model<IAdminAuditEvent>(
  "AdminAuditEvent",
  AdminAuditEventSchema,
);
export default AdminAuditEvent;
export type { IAdminAuditEvent };
