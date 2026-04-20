import { Request, Response } from "express";
import mongoose from "mongoose";
import User, { type IUser, UserRole } from "../models/userModel";
import ModuleAttempt from "../models/moduleAttemptModel";
import { errorHandler } from "../utils/errorHandler";
import { isValidObjectId, Types } from "mongoose";
import { logAdminAction } from "../utils/audit";

// Helpers
const escapeRegex = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Boolish = boolean | undefined;

const parseBool = (v: unknown): Boolish => {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return undefined;
};

const splitCSV = (v?: string | string[]) =>
  (Array.isArray(v) ? v.join(",") : v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const toDate = (v?: string) => (v ? new Date(v) : undefined);

const getUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const requesterId = req.user?._id;
    const requester = await User.findById(requesterId);
    if (!requester) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    // If a param id is given, only admin can look up someone else
    const targetIdParam = req.params.id;
    const targetId =
      targetIdParam && targetIdParam !== "me"
        ? targetIdParam
        : requesterId?.toString();

    if (
      targetId !== requesterId?.toString() &&
      !requester.roles.includes(UserRole.ADMIN)
    ) {
      res.status(403).json({ message: "Admin access required" });
      return;
    }

    const target = await User.findById(
      targetId,
      "_id username email name roles isVerifiedTherapist patients therapist createdAt",
    ).populate("therapist", "_id username email name isVerifiedTherapist");
    if (!target) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (
      requester.roles.includes(UserRole.ADMIN) &&
      targetId !== requesterId?.toString()
    ) {
      await logAdminAction(req, {
        action: "user.viewed",
        resourceType: "user",
        resourceId: target._id as Types.ObjectId,
        outcome: "success",
      });
    }

    res.status(200).json(target);
  } catch (error) {
    errorHandler(res, error);
  }
};

// GetUsers - admin route
const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const requesterId = req.user?._id;
    const requester = await User.findById(requesterId, "roles");
    if (!requester || !requester.roles.includes(UserRole.ADMIN)) {
      res.status(403).json({ message: "Access denied" });
      return;
    }

    // ------- Parse query options -------
    const page = Math.max(parseInt(String(req.query.page || "1"), 10) || 1, 1);
    const limitRaw = Math.max(
      parseInt(String(req.query.limit || "25"), 10) || 25,
      1,
    );
    const limit = Math.min(limitRaw, 200);

    const q = (req.query.q as string | undefined)?.trim();
    const roles = splitCSV(req.query.roles as string | string[] | undefined);
    const ids = splitCSV(req.query.ids as string | string[] | undefined);

    const isVerified = parseBool(req.query.isVerified);
    const isVerifiedTherapist = parseBool(req.query.isVerifiedTherapist);
    const hasTherapist = parseBool(req.query.hasTherapist);

    const therapistId = (req.query.therapistId as string | undefined)?.trim();

    const createdFrom = toDate(req.query.createdFrom as string | undefined);
    const createdTo = toDate(req.query.createdTo as string | undefined);
    const lastLoginFrom = toDate(req.query.lastLoginFrom as string | undefined);
    const lastLoginTo = toDate(req.query.lastLoginTo as string | undefined);

    const sortParam = (req.query.sort as string | undefined)?.trim();
    const selectFields = splitCSV(
      req.query.select as string | string[] | undefined,
    );

    // ------- Build $match (filters) -------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match: Record<string, any> = {};

    if (q) {
      const escaped = escapeRegex(q);
      match.$or = [
        { username: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
        { name: { $regex: escaped, $options: "i" } },
      ];
    }

    if (roles.length) {
      match.roles = { $in: roles };
    }

    if (isVerified !== undefined) {
      match.isVerified = isVerified;
    }

    if (isVerifiedTherapist !== undefined) {
      match.isVerifiedTherapist = isVerifiedTherapist;
    }

    if (hasTherapist !== undefined) {
      match.therapist = hasTherapist
        ? { $exists: true, $ne: null }
        : { $in: [null, undefined] };
    }

    if (therapistId && isValidObjectId(therapistId)) {
      match.therapist = new Types.ObjectId(therapistId);
    }

    if (ids.length) {
      const validIds = ids.filter(isValidObjectId);
      if (validIds.length) {
        match._id = {
          $in: validIds.map((id: string) => new Types.ObjectId(id)),
        };
      } else {
        // No valid ids provided -> empty result quickly
        res.status(200).json({
          page,
          limit,
          total: 0,
          totalPages: 0,
          items: [],
          facets: {
            roles: [],
            isVerified: [],
            isVerifiedTherapist: [],
            hasTherapist: [],
          },
        });
        return;
      }
    }

    if (createdFrom || createdTo) {
      match.createdAt = {};
      if (createdFrom) match.createdAt.$gte = createdFrom;
      if (createdTo) match.createdAt.$lte = createdTo;
    }

    if (lastLoginFrom || lastLoginTo) {
      match.lastLogin = {};
      if (lastLoginFrom) match.lastLogin.$gte = lastLoginFrom;
      if (lastLoginTo) match.lastLogin.$lte = lastLoginTo;
    }

    // ------- Build $sort -------
    const allowedSortFields = new Set([
      "username",
      "email",
      "name",
      "createdAt",
      "updatedAt",
      "lastLogin",
      "roles",
      "isVerified",
      "isVerifiedTherapist",
    ]);
    // Default sort: most recently created first
    const sort: Record<string, 1 | -1> = {};
    if (sortParam) {
      // accept "field:asc,other:desc"
      for (const token of sortParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        const [field, dirRaw] = token.split(":").map((s) => s.trim());
        if (!field || !allowedSortFields.has(field)) continue;
        const dir = (dirRaw || "asc").toLowerCase();
        sort[field] = dir === "desc" ? -1 : 1;
      }
    }
    if (Object.keys(sort).length === 0) {
      sort.createdAt = -1;
    }

    // ------- Build $project (safe default, but allow `select`) -------
    const safeDefaultProjection = {
      _id: 1,
      username: 1,
      email: 1,
      name: 1,
      roles: 1,
      isVerified: 1,
      isVerifiedTherapist: 1,
      therapist: 1,
      patients: 1, // you can swap to `$size: '$patients'` if you'd rather return a count
      createdAt: 1,
      updatedAt: 1,
      lastLogin: 1,
    } as const;

    const project =
      selectFields.length > 0
        ? selectFields.reduce<Record<string, 0 | 1>>((acc, f) => {
            acc[f] = 1;
            return acc;
          }, {})
        : safeDefaultProjection;

    // ------- Aggregation with facets (items + total + filter facets) -------
    const pipeline: mongoose.PipelineStage[] = [
      { $match: match },
      // small lookup to include minimal therapist info:
      {
        $lookup: {
          from: "users-data",
          localField: "therapist",
          foreignField: "_id",
          as: "therapistInfo",
          pipeline: [{ $project: { _id: 1, username: 1, email: 1, name: 1 } }],
        },
      },
      { $addFields: { therapistInfo: { $first: "$therapistInfo" } } },
      {
        $facet: {
          items: [
            { $sort: sort },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            { $project: project },
          ],
          totalCount: [{ $count: "count" }],
          roleFacets: [
            { $group: { _id: "$roles", count: { $sum: 1 } } },
            // roles is an array; explode to counts per individual role
            { $unwind: { path: "$_id", preserveNullAndEmptyArrays: true } },
            { $group: { _id: "$_id", count: { $sum: "$count" } } },
            { $sort: { _id: 1 } },
          ],
          isVerifiedFacets: [
            { $group: { _id: "$isVerified", count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          isVerifiedTherapistFacets: [
            { $group: { _id: "$isVerifiedTherapist", count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          hasTherapistFacets: [
            {
              $group: {
                _id: {
                  $cond: [{ $ifNull: ["$therapist", false] }, true, false],
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
      {
        $project: {
          items: 1,
          total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
          roleFacets: 1,
          isVerifiedFacets: 1,
          isVerifiedTherapistFacets: 1,
          hasTherapistFacets: 1,
        },
      },
    ];

    const [result] = await User.aggregate(pipeline);

    const total: number = result?.total || 0;
    const totalPages = total ? Math.ceil(total / limit) : 0;

    res.status(200).json({
      page,
      limit,
      total,
      totalPages,
      items: result?.items ?? [],
      facets: {
        roles: result?.roleFacets ?? [],
        isVerified: result?.isVerifiedFacets ?? [],
        isVerifiedTherapist: result?.isVerifiedTherapistFacets ?? [],
        hasTherapist: result?.hasTherapistFacets ?? [],
      },
    });
  } catch (error) {
    errorHandler(res, error);
  }
};

const getAllPatients = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    const user = await User.findById(
      userId,
      "_id username email name roles isVerifiedTherapist patients",
    );
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    if (
      !user.roles.includes(UserRole.THERAPIST) &&
      !user.roles.includes(UserRole.ADMIN)
    ) {
      res.status(403).json({ message: "Access denied" });
      return;
    }
    const patients = await User.find(
      { roles: UserRole.PATIENT },
      "_id username email name therapist",
    );

    if (!patients || !patients.length) {
      res.status(404).json({ message: "No patients found" });
      return;
    }
    res.status(200).json(patients);
  } catch (error) {
    errorHandler(res, error);
  }
};

const getClients = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    const user = await User.findById(
      userId,
      "_id username email name roles isVerifiedTherapist patients",
    );
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    if (
      !user.roles.includes(UserRole.THERAPIST) &&
      !user.roles.includes(UserRole.ADMIN)
    ) {
      res.status(403).json({ message: "Access denied" });
      return;
    }

    if (!user.patients?.length) {
      res.status(200).json([]);
      return;
    }

    const match: mongoose.FilterQuery<IUser> = {
      _id: { $in: user.patients },
    };

    const q = (req.query.q as string | undefined)?.trim();
    if (q) {
      const escaped = escapeRegex(q);
      match.$or = [
        { username: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
        { name: { $regex: escaped, $options: "i" } },
      ];
    }

    const sortParam = (req.query.sort as string | undefined)?.trim();
    const allowedSortFields = new Set(["name", "username", "email"]);
    let sort: Record<string, mongoose.SortOrder> = { name: 1 };
    if (sortParam) {
      const desc = sortParam.startsWith("-");
      const field = desc ? sortParam.slice(1) : sortParam;
      if (allowedSortFields.has(field)) {
        sort = { [field]: desc ? -1 : 1 };
      }
    }

    const patients = await User.find(match, "_id username email name therapist")
      .sort(sort)
      .lean();

    res.status(200).json(patients);
  } catch (error) {
    errorHandler(res, error);
  }
};

const addRemoveTherapist = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?._id;
    const { therapistId, patientId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ message: "Not logged in" });
      return;
    }

    if (
      !user.roles.includes(UserRole.ADMIN) &&
      !user.roles.includes(UserRole.THERAPIST)
    ) {
      res.status(403).json({ message: "Access denied" });
      return;
    }

    const patient = await User.findById(patientId);
    if (!patient) {
      res.status(404).json({ message: "Patient not found" });
      return;
    }

    const therapist = await User.findById(therapistId);
    if (!therapist) {
      res.status(404).json({ message: "Therapist not found" });
      return;
    }

    if (!therapist.roles.includes(UserRole.THERAPIST)) {
      res
        .status(403)
        .json({ message: "Only therapists can be assigned as therapist" });
      return;
    }
    if (!therapist.isVerifiedTherapist) {
      res.status(403).json({ message: "Therapist is not verified" });
      return;
    }

    if (!patient.roles.includes(UserRole.PATIENT)) {
      res
        .status(403)
        .json({ message: "Only patients can be assigned as patient" });
      return;
    }

    const patientIdObj = patient._id as Types.ObjectId;
    const therapistIdObj = therapist._id as Types.ObjectId;

    const alreadyAssigned =
      patient.therapist?.toString() === therapistId.toString();

    if (alreadyAssigned) {
      patient.therapist = undefined;
      therapist.patients = (therapist.patients || []).filter(
        (id) => !id.equals(patientIdObj),
      );
    } else {
      patient.therapist = therapistIdObj;

      const alreadyInList = (therapist.patients || []).some((id) =>
        id.equals(patientIdObj),
      );

      if (!alreadyInList) {
        therapist.patients = [...(therapist.patients || []), patientIdObj];
      }
    }

    const message = alreadyAssigned
      ? "Therapist removed from patient"
      : "Therapist assigned to patient";

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await patient.save({ session });
        await therapist.save({ session });
      });
    } finally {
      await session.endSession();
    }

    res
      .status(200)
      .json({ message, patient, therapistPatients: therapist.patients });
  } catch (error) {
    errorHandler(res, error);
  }
};

const adminVerifyTherapist = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?._id;
    const { therapistId, therapistTier } = req.body as {
      therapistId?: string;
      therapistTier?: "cbt" | "pwp";
    };

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ message: "Not logged in" });
      return;
    }
    if (!user.roles.includes(UserRole.ADMIN)) {
      res.status(403).json({ message: "Only admins can verify therapists" });
      return;
    }
    if (!therapistTier || !["cbt", "pwp"].includes(therapistTier)) {
      res
        .status(400)
        .json({ message: "therapistTier is required and must be cbt or pwp" });
      return;
    }

    const therapist = await User.findById(therapistId);
    if (!therapist) {
      res.status(404).json({ message: "Therapist not found" });
      await logAdminAction(req, {
        action: "therapist.verified",
        resourceType: "therapist",
        resourceId: therapistId ?? null,
        outcome: "failure",
        context: { reason: "not_found" },
      });
      return;
    }
    if (!therapist.roles.includes(UserRole.THERAPIST)) {
      res.status(403).json({ message: "Only therapists can be verified" });
      await logAdminAction(req, {
        action: "therapist.verified",
        resourceType: "therapist",
        resourceId: therapist._id as Types.ObjectId,
        outcome: "failure",
        context: { reason: "not_a_therapist" },
      });
      return;
    }

    therapist.isVerifiedTherapist = true;
    therapist.therapistTier = therapistTier;
    await therapist.save();

    await logAdminAction(req, {
      action: "therapist.verified",
      resourceType: "therapist",
      resourceId: therapist._id as Types.ObjectId,
      outcome: "success",
      context: { therapistTier },
    });

    res
      .status(200)
      .json({ message: "Therapist verified successfully", therapist });
  } catch (error) {
    errorHandler(res, error);
  }
};

// DEPRECATED: superseded by GET /api/admin/overview. Kept for one release to avoid FE outage.
// Remove after FE v2 ships and has been live for at least 7 days.
const adminStats = async (req: Request, res: Response): Promise<void> => {
  // Return number of users, of which therapists and patients.
  // Return unverified therapists in list
  // Return completed attempts in last 7 days
  try {
    const userId = req.user?._id;
    const user = await User.findById(userId);
    if (!user || !user.roles.includes(UserRole.ADMIN)) {
      res.status(403).json({ message: "Access denied" });
      return;
    }

    const totalUsers = await User.countDocuments();
    const totalTherapists = await User.countDocuments({
      roles: UserRole.THERAPIST,
    });
    const totalPatients = await User.countDocuments({
      roles: UserRole.PATIENT,
    });
    const unverifiedTherapists = await User.find({
      roles: UserRole.THERAPIST,
      isVerifiedTherapist: false,
    });
    const completedAttempts = await ModuleAttempt.countDocuments({
      status: "submitted",
      completedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    });

    res.status(200).json({
      totalUsers,
      totalTherapists,
      totalPatients,
      unverifiedTherapists,
      completedAttempts,
    });
  } catch (error) {
    errorHandler(res, error);
  }
};

const adminUnverifyTherapist = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?._id;
    const { therapistId } = req.body as { therapistId?: string };

    const user = await User.findById(userId);
    if (!user || !user.roles.includes(UserRole.ADMIN)) {
      res.status(403).json({ message: "Only admins can unverify therapists" });
      return;
    }

    const therapist = await User.findById(therapistId);
    if (!therapist || !therapist.roles.includes(UserRole.THERAPIST)) {
      res.status(404).json({ message: "Therapist not found" });
      await logAdminAction(req, {
        action: "therapist.unverified",
        resourceType: "therapist",
        resourceId: therapistId ?? null,
        outcome: "failure",
        context: { reason: "not_found" },
      });
      return;
    }

    therapist.isVerifiedTherapist = false;
    // Keep therapistTier so we remember their category; unset only on request.
    await therapist.save();

    await logAdminAction(req, {
      action: "therapist.unverified",
      resourceType: "therapist",
      resourceId: therapist._id as Types.ObjectId,
      outcome: "success",
    });

    res.status(200).json({ message: "Therapist unverified", therapist });
  } catch (error) {
    errorHandler(res, error);
  }
};

export {
  getUser,
  getAllPatients,
  getClients,
  addRemoveTherapist,
  adminVerifyTherapist,
  adminUnverifyTherapist,
  adminStats,
  getUsers,
};
