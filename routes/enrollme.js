import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Router } from "express";
import multer from "multer";
import {
  addEnrollmeDriverNote,
  createEnrollmeDriver,
  downloadBlankEnrollmeDocument,
  downloadEnrollmeDriverDocument,
  downloadEnrollmeDriverPacket,
  enrollmeAdminLogin,
  enrollmeAdminLogout,
  enrollmeAdminMe,
  getEnrollmeComplianceChecklist,
  getEnrollmeDashboard,
  getEnrollmeDriver,
  getEnrollmeSettingsController,
  listEnrollmeDocuments,
  listEnrollmeDrivers,
  requestEnrollmeCorrection,
  updateEnrollmeDriverStatus,
  updateEnrollmeSettings,
  uploadEnrollmeDriverFile,
} from "../controllers/EnrollmeAdmin.js";
import {
  answerEnrollmeQuizQuestion,
  getEnrollmeFormByToken,
  saveEnrollmeStep,
  signEnrollmeDocument,
  signTrainingAcknowledgment,
  submitEnrollmeOnboarding,
  submitEnrollmeStep,
} from "../controllers/EnrollmeForms.js";
import { authenticateEnrollmeAdmin, requireEnrollmeRole } from "../middleware/enrollmeAuth.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import { validate } from "../middleware/validate.js";
import {
  enrollmeAdminLoginSchema,
  enrollmeCorrectionSchema,
  enrollmeCreateDriverSchema,
  enrollmeFinalAcknowledgmentSchema,
  enrollmeNoteSchema,
  enrollmeQuizAnswerSchema,
  enrollmeSaveStepSchema,
  enrollmeSettingsSchema,
  enrollmeSignatureSchema,
  enrollmeStatusSchema,
} from "../validators/enrollmeSchemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, "../public/uploads/enrollme");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safeBase = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    cb(null, `${Date.now()}-${safeBase || "upload"}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const allowedUploadTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedUploadTypes.has(file.mimetype)) {
      return cb(new Error("Only PDF, JPG, PNG, and WEBP uploads are allowed."));
    }
    return cb(null, true);
  },
});

const router = Router();

router.post("/admin/login", authLimiter, validate(enrollmeAdminLoginSchema), enrollmeAdminLogin);

router.get("/forms/:token", getEnrollmeFormByToken);
router.post("/forms/:token/save-step", validate(enrollmeSaveStepSchema), saveEnrollmeStep);
router.post("/forms/:token/submit-step", validate(enrollmeSaveStepSchema), submitEnrollmeStep);
router.post("/forms/:token/sign", validate(enrollmeSignatureSchema), signEnrollmeDocument);
router.post("/forms/:token/quiz/answer", validate(enrollmeQuizAnswerSchema), answerEnrollmeQuizQuestion);
router.post(
  "/forms/:token/final-acknowledgment",
  validate(enrollmeFinalAcknowledgmentSchema),
  signTrainingAcknowledgment
);
router.post("/forms/:token/submit", submitEnrollmeOnboarding);

router.use("/admin", authenticateEnrollmeAdmin);

router.post("/admin/logout", enrollmeAdminLogout);
router.get("/admin/me", enrollmeAdminMe);
router.get("/admin/dashboard", getEnrollmeDashboard);
router.post(
  "/admin/create-driver",
  requireEnrollmeRole("super_admin", "compliance_manager"),
  validate(enrollmeCreateDriverSchema),
  createEnrollmeDriver
);
router.get("/admin/drivers", listEnrollmeDrivers);
router.get("/admin/drivers/:id", getEnrollmeDriver);
router.patch(
  "/admin/drivers/:id/status",
  requireEnrollmeRole("super_admin", "compliance_manager", "reviewer"),
  validate(enrollmeStatusSchema),
  updateEnrollmeDriverStatus
);
router.post(
  "/admin/drivers/:id/request-correction",
  requireEnrollmeRole("super_admin", "compliance_manager", "reviewer"),
  validate(enrollmeCorrectionSchema),
  requestEnrollmeCorrection
);
router.post(
  "/admin/drivers/:id/notes",
  requireEnrollmeRole("super_admin", "compliance_manager", "reviewer"),
  validate(enrollmeNoteSchema),
  addEnrollmeDriverNote
);
router.post(
  "/admin/drivers/:id/uploads/:documentType",
  requireEnrollmeRole("super_admin", "compliance_manager", "reviewer"),
  upload.single("file"),
  uploadEnrollmeDriverFile
);
router.get("/admin/drivers/:id/download/:documentType", downloadEnrollmeDriverDocument);
router.get("/admin/drivers/:id/download-all", downloadEnrollmeDriverPacket);
router.get("/admin/documents", listEnrollmeDocuments);
router.get("/admin/documents/:documentType/blank", downloadBlankEnrollmeDocument);
router.get("/admin/settings", getEnrollmeSettingsController);
router.patch(
  "/admin/settings",
  requireEnrollmeRole("super_admin", "compliance_manager"),
  validate(enrollmeSettingsSchema),
  updateEnrollmeSettings
);
router.get("/admin/compliance-checklist", getEnrollmeComplianceChecklist);

export default router;
