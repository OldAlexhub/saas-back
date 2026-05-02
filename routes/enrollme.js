import { Router } from "express";
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
  updateEnrollmeAdminChecklistItem,
  updateEnrollmeDriverStatus,
  updateEnrollmeSettings,
} from "../controllers/EnrollmeAdmin.js";
import {
  answerEnrollmeQuizQuestion,
  getEnrollmeFormByToken,
  reviewEnrollmeDocument,
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
  enrollmeAdminChecklistSchema,
  enrollmeAdminLoginSchema,
  enrollmeCorrectionSchema,
  enrollmeCreateDriverSchema,
  enrollmeDocumentReviewSchema,
  enrollmeFinalAcknowledgmentSchema,
  enrollmeNoteSchema,
  enrollmeQuizAnswerSchema,
  enrollmeSaveStepSchema,
  enrollmeSettingsSchema,
  enrollmeSignatureSchema,
  enrollmeStatusSchema,
} from "../validators/enrollmeSchemas.js";

const router = Router();

router.post("/admin/login", authLimiter, validate(enrollmeAdminLoginSchema), enrollmeAdminLogin);

router.get("/forms/:token", getEnrollmeFormByToken);
router.post("/forms/:token/save-step", validate(enrollmeSaveStepSchema), saveEnrollmeStep);
router.post("/forms/:token/submit-step", validate(enrollmeSaveStepSchema), submitEnrollmeStep);
router.post("/forms/:token/review-document", validate(enrollmeDocumentReviewSchema), reviewEnrollmeDocument);
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
router.patch(
  "/admin/drivers/:id/admin-checklist",
  requireEnrollmeRole("super_admin", "compliance_manager", "reviewer"),
  validate(enrollmeAdminChecklistSchema),
  updateEnrollmeAdminChecklistItem
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
