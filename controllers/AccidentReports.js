import AccidentReport from "../models/AccidentReport.js";
import DriverModel from "../models/DriverSchema.js";
import VehicleModel from "../models/VehicleSchema.js";

async function generateReportNumber() {
  const count = await AccidentReport.countDocuments();
  return `ACC-${String(count + 1).padStart(5, "0")}`;
}

function sanitize(report) {
  const obj = report.toJSON ? report.toJSON() : { ...report };
  return obj;
}

export async function createAccidentReport(req, res) {
  try {
    const body = req.body;

    // Resolve driver snapshot if a driverRef was provided
    let driverName = body.driverName || "";
    let driverIdNumber = body.driverIdNumber || "";
    let driverRef = body.driverRef || undefined;

    if (driverRef) {
      const driver = await DriverModel.findById(driverRef).lean();
      if (driver) {
        driverName = driverName || `${driver.firstName} ${driver.lastName}`;
        driverIdNumber = driverIdNumber || driver.driverId;
      }
    }

    // Resolve vehicle snapshot if a vehicleRef was provided
    let vehiclePlate = body.vehiclePlate || "";
    let vehicleDescription = body.vehicleDescription || "";
    let vehicleRef = body.vehicleRef || undefined;

    if (vehicleRef) {
      const vehicle = await VehicleModel.findById(vehicleRef).lean();
      if (vehicle) {
        vehiclePlate = vehiclePlate || vehicle.licPlates || "";
        vehicleDescription =
          vehicleDescription ||
          [vehicle.year, vehicle.make, vehicle.model, vehicle.cabNumber ? `Cab #${vehicle.cabNumber}` : ""]
            .filter(Boolean)
            .join(" ");
      }
    }

    const reportNumber = await generateReportNumber();

    const report = await AccidentReport.create({
      reportNumber,
      incidentDate: body.incidentDate,
      incidentTime: body.incidentTime,
      location: body.location,
      type: body.type,
      description: body.description,
      driverRef,
      driverName,
      driverIdNumber,
      vehicleRef,
      vehiclePlate,
      vehicleDescription,
      passengersInvolved: Boolean(body.passengersInvolved),
      passengerInjuries: body.passengerInjuries || "",
      thirdPartyInvolved: Boolean(body.thirdPartyInvolved),
      thirdPartyInfo: body.thirdPartyInfo || "",
      policeInvolved: Boolean(body.policeInvolved),
      policeReportNumber: body.policeReportNumber || "",
      injuries: Boolean(body.injuries),
      injuryDescription: body.injuryDescription || "",
      propertyDamage: Boolean(body.propertyDamage),
      damageDescription: body.damageDescription || "",
      insuranceClaimed: Boolean(body.insuranceClaimed),
      insuranceClaimNumber: body.insuranceClaimNumber || "",
      status: "open",
      reportedBy: req.user?.email || "admin",
    });

    return res.status(201).json({ message: "Accident report filed.", report: sanitize(report) });
  } catch (err) {
    console.error("Create accident report failed:", err);
    return res.status(500).json({ message: "Server error while filing accident report." });
  }
}

export async function listAccidentReports(req, res) {
  try {
    const { type, status, driver, from, to, search } = req.query;

    const query = {};
    if (type) query.type = type;
    if (status) query.status = status;
    if (from || to) {
      query.incidentDate = {};
      if (from) query.incidentDate.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        query.incidentDate.$lte = end;
      }
    }
    if (driver) {
      const rx = new RegExp(String(driver).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ driverName: rx }, { driverIdNumber: rx }];
    }
    if (search) {
      const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { driverName: rx },
        { location: rx },
        { description: rx },
        { reportNumber: rx },
        { policeReportNumber: rx },
        { insuranceClaimNumber: rx },
      ];
    }

    const reports = await AccidentReport.find(query).sort({ incidentDate: -1, createdAt: -1 }).limit(500).lean();

    return res.status(200).json({ count: reports.length, reports });
  } catch (err) {
    console.error("List accident reports failed:", err);
    return res.status(500).json({ message: "Server error while loading accident reports." });
  }
}

export async function getAccidentReport(req, res) {
  try {
    const report = await AccidentReport.findById(req.params.id)
      .populate("driverRef", "firstName lastName driverId email phoneNumber")
      .populate("vehicleRef", "cabNumber licPlates make model year")
      .lean();

    if (!report) return res.status(404).json({ message: "Accident report not found." });

    return res.status(200).json({ report });
  } catch (err) {
    console.error("Get accident report failed:", err);
    return res.status(500).json({ message: "Server error while loading accident report." });
  }
}

export async function updateAccidentReport(req, res) {
  try {
    const report = await AccidentReport.findById(req.params.id);
    if (!report) return res.status(404).json({ message: "Accident report not found." });

    const { status, resolution, note } = req.body;

    if (status) {
      report.status = status;
      if (status === "resolved" || status === "closed") {
        report.resolvedAt = report.resolvedAt || new Date();
      }
    }
    if (resolution !== undefined) report.resolution = resolution;
    if (note && note.trim()) {
      report.internalNotes.push({
        note: note.trim(),
        addedBy: req.user?.email || "admin",
        addedAt: new Date(),
      });
    }

    await report.save();
    return res.status(200).json({ message: "Accident report updated.", report: sanitize(report) });
  } catch (err) {
    console.error("Update accident report failed:", err);
    return res.status(500).json({ message: "Server error while updating accident report." });
  }
}

export async function listDriversForAccident(_req, res) {
  try {
    const drivers = await DriverModel.find({ status: { $ne: "inactive" } })
      .select("_id firstName lastName driverId email phoneNumber")
      .sort({ firstName: 1 })
      .lean();
    return res.status(200).json({ drivers });
  } catch (err) {
    console.error("List drivers for accident failed:", err);
    return res.status(500).json({ message: "Server error while loading drivers." });
  }
}

export async function listVehiclesForAccident(_req, res) {
  try {
    const vehicles = await VehicleModel.find()
      .select("_id cabNumber licPlates make model year")
      .sort({ cabNumber: 1 })
      .lean();
    return res.status(200).json({ vehicles });
  } catch (err) {
    console.error("List vehicles for accident failed:", err);
    return res.status(500).json({ message: "Server error while loading vehicles." });
  }
}
