import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import path from "path";
import config from "../config/index.js";
import { COMPLIANCE_CHECKLIST_ITEMS, ENROLLME_DOCUMENT_TYPES } from "../constants/enrollme.js";
import {
  ENROLLME_ADMIN_COOKIE,
  getEnrollmeAuthCookieOptions,
} from "../middleware/enrollmeAuth.js";
import AgreementQuizAttempt from "../models/enrollme/AgreementQuizAttempt.js";
import AuditLog from "../models/enrollme/AuditLog.js";
import DriverApplication from "../models/enrollme/DriverApplication.js";
import DriverOnboarding from "../models/enrollme/DriverOnboarding.js";
import EnrollmeAdmin from "../models/enrollme/EnrollmeAdmin.js";
import EnrollmeSettings from "../models/enrollme/EnrollmeSettings.js";
import IndependentContractorAgreementSubmission from "../models/enrollme/IndependentContractorAgreementSubmission.js";
import TrainingAcknowledgment from "../models/enrollme/TrainingAcknowledgment.js";
import ViolationCertificationAnnualReview from "../models/enrollme/ViolationCertificationAnnualReview.js";
import { recordEnrollmeAudit } from "../services/enrollmeAuditService.js";
import { assertTemplateFile, ensureDocumentTemplates } from "../services/enrollmeDocumentService.js";
import {
  buildRequiredDocumentsFromConfiguration,
  computeMissingDocuments,
  getEnrollmeSettings,
} from "../services/enrollmeOnboardingService.js";
import {
  generateEnrollmeDocumentPdf,
  streamEnrollmePacketZip,
} from "../services/enrollmePdfService.js";
import { addDays, generateOnboardingToken, hashOnboardingToken } from "../services/enrollmeTokenService.js";

function publicAdmin(admin) {
  return {
    id: admin._id?.toString?.() || admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    isActive: admin.isActive,
    lastLoginAt: admin.lastLoginAt,
  };
}

function buildOnboardingUrl(token) {
  const base = config.enrollme.frontendBaseUrl.replace(/\/+$/, "");
  return `${base}/enrollme/start/${token}`;
}

function setAdminCookie(res, token) {
  res.cookie(
    ENROLLME_ADMIN_COOKIE,
    token,
    getEnrollmeAuthCookieOptions({ maxAge: 3 * 24 * 60 * 60 * 1000 })
  );
}

export async function enrollmeAdminLogin(req, res) {
  try {
    const { email, password } = req.body;
    const admin = await EnrollmeAdmin.findOne({ email }).select("+passwordHash");
    if (!admin || !admin.isActive) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    admin.lastLoginAt = new Date();
    await admin.save();

    const token = jwt.sign(
      { adminId: admin._id.toString(), role: admin.role, scope: "enrollme_admin" },
      config.enrollme.jwt.secret,
      { expiresIn: config.enrollme.jwt.expiresIn }
    );

    setAdminCookie(res, token);
    await recordEnrollmeAudit({
      req,
      actorType: "admin",
      actorAdminId: admin._id,
      actorLabel: admin.email,
      action: "admin_login",
    });

    return res.status(200).json({ message: "Login successful.", admin: publicAdmin(admin) });
  } catch (err) {
    console.error("EnrollMe admin login failed:", err);
    return res.status(500).json({ message: "Server error while logging in." });
  }
}

export async function enrollmeAdminLogout(req, res) {
  if (req.enrollmeAdmin) {
    await recordEnrollmeAudit({
      req,
      actorType: "admin",
      actorAdminId: req.enrollmeAdmin.id,
      actorLabel: req.enrollmeAdmin.email,
      action: "admin_logout",
    });
  }
  res.clearCookie(ENROLLME_ADMIN_COOKIE, getEnrollmeAuthCookieOptions());
  return res.status(200).json({ message: "Logged out." });
}

export async function enrollmeAdminMe(req, res) {
  return res.status(200).json({ admin: req.enrollmeAdmin });
}

export async function createEnrollmeDriver(req, res) {
  try {
    const settings = await getEnrollmeSettings();
    const rawToken = generateOnboardingToken();
    const tokenExpirationDays = req.body.tokenExpirationDays || settings.tokenExpirationDays || config.enrollme.tokenExpirationDays;
    const configuration = {
      includeWc43: Boolean(req.body.configuration?.includeWc43 || settings.wc43DefaultRequired),
      cdlRequired: Boolean(req.body.configuration?.cdlRequired || settings.cdlEmploymentHistoryDefaultRequired),
      requireVehicleInspection: Boolean(req.body.configuration?.requireVehicleInspection),
      requirePreventiveMaintenance: Boolean(req.body.configuration?.requirePreventiveMaintenance),
      wheelchairAccessible: Boolean(req.body.configuration?.wheelchairAccessible),
      allowExpiredLicenseException: Boolean(req.body.configuration?.allowExpiredLicenseException),
    };
    const docs = buildRequiredDocumentsFromConfiguration(settings, configuration, req.body.requiredDocuments);

    const onboarding = await DriverOnboarding.create({
      driverFirstName: req.body.driverFirstName,
      driverMiddleName: req.body.driverMiddleName,
      driverLastName: req.body.driverLastName,
      email: req.body.email,
      phone: req.body.phone,
      status: "invited",
      onboardingTokenHash: hashOnboardingToken(rawToken),
      tokenExpiresAt: addDays(new Date(), tokenExpirationDays),
      currentStep: "identity",
      requiredDocuments: docs.requiredDocuments,
      optionalDocuments: req.body.optionalDocuments?.length ? req.body.optionalDocuments : docs.optionalDocuments,
      completedDocuments: [],
      missingDocuments: docs.requiredDocuments,
      configuration,
      createdBy: req.enrollmeAdmin.id,
    });

    await recordEnrollmeAudit({
      req,
      onboardingId: onboarding._id,
      actorType: "admin",
      actorAdminId: req.enrollmeAdmin.id,
      actorLabel: req.enrollmeAdmin.email,
      action: "admin_created_onboarding",
      metadata: { tokenExpirationDays, requiredDocuments: docs.requiredDocuments },
    });

    return res.status(201).json({
      message: "Driver onboarding record created.",
      driver: onboarding.toJSON(),
      onboardingToken: rawToken,
      onboardingPath: `/enrollme/start/${rawToken}`,
      onboardingUrl: buildOnboardingUrl(rawToken),
    });
  } catch (err) {
    console.error("Create EnrollMe driver failed:", err);
    if (err.code === 11000) {
      return res.status(409).json({ message: "A driver onboarding token conflict occurred. Please try again." });
    }
    return res.status(500).json({ message: "Server error while creating driver onboarding." });
  }
}

export async function listEnrollmeDrivers(req, res) {
  try {
    const { search = "", status = "" } = req.query;
    const query = {};
    if (status) query.status = status;
    if (search) {
      const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { driverFirstName: rx },
        { driverMiddleName: rx },
        { driverLastName: rx },
        { email: rx },
        { phone: rx },
      ];
    }

    const drivers = await DriverOnboarding.find(query).sort({ updatedAt: -1 }).limit(250).lean({ virtuals: true });
    return res.status(200).json({ count: drivers.length, drivers });
  } catch (err) {
    console.error("List EnrollMe drivers failed:", err);
    return res.status(500).json({ message: "Server error while listing drivers." });
  }
}

export async function getEnrollmeDashboard(req, res) {
  try {
    const [statusCounts, total, missingDocuments, expiringTokens, recentSubmissions] = await Promise.all([
      DriverOnboarding.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      DriverOnboarding.countDocuments(),
      DriverOnboarding.countDocuments({ missingDocuments: { $exists: true, $ne: [] } }),
      DriverOnboarding.countDocuments({
        tokenExpiresAt: { $gte: new Date(), $lte: addDays(new Date(), 3) },
        status: { $in: ["invited", "in_progress", "correction_requested"] },
      }),
      DriverOnboarding.find({ submittedAt: { $exists: true } }).sort({ submittedAt: -1 }).limit(8).lean({ virtuals: true }),
    ]);

    const byStatus = statusCounts.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    return res.status(200).json({
      total,
      byStatus,
      missingDocuments,
      expiringTokens,
      recentSubmissions,
    });
  } catch (err) {
    console.error("EnrollMe dashboard failed:", err);
    return res.status(500).json({ message: "Server error while loading dashboard." });
  }
}

export async function getEnrollmeDriver(req, res) {
  try {
    const { id } = req.params;
    const [driver, application, agreement, quiz, training, violation, auditLogs] = await Promise.all([
      DriverOnboarding.findById(id).lean({ virtuals: true }),
      DriverApplication.findOne({ onboardingId: id }).lean(),
      IndependentContractorAgreementSubmission.findOne({ onboardingId: id }).lean(),
      AgreementQuizAttempt.findOne({ onboardingId: id }).lean(),
      TrainingAcknowledgment.findOne({ onboardingId: id }).lean(),
      ViolationCertificationAnnualReview.findOne({ onboardingId: id }).lean(),
      AuditLog.find({ onboardingId: id }).sort({ createdAt: -1 }).limit(100).lean(),
    ]);

    if (!driver) return res.status(404).json({ message: "Driver onboarding record not found." });

    return res.status(200).json({
      driver,
      documents: { application, agreement, quiz, training, violation },
      auditLogs,
    });
  } catch (err) {
    console.error("Get EnrollMe driver failed:", err);
    return res.status(500).json({ message: "Server error while loading driver." });
  }
}

export async function updateEnrollmeDriverStatus(req, res) {
  try {
    const driver = await DriverOnboarding.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: "Driver onboarding record not found." });

    driver.status = req.body.status;
    driver.reviewedBy = req.enrollmeAdmin.id;

    if (req.body.status === "approved") {
      driver.approvedBy = req.enrollmeAdmin.id;
      driver.approvedAt = new Date();
    }
    if (req.body.status === "rejected") driver.rejectedAt = new Date();
    if (req.body.status === "archived") driver.archivedAt = new Date();
    if (req.body.note) {
      driver.adminNotes.push({ note: req.body.note, createdBy: req.enrollmeAdmin.id });
    }

    await driver.save();
    await recordEnrollmeAudit({
      req,
      onboardingId: driver._id,
      actorType: "admin",
      actorAdminId: req.enrollmeAdmin.id,
      actorLabel: req.enrollmeAdmin.email,
      action: `admin_set_status_${req.body.status}`,
      metadata: { note: req.body.note },
    });

    return res.status(200).json({ message: "Status updated.", driver });
  } catch (err) {
    console.error("Update EnrollMe status failed:", err);
    return res.status(500).json({ message: "Server error while updating status." });
  }
}

export async function requestEnrollmeCorrection(req, res) {
  try {
    const driver = await DriverOnboarding.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: "Driver onboarding record not found." });

    driver.status = "correction_requested";
    driver.correctionRequests.push({
      message: req.body.message,
      fields: req.body.fields || [],
      createdBy: req.enrollmeAdmin.id,
    });
    await driver.save();

    await recordEnrollmeAudit({
      req,
      onboardingId: driver._id,
      actorType: "admin",
      actorAdminId: req.enrollmeAdmin.id,
      actorLabel: req.enrollmeAdmin.email,
      action: "admin_requested_correction",
      metadata: { message: req.body.message, fields: req.body.fields || [] },
    });

    return res.status(200).json({ message: "Correction requested.", driver });
  } catch (err) {
    console.error("Request EnrollMe correction failed:", err);
    return res.status(500).json({ message: "Server error while requesting correction." });
  }
}

export async function addEnrollmeDriverNote(req, res) {
  try {
    const driver = await DriverOnboarding.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: "Driver onboarding record not found." });
    driver.adminNotes.push({ note: req.body.note, createdBy: req.enrollmeAdmin.id });
    await driver.save();
    await recordEnrollmeAudit({
      req,
      onboardingId: driver._id,
      actorType: "admin",
      actorAdminId: req.enrollmeAdmin.id,
      actorLabel: req.enrollmeAdmin.email,
      action: "admin_added_note",
    });
    return res.status(201).json({ message: "Note added.", driver });
  } catch (err) {
    console.error("Add EnrollMe note failed:", err);
    return res.status(500).json({ message: "Server error while adding note." });
  }
}

export async function uploadEnrollmeDriverFile(req, res) {
  try {
    const driver = await DriverOnboarding.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: "Driver onboarding record not found." });
    if (!req.file) return res.status(400).json({ message: "File is required." });

    const fileRef = {
      originalName: req.file.originalname,
      storedName: req.file.filename,
      path: req.file.path,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.enrollmeAdmin.id,
      documentType: req.params.documentType,
      notes: req.body?.notes,
    };
    driver.uploadedFiles.push(fileRef);
    if (!driver.completedDocuments.includes(req.params.documentType)) {
      driver.completedDocuments.push(req.params.documentType);
    }
    driver.missingDocuments = computeMissingDocuments(driver.requiredDocuments, driver.completedDocuments);
    await driver.save();

    await recordEnrollmeAudit({
      req,
      onboardingId: driver._id,
      actorType: "admin",
      actorAdminId: req.enrollmeAdmin.id,
      actorLabel: req.enrollmeAdmin.email,
      action: "admin_uploaded_document",
      documentType: req.params.documentType,
      metadata: { originalName: req.file.originalname, size: req.file.size },
    });

    return res.status(201).json({ message: "File uploaded.", file: fileRef, driver });
  } catch (err) {
    console.error("Upload EnrollMe file failed:", err);
    return res.status(500).json({ message: "Server error while uploading file." });
  }
}

export async function listEnrollmeDocuments(_req, res) {
  try {
    const documents = await ensureDocumentTemplates();
    return res.status(200).json({ documents });
  } catch (err) {
    console.error("List EnrollMe documents failed:", err);
    return res.status(500).json({ message: "Server error while loading documents." });
  }
}

export async function downloadBlankEnrollmeDocument(req, res) {
  try {
    const { template, absolutePath } = await assertTemplateFile(req.params.documentType);
    return res.download(absolutePath, template.originalFileName || path.basename(absolutePath));
  } catch (err) {
    console.error("Download blank EnrollMe document failed:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Unable to download document." });
  }
}

export async function downloadEnrollmeDriverDocument(req, res) {
  try {
    const { id, documentType } = req.params;
    const buffer = await generateEnrollmeDocumentPdf(id, documentType);
    const filename = `${documentType}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await recordEnrollmeAudit({
      req,
      onboardingId: id,
      actorType: "admin",
      actorAdminId: req.enrollmeAdmin.id,
      actorLabel: req.enrollmeAdmin.email,
      action: "admin_downloaded_document",
      documentType,
    });
    return res.end(buffer);
  } catch (err) {
    console.error("Download EnrollMe generated document failed:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Unable to download generated document." });
  }
}

export async function downloadEnrollmeDriverPacket(req, res) {
  try {
    await recordEnrollmeAudit({
      req,
      onboardingId: req.params.id,
      actorType: "admin",
      actorAdminId: req.enrollmeAdmin.id,
      actorLabel: req.enrollmeAdmin.email,
      action: "admin_downloaded_packet",
    });
    return streamEnrollmePacketZip(res, req.params.id);
  } catch (err) {
    console.error("Download EnrollMe packet failed:", err);
    if (!res.headersSent) {
      return res.status(err.statusCode || 500).json({ message: err.message || "Unable to download packet." });
    }
  }
}

export async function getEnrollmeSettingsController(_req, res) {
  try {
    const settings = await getEnrollmeSettings();
    return res.status(200).json({ settings });
  } catch (err) {
    console.error("Get EnrollMe settings failed:", err);
    return res.status(500).json({ message: "Server error while loading settings." });
  }
}

export async function updateEnrollmeSettings(req, res) {
  try {
    const update = { ...req.body, updatedBy: req.enrollmeAdmin.id };
    const settings = await EnrollmeSettings.findOneAndUpdate(
      { singletonKey: "global" },
      { $set: update, $setOnInsert: { singletonKey: "global" } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    await recordEnrollmeAudit({
      req,
      actorType: "admin",
      actorAdminId: req.enrollmeAdmin.id,
      actorLabel: req.enrollmeAdmin.email,
      action: "admin_updated_settings",
      metadata: update,
    });
    return res.status(200).json({ message: "Settings updated.", settings });
  } catch (err) {
    console.error("Update EnrollMe settings failed:", err);
    return res.status(500).json({ message: "Server error while updating settings." });
  }
}

export async function getEnrollmeComplianceChecklist(_req, res) {
  return res.status(200).json({
    disclaimer:
      "This checklist is an operational compliance aid and does not replace Colorado PUC, FMCSA, insurance, airport, legal, or counsel review.",
    items: COMPLIANCE_CHECKLIST_ITEMS,
  });
}
