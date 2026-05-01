import AuditLog from "../models/enrollme/AuditLog.js";

export async function recordEnrollmeAudit({
  req,
  onboardingId,
  actorType = "system",
  actorAdminId,
  actorLabel,
  action,
  documentType,
  metadata = {},
}) {
  try {
    await AuditLog.create({
      onboardingId,
      actorType,
      actorAdminId,
      actorLabel,
      action,
      documentType,
      metadata,
      ipAddress: req?.ip,
      userAgent: req?.get?.("user-agent"),
    });
  } catch (err) {
    // Audit write failure should not block the user workflow, but it should be visible in logs.
    console.warn("EnrollMe audit write failed:", err.message);
  }
}
