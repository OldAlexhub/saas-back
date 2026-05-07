import DriverModel from "../models/DriverSchema.js";
import {
  EnrollmeDriverImportError,
  ENROLLME_DRIVER_FIELD_MAP,
  getEnrollmeDriverImportCandidate,
  importEnrollmeDriverToRoster,
  listEnrollmeDriverImportCandidates,
} from "../services/enrollmeDriverImportService.js";
import {
  createDriverRecord,
  DriverCreationError,
  hashSsn,
  sanitizeDriver,
  validateDatesOnCreateOrUpdate,
} from "../services/driverCreationService.js";

// ----------------- LIST DRIVERS -----------------
export const listDrivers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const skip = (page - 1) * limit;

    const [drivers, total] = await Promise.all([
      DriverModel.find().select("-ssn -history").skip(skip).limit(limit).lean(),
      DriverModel.countDocuments(),
    ]);
    return res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), drivers });
  } catch (error) {
    console.error("Error listing drivers:", error);
    return res.status(500).json({ message: "Server error while fetching drivers." });
  }
};

export const listEnrollmeImportCandidates = async (req, res) => {
  try {
    const applications = await listEnrollmeDriverImportCandidates({
      search: req.query.search || "",
    });
    return res.status(200).json({
      count: applications.length,
      fieldMap: ENROLLME_DRIVER_FIELD_MAP,
      applications,
    });
  } catch (error) {
    console.error("Error listing EnrollMe import candidates:", error);
    return res.status(500).json({ message: "Server error while listing EnrollMe import candidates." });
  }
};

export const getEnrollmeImportCandidate = async (req, res) => {
  try {
    const { candidate } = await getEnrollmeDriverImportCandidate(req.params.id);
    return res.status(200).json({
      fieldMap: ENROLLME_DRIVER_FIELD_MAP,
      application: candidate,
    });
  } catch (error) {
    if (error instanceof EnrollmeDriverImportError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("Error loading EnrollMe import candidate:", error);
    return res.status(500).json({ message: "Server error while loading EnrollMe import candidate." });
  }
};

export const importEnrollmeDriver = async (req, res) => {
  try {
    const result = await importEnrollmeDriverToRoster(req.params.id, {
      adminEmail: req.user?.email || "admin",
    });
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof EnrollmeDriverImportError || error instanceof DriverCreationError) {
      return res.status(error.statusCode).json({
        message: error.message,
        ...(error.errors?.length ? { errors: error.errors } : {}),
        ...(error.candidate ? { application: error.candidate } : {}),
      });
    }
    if (error.code === 11000) {
      return res.status(409).json({ message: "EnrollMe application is already linked to a SaaS driver." });
    }
    console.error("Error importing EnrollMe driver:", error);
    return res.status(500).json({ message: "Server error while importing EnrollMe driver." });
  }
};

// ----------------- GET DRIVER -------------------
export const getDriverById = async (req, res) => {
  try {
    const { id } = req.params;
    let driver = null;
    // support both Mongo ObjectId and the app's generated driverId (5-digit string)
    if (id && /^[0-9a-fA-F]{24}$/.test(String(id))) {
      driver = await DriverModel.findById(id).select("-ssn -history");
    }
    if (!driver) {
      const candidateDriverId = String(id || "").trim();
      driver =
        candidateDriverId &&
        (await DriverModel.findOne({ driverId: candidateDriverId }).select("-ssn -history"));
    }
    if (!driver) {
      return res.status(404).json({ message: "Driver not found." });
    }
    return res.status(200).json({ driver: sanitizeDriver(driver) });
  } catch (error) {
    console.error("Error fetching driver:", error);
    return res.status(500).json({ message: "Server error while fetching driver." });
  }
};

// ----------------- ADD RECORD -----------------
export const addDriver = async (req, res) => {
  try {
    const driver = await createDriverRecord(req.body);

    return res.status(201).json({
      message: "Driver added successfully.",
      driver: sanitizeDriver(driver),
    });
  } catch (error) {
    if (error instanceof DriverCreationError) {
      return res.status(error.statusCode).json({
        message: error.message,
        ...(error.errors?.length ? { errors: error.errors } : {}),
      });
    }
    if (error.code === 11000) {
      return res.status(409).json({ message: "A driver with this email or license number already exists." });
    }
    console.error("Error adding driver:", error);
    return res.status(500).json({ message: "Server error while adding driver." });
  }
};

// ----------------- UPDATE RECORD -----------------
export const updateDriver = async (req, res) => {
  try {
  const { id } = req.params;
  const updateData = { ...req.body };

    // Prevent manual driverId override
    if (updateData.driverId) {
      delete updateData.driverId;
    }

    // Validate date logic for provided fields
    const dateErrors = validateDatesOnCreateOrUpdate(updateData, { isCreate: false });
    if (dateErrors.length) {
      return res.status(400).json({
        message: "Invalid date(s).",
        errors: dateErrors,
      });
    }

    if (updateData.ssn) {
      updateData.ssn = await hashSsn(updateData.ssn);
      updateData.ssnLast4 = String(req.body.ssn).slice(-4);
    }

    if (updateData.email) {
      updateData.email = String(updateData.email).trim().toLowerCase();
    }

    // Support updates by either Mongo ObjectId or the app's driverId
    let updatedDriver = null;
    if (id && /^[0-9a-fA-F]{24}$/.test(String(id))) {
      updatedDriver = await DriverModel.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true, runValidators: true, updatedBy: req.user?.email || "admin" }
      ).select("-ssn -history");
    }
    if (!updatedDriver) {
      const candidateDriverId = String(id || "").trim();
      if (candidateDriverId) {
        updatedDriver = await DriverModel.findOneAndUpdate(
          { driverId: candidateDriverId },
          { $set: updateData },
          { new: true, runValidators: true, updatedBy: req.user?.email || "admin" }
        ).select("-ssn -history");
      }
    }

    if (!updatedDriver) {
      return res.status(404).json({ message: "Driver not found." });
    }

    return res.status(200).json({
      message: "Driver record updated successfully.",
      driver: sanitizeDriver(updatedDriver),
    });
  } catch (error) {
    console.error("Error updating driver:", error);
    return res.status(500).json({ message: "Server error while updating driver." });
  }
};

// ----------------- APP CREDENTIALS -----------------
export const setDriverAppCredentials = async (req, res) => {
  try {
    const { id } = req.params;
    const { password, forcePasswordReset, deviceId } = req.body || {};

    let driver = null;
    if (id && /^[0-9a-fA-F]{24}$/.test(String(id))) {
      driver = await DriverModel.findById(id).select("-ssn -history +driverApp.passwordHash");
    }
    if (!driver) {
      const candidateDriverId = String(id || "").trim();
      driver =
        candidateDriverId &&
        (await DriverModel.findOne({ driverId: candidateDriverId }).select("-ssn -history +driverApp.passwordHash"));
    }

    if (!driver) {
      return res.status(404).json({ message: "Driver not found." });
    }

    if (password !== undefined) {
      if (!password || password.trim().length < 8) {
        return res
          .status(400)
          .json({ message: "Password must be at least 8 characters long when provided." });
      }
      await driver.setAppPassword(password, {
        forceReset: forcePasswordReset === true,
      });
    } else if (forcePasswordReset !== undefined) {
      if (!driver.driverApp) driver.driverApp = {};
      driver.driverApp.forcePasswordReset = Boolean(forcePasswordReset);
    }

    if (deviceId !== undefined) {
      if (!driver.driverApp) driver.driverApp = {};
      driver.driverApp.deviceId = deviceId ? String(deviceId) : undefined;
    }

    await driver.save();

    return res.status(200).json({
      message: "Driver app credentials updated successfully.",
      driver: sanitizeDriver(driver),
    });
  } catch (error) {
    console.error("Error updating driver app credentials:", error);
    return res.status(500).json({ message: "Server error while updating driver app credentials." });
  }
};
