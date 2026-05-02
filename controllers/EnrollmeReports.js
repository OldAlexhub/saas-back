import DriverOnboarding from "../models/enrollme/DriverOnboarding.js";
import {
  buildAdminComplianceChecklist,
  computePacketReadiness,
} from "../services/enrollmeOnboardingService.js";

// ── CSV helpers ───────────────────────────────────────────────────────────────

function csvEscape(val) {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\n");
}

function sendCsv(res, filename, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.end(csv);
}

function isoDate(val) {
  if (!val) return "";
  try {
    return new Date(val).toISOString();
  } catch {
    return "";
  }
}

// ── Query builder ─────────────────────────────────────────────────────────────

function buildFilter(query) {
  const filter = {};

  if (query.status) {
    filter.status = query.status;
  } else if (query.includeArchived !== "true") {
    filter.status = { $ne: "archived" };
  }

  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) {
      const to = new Date(query.dateTo);
      to.setUTCHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }

  return filter;
}

function fullName(d) {
  return [d.driverFirstName, d.driverMiddleName, d.driverLastName].filter(Boolean).join(" ");
}

// ── Report handlers ───────────────────────────────────────────────────────────

export async function downloadDriverMasterCsv(req, res) {
  try {
    const drivers = await DriverOnboarding.find(buildFilter(req.query))
      .sort({ createdAt: -1 })
      .lean({ virtuals: true });

    const headers = [
      "driver_id", "first_name", "middle_name", "last_name", "full_name",
      "email", "phone", "status",
      "token_created_at", "token_expires_at",
      "submitted_at", "approved_at",
      "include_wc43", "cdl_required", "require_vehicle_inspection",
      "require_preventive_maintenance", "wheelchair_accessible",
    ];

    const rows = drivers.map((d) => [
      d._id,
      d.driverFirstName,
      d.driverMiddleName || "",
      d.driverLastName,
      fullName(d),
      d.email,
      d.phone || "",
      d.status,
      isoDate(d.createdAt),
      isoDate(d.tokenExpiresAt),
      isoDate(d.submittedAt),
      isoDate(d.approvedAt),
      d.configuration?.includeWc43 ? "yes" : "no",
      d.configuration?.cdlRequired ? "yes" : "no",
      d.configuration?.requireVehicleInspection ? "yes" : "no",
      d.configuration?.requirePreventiveMaintenance ? "yes" : "no",
      d.configuration?.wheelchairAccessible ? "yes" : "no",
    ]);

    return sendCsv(res, "driver-master.csv", toCsv(headers, rows));
  } catch (err) {
    console.error("Driver master CSV failed:", err);
    return res.status(500).json({ message: "Server error generating driver master report." });
  }
}

export async function downloadPacketStatusCsv(req, res) {
  try {
    const drivers = await DriverOnboarding.find(buildFilter(req.query))
      .sort({ updatedAt: -1 })
      .lean({ virtuals: true });

    const headers = [
      "driver_id", "driver_full_name", "status",
      "driver_side_complete", "missing_driver_documents",
      "admin_checklist_complete", "admin_pending_items",
      "government_ready", "approved_to_operate",
      "last_updated_at",
    ];

    const rows = drivers.map((d) => {
      const withChecklist = {
        ...d,
        adminComplianceChecklist: buildAdminComplianceChecklist(d.configuration, d.adminComplianceChecklist),
      };
      const readiness = computePacketReadiness(withChecklist);
      return [
        d._id,
        fullName(d),
        d.status,
        readiness.driverSideComplete ? "yes" : "no",
        (readiness.missingDriverDocuments || []).join("; "),
        readiness.adminChecklistComplete ? "yes" : "no",
        (readiness.adminItemsPending || []).length,
        readiness.governmentReady ? "yes" : "no",
        d.status === "approved_to_operate" ? "yes" : "no",
        isoDate(d.updatedAt),
      ];
    });

    return sendCsv(res, "packet-status.csv", toCsv(headers, rows));
  } catch (err) {
    console.error("Packet status CSV failed:", err);
    return res.status(500).json({ message: "Server error generating packet status report." });
  }
}

export async function downloadAdminChecklistCsv(req, res) {
  try {
    const drivers = await DriverOnboarding.find(buildFilter(req.query))
      .sort({ createdAt: -1 })
      .lean({ virtuals: true });

    const headers = [
      "driver_id", "driver_full_name",
      "checklist_item_key", "checklist_item_label", "category",
      "required", "status", "expires_at", "notes", "updated_at",
    ];

    const rows = [];
    for (const d of drivers) {
      const checklist = buildAdminComplianceChecklist(d.configuration, d.adminComplianceChecklist);
      for (const item of checklist) {
        rows.push([
          d._id,
          fullName(d),
          item.key,
          item.label,
          item.category || "Compliance",
          item.required ? "yes" : "no",
          item.status || "pending",
          isoDate(item.expiresAt),
          item.notes || "",
          isoDate(item.updatedAt),
        ]);
      }
    }

    return sendCsv(res, "admin-checklist.csv", toCsv(headers, rows));
  } catch (err) {
    console.error("Admin checklist CSV failed:", err);
    return res.status(500).json({ message: "Server error generating admin checklist report." });
  }
}

export async function downloadExpirationsCsv(req, res) {
  try {
    const drivers = await DriverOnboarding.find(buildFilter(req.query))
      .sort({ createdAt: -1 })
      .lean({ virtuals: true });

    const headers = [
      "driver_id", "driver_full_name",
      "item_label", "category", "status",
      "expires_at", "days_until_expiration", "is_expired",
    ];

    const now = new Date();
    const rows = [];
    for (const d of drivers) {
      const checklist = buildAdminComplianceChecklist(d.configuration, d.adminComplianceChecklist);
      for (const item of checklist) {
        if (!item.expiresAt) continue;
        const expiresAt = new Date(item.expiresAt);
        const daysUntil = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
        rows.push([
          d._id,
          fullName(d),
          item.label,
          item.category || "Compliance",
          item.status || "pending",
          isoDate(item.expiresAt),
          daysUntil,
          expiresAt < now ? "yes" : "no",
        ]);
      }
    }

    // Sort: expired first, then soonest expiring
    rows.sort((a, b) => Number(a[6]) - Number(b[6]));

    return sendCsv(res, "expiration-report.csv", toCsv(headers, rows));
  } catch (err) {
    console.error("Expirations CSV failed:", err);
    return res.status(500).json({ message: "Server error generating expiration report." });
  }
}

export async function downloadComplianceSummaryCsv(req, res) {
  try {
    const drivers = await DriverOnboarding.find(buildFilter(req.query))
      .sort({ createdAt: -1 })
      .lean({ virtuals: true });

    const headers = [
      "driver_id", "driver_full_name", "status",
      "required_documents_count", "completed_driver_documents_count",
      "admin_required_items_count", "admin_verified_count", "admin_expired_count",
      "correction_requested", "government_ready", "approved_to_operate",
    ];

    const rows = drivers.map((d) => {
      const checklist = buildAdminComplianceChecklist(d.configuration, d.adminComplianceChecklist);
      const withChecklist = { ...d, adminComplianceChecklist: checklist };
      const readiness = computePacketReadiness(withChecklist);

      const adminRequired = checklist.filter((i) => i.required);
      const adminVerified = adminRequired.filter((i) => i.status === "verified").length;
      const adminExpired = checklist.filter((i) => i.status === "expired").length;
      const hasCorrectionOpen = (d.correctionRequests || []).some((r) => r.status === "open");

      return [
        d._id,
        fullName(d),
        d.status,
        (d.requiredDocuments || []).length,
        (d.completedDocuments || []).length,
        adminRequired.length,
        adminVerified,
        adminExpired,
        hasCorrectionOpen ? "yes" : "no",
        readiness.governmentReady ? "yes" : "no",
        d.status === "approved_to_operate" ? "yes" : "no",
      ];
    });

    return sendCsv(res, "compliance-summary.csv", toCsv(headers, rows));
  } catch (err) {
    console.error("Compliance summary CSV failed:", err);
    return res.status(500).json({ message: "Server error generating compliance summary report." });
  }
}
