import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import path from "path";
import config from "../config/index.js";
import { COMPLIANCE_CHECKLIST_ITEMS } from "../constants/enrollme.js";
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
import DriverModel from "../models/DriverSchema.js";
import { recordEnrollmeAudit } from "../services/enrollmeAuditService.js";
import { assertTemplateFile, ensureDocumentTemplates } from "../services/enrollmeDocumentService.js";
import {
  buildAdminComplianceChecklist,
  buildRequiredDocumentsFromConfiguration,
  computePacketReadiness,
  computeMissingDocuments,
  getEnrollmeSettings,
  refreshOnboardingReadiness,
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

function publicDriver(driver) {
  const json = driver.toJSON ? driver.toJSON() : { ...driver };
  delete json.onboardingTokenHash;
  json.adminComplianceChecklist = buildAdminComplianceChecklist(json.configuration, json.adminComplianceChecklist);
  json.packetReadiness = computePacketReadiness(json);
  return json;
}

function buildOnboardingUrl(token, req) {
  const requestOrigin = req?.get?.("origin");
  const configuredBase = process.env.ENROLLME_FRONTEND_URL || "";
  const base = (configuredBase || requestOrigin || config.enrollme.frontendBaseUrl).replace(/\/+$/, "");
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
      adminComplianceChecklist: buildAdminComplianceChecklist(configuration),
      createdBy: req.enrollmeAdmin.id,
    });

    await recordEnrollmeAudit({
      req,
      onboardingId: onboarding._id,
      actorType: "admin",
      actorAdminId: req.enrollmeAdmin.id,
      actorLabel: req.enrollmeAdmin.email,
      action: "onboarding_created",
      metadata: { tokenExpirationDays, requiredDocuments: docs.requiredDocuments },
    });

    return res.status(201).json({
      message: "Driver onboarding record created.",
      driver: publicDriver(onboarding),
      onboardingToken: rawToken,
      onboardingPath: `/enrollme/start/${rawToken}`,
      onboardingUrl: buildOnboardingUrl(rawToken, req),
    });
  } catch (err) {
    console.error("Create EnrollMe driver failed:", err);
    if (err.code === 11000) {
      return res.status(409).json({ message: "A driver onboarding token conflict occurred. Please try again." });
    }
    return res.status(500).json({ message: "Server error while creating driver onboarding." });
  }
}

export async function regenerateEnrollmeLink(req, res) {
  try {
    const driver = await DriverOnboarding.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: "Driver onboarding record not found." });

    const terminalStatuses = new Set(["approved_to_operate", "rejected", "archived", "inactive"]);
    if (terminalStatuses.has(driver.status)) {
      return res.status(400).json({ message: `Cannot regenerate link for a driver with status '${driver.status}'.` });
    }

    const settings = await getEnrollmeSettings();
    const tokenExpirationDays =
      req.body.tokenExpirationDays ||
      settings.tokenExpirationDays ||
      config.enrollme.tokenExpirationDays;

    const rawToken = generateOnboardingToken();
    driver.onboardingTokenHash = hashOnboardingToken(rawToken);
    driver.tokenExpiresAt = addDays(new Date(), tokenExpirationDays);
    await driver.save();

    await recordEnrollmeAudit({
      req,
      onboardingId: driver._id,
      actorType: "admin",
      actorAdminId: req.enrollmeAdmin.id,
      actorLabel: req.enrollmeAdmin.email,
      action: "onboarding_link_regenerated",
      metadata: { tokenExpirationDays },
    });

    return res.status(200).json({
      message: "Enrollment link regenerated.",
      driver: publicDriver(driver),
      onboardingToken: rawToken,
      onboardingPath: `/enrollme/start/${rawToken}`,
      onboardingUrl: buildOnboardingUrl(rawToken, req),
    });
  } catch (err) {
    console.error("Regenerate EnrollMe link failed:", err);
    return res.status(500).json({ message: "Server error while regenerating enrollment link." });
  }
}

export async function updateEnrollmeDriverProfile(req, res) {
  try {
    const driver = await DriverOnboarding.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: "Driver onboarding record not found." });

    if (req.body.driverFirstName !== undefined) driver.driverFirstName = req.body.driverFirstName;
    if (req.body.driverMiddleName !== undefined) driver.driverMiddleName = req.body.driverMiddleName;
    if (req.body.driverLastName !== undefined) driver.driverLastName = req.body.driverLastName;
    if (req.body.email !== undefined) driver.email = req.body.email;
    if (req.body.phone !== undefined) driver.phone = req.body.phone;
    await driver.save();

    // Sync to DriverApplication if it exists
    const applicationUpdates = {};
    if (req.body.driverFirstName !== undefined) applicationUpdates["applicant.firstName"] = req.body.driverFirstName;
    if (req.body.driverMiddleName !== undefined) applicationUpdates["applicant.middleName"] = req.body.driverMiddleName;
    if (req.body.driverLastName !== undefined) applicationUpdates["applicant.lastName"] = req.body.driverLastName;
    if (req.body.email !== undefined) applicationUpdates["applicant.email"] = req.body.email;
    if (req.body.phone !== undefined) applicationUpdates["applicant.phone"] = req.body.phone;
    if (Object.keys(applicationUpdates).length > 0) {
      await DriverApplication.updateOne({ onboardingId: driver._id }, { $set: applicationUpdates });
    }

    // Sync to main Driver record if this driver was imported
    const mainDriverUpdates = {};
    if (req.body.driverFirstName !== undefined) mainDriverUpdates.firstName = req.body.driverFirstName;
    if (req.body.driverLastName !== undefined) mainDriverUpdates.lastName = req.body.driverLastName;
    if (req.body.email !== undefined) mainDriverUpdates.email = req.body.email;
    if (req.body.phone !== undefined) mainDriverUpdates.phoneNumber = req.body.phone;
    if (Object.keys(mainDriverUpdates).length > 0) {
      try {
        await DriverModel.findOneAndUpdate(
          { "enrollmeSource.onboardingId": driver._id },
          { $set: mainDriverUpdates }
        );
      } catch (syncErr) {
        console.warn("EnrollMe profile update: main Driver sync failed (non-fatal):", syncErr.message);
      }
    }

    await recordEnrollmeAudit({
      req,
      onboardingId: driver._id,
      actorType: "admin",
      actorAdminId: req.enrollmeAdmin.id,
      actorLabel: req.enrollmeAdmin.email,
      action: "driver_profile_updated",
      metadata: { fields: Object.keys(req.body) },
    });

    return res.status(200).json({ message: "Driver profile updated.", driver: publicDriver(driver) });
  } catch (err) {
    console.error("Update EnrollMe driver profile failed:", err);
    if (err.code === 11000) {
      return res.status(409).json({ message: "That email is already in use by another record." });
    }
    return res.status(500).json({ message: "Server error while updating driver profile." });
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
    return res.status(200).json({ count: drivers.length, drivers: drivers.map(publicDriver) });
  } catch (err) {
    console.error("List EnrollMe drivers failed:", err);
    return res.status(500).json({ message: "Server error while listing drivers." });
  }
}

export async function getEnrollmeDashboard(req, res) {
  try {
    const [statusCounts, total, expiringTokens, recentSubmissions, allDrivers] = await Promise.all([
      DriverOnboarding.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      DriverOnboarding.countDocuments(),
      DriverOnboarding.countDocuments({
        tokenExpiresAt: { $gte: new Date(), $lte: addDays(new Date(), 3) },
        status: { $in: ["invited", "in_progress", "correction_requested"] },
      }),
      DriverOnboarding.find({ submittedAt: { $exists: true } }).sort({ submittedAt: -1 }).limit(8).lean({ virtuals: true }),
      DriverOnboarding.find({ status: { $nin: ["archived", "rejected"] } })
        .select("requiredDocuments completedDocuments adminComplianceChecklist configuration")
        .lean({ virtuals: true }),
    ]);

    const byStatus = statusCounts.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    const readinessRows = allDrivers.map((driver) => computePacketReadiness(driver));
    const recordsWithAdminItemsPending = readinessRows.filter((readiness) => readiness.adminItemsPending.length > 0).length;
    const driverMissingDocuments = readinessRows.filter((readiness) => readiness.missingDriverDocuments.length > 0).length;

    return res.status(200).json({
      total,
      byStatus,
      driverMissingDocuments,
      expiringTokens,
      recordsWithAdminItemsPending,
      recentSubmissions: recentSubmissions.map(publicDriver),
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
      driver: publicDriver(driver),
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

    driver.adminComplianceChecklist = buildAdminComplianceChecklist(driver.configuration, driver.adminComplianceChecklist);
    driver.missingDocuments = computeMissingDocuments(driver.requiredDocuments, driver.completedDocuments);
    const readiness = computePacketReadiness(driver);
    const requestedStatus = req.body.status;

    if (["government_ready", "approved_to_operate"].includes(requestedStatus) && !readiness.governmentReady) {
      return res.status(400).json({
        message: "Packet is not government-ready. Complete driver-required documents and verify required admin checklist items first.",
        readiness,
      });
    }

    if (["admin_review_pending", "admin_items_pending"].includes(requestedStatus) && !readiness.driverSideComplete) {
      return res.status(400).json({
        message: "Driver-side packet is not complete yet.",
        readiness,
      });
    }

    const previousStatus = driver.status;
    driver.status = req.body.status;
    driver.reviewedBy = req.enrollmeAdmin.id;

    if (req.body.status === "approved_to_operate") {
      driver.approvedBy = req.enrollmeAdmin.id;
      driver.approvedAt = new Date();
    }
    if (req.body.status === "rejected") driver.rejectedAt = new Date();
    if (req.body.status === "archived") driver.archivedAt = new Date();
    if (req.body.status === "inactive") {
      driver.inactivatedAt = new Date();
      driver.inactivatedBy = req.enrollmeAdmin.id;
      // Sync inactive status to the main Driver record if this driver was imported
      try {
        await DriverModel.findOneAndUpdate(
          { "enrollmeSource.onboardingId": driver._id },
          { $set: { status: "inactive" } }
        );
      } catch (syncErr) {
        console.warn("EnrollMe deactivate: main Driver sync failed (non-fatal):", syncErr.message);
      }
    }
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
      action: "status_changed",
      metadata: { note: req.body.note, previousStatus, status: req.body.status },
    });

    return res.status(200).json({ message: "Status updated.", driver: publicDriver(driver) });
  } catch (err) {
    console.error("Update EnrollMe status failed:", err);
    return res.status(500).json({ message: "Server error while updating status." });
  }
}

function correctionTargets(fields = []) {
  const documentTypes = new Set();
  const steps = [];
  for (const field of fields) {
    if (["driver_application", "license_data"].includes(field)) {
      documentTypes.add("driver_application");
      steps.push("employment-application");
    }
    if (field === "employment_history") {
      documentTypes.add("driver_application");
      steps.push("employment-history");
    }
    if (field === "accident_violation_history") {
      documentTypes.add("violation_certification_annual_review");
      steps.push("accident-violation-history");
    }
    if (field === "independent_contractor_agreement_data") {
      documentTypes.add("independent_contractor_agreement");
      steps.push("agreement");
    }
    if (field === "signature_issue") {
      documentTypes.add("driver_application");
      documentTypes.add("independent_contractor_agreement");
      steps.push("employment-history");
    }
    if (field === "training_quiz_issue") {
      documentTypes.add("agreement_quiz");
      documentTypes.add("training_acknowledgment");
      steps.push("quiz");
    }
  }
  return { documentTypes: [...documentTypes], step: steps[0] || "identity" };
}

export async function requestEnrollmeCorrection(req, res) {
  try {
    const driver = await DriverOnboarding.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: "Driver onboarding record not found." });

    const targets = correctionTargets(req.body.fields || []);
    driver.status = "correction_requested";
    driver.currentStep = targets.step;
    if (targets.documentTypes.length) {
      driver.completedDocuments = driver.completedDocuments.filter((item) => !targets.documentTypes.includes(item));
      driver.missingDocuments = computeMissingDocuments(driver.requiredDocuments, driver.completedDocuments);
    }
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
      action: "correction_requested",
      metadata: { message: req.body.message, fields: req.body.fields || [], reopenedStep: driver.currentStep },
    });

    return res.status(200).json({ message: "Correction requested.", driver: publicDriver(driver) });
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
      action: "admin_note_added",
    });
    return res.status(201).json({ message: "Note added.", driver: publicDriver(driver) });
  } catch (err) {
    console.error("Add EnrollMe note failed:", err);
    return res.status(500).json({ message: "Server error while adding note." });
  }
}

const CHECKLIST_EXPIRY_TO_DRIVER_FIELD = {
  driver_license_copy: "dlExpiry",
  medical_certificate: "dotExpiry",
  background_check: "cbiExpiry",
  mvr: "mvrExpiry",
  fingerprint_qualification: "fingerPrintsExpiry",
};

export async function updateEnrollmeAdminChecklistItem(req, res) {
  try {
    const driver = await DriverOnboarding.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: "Driver onboarding record not found." });
    driver.adminComplianceChecklist = buildAdminComplianceChecklist(driver.configuration, driver.adminComplianceChecklist);
    const item = driver.adminComplianceChecklist.find((entry) => entry.key === req.body.key);
    if (!item) return res.status(404).json({ message: "Admin checklist item not found." });

    item.status = req.body.status;
    item.notes = req.body.notes || "";
    item.expiresAt = req.body.expiresAt || undefined;
    item.updatedBy = req.enrollmeAdmin.id;
    item.updatedAt = new Date();
    await driver.save();

    // Sync expiry date to main Driver record if this checklist item maps to a Driver compliance field
    const driverField = CHECKLIST_EXPIRY_TO_DRIVER_FIELD[req.body.key];
    if (driverField && req.body.expiresAt) {
      try {
        await DriverModel.findOneAndUpdate(
          { "enrollmeSource.onboardingId": driver._id },
          { $set: { [driverField]: new Date(req.body.expiresAt) } }
        );
      } catch (syncErr) {
        console.warn(`EnrollMe checklist sync to Driver.${driverField} failed (non-fatal):`, syncErr.message);
      }
    }

    const refreshed = await refreshOnboardingReadiness(driver._id);

    await recordEnrollmeAudit({
      req,
      onboardingId: driver._id,
      actorType: "admin",
      actorAdminId: req.enrollmeAdmin.id,
      actorLabel: req.enrollmeAdmin.email,
      action: "admin_checklist_updated",
      metadata: { key: req.body.key, status: req.body.status, notes: req.body.notes, synced: driverField || null },
    });

    return res.status(200).json({ message: "Admin checklist updated.", driver: publicDriver(refreshed || driver) });
  } catch (err) {
    console.error("Update EnrollMe admin checklist failed:", err);
    return res.status(500).json({ message: "Server error while updating admin checklist." });
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
      action: "packet_downloaded",
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
      action: "packet_downloaded",
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

export async function listEnrollmeAdminsController(_req, res) {
  try {
    const admins = await EnrollmeAdmin.find().sort({ createdAt: -1 }).lean();
    return res.json({ admins: admins.map(publicAdmin) });
  } catch (err) {
    console.error("List EnrollMe admins failed:", err);
    return res.status(500).json({ message: "Failed to fetch EnrollMe admins." });
  }
}

export async function createEnrollmeAdminController(req, res) {
  try {
    const { name, email, password, role } = req.body;
    const existing = await EnrollmeAdmin.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "An admin with that email already exists." });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await EnrollmeAdmin.create({ name, email, passwordHash, role: role || "reviewer", isActive: true });
    return res.status(201).json({ message: "Admin created.", admin: publicAdmin(admin) });
  } catch (err) {
    console.error("Create EnrollMe admin failed:", err);
    return res.status(500).json({ message: "Failed to create EnrollMe admin." });
  }
}

export async function updateEnrollmeAdminController(req, res) {
  try {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.role !== undefined) updates.role = req.body.role;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
    const admin = await EnrollmeAdmin.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!admin) return res.status(404).json({ message: "Admin not found." });
    return res.json({ admin: publicAdmin(admin) });
  } catch (err) {
    console.error("Update EnrollMe admin failed:", err);
    return res.status(500).json({ message: "Failed to update EnrollMe admin." });
  }
}

export async function deleteEnrollmeAdminController(req, res) {
  try {
    const admin = await EnrollmeAdmin.findByIdAndDelete(req.params.id);
    if (!admin) return res.status(404).json({ message: "Admin not found." });
    return res.json({ message: "Admin deleted." });
  } catch (err) {
    console.error("Delete EnrollMe admin failed:", err);
    return res.status(500).json({ message: "Failed to delete EnrollMe admin." });
  }
}
