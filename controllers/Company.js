import { COMPANY_ID, CompanyModel } from "../models/CompanySchema.js";

export const getCompanyProfile = async (_req, res) => {
  try {
    let company = await CompanyModel.findById(COMPANY_ID).lean();
    if (!company) {
        company = await CompanyModel.create({
          _id: COMPANY_ID,
          name: "TaxiOps Transportation LLC",
          address: "",
          phone: "",
          email: "",
          website: "",
          logoUrl: "",
          notes: "",
          dispatchSettings: {
            maxDistanceMiles: 6,
            maxCandidates: 20,
            distanceStepsMiles: [1, 2, 3, 4, 5, 6],
          },
        });
      company = company.toObject();
    }

    return res.status(200).json({ company });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to load company profile",
      error: error.message,
    });
  }
};

export const updateCompanyProfile = async (req, res) => {
  try {
    const payload = {};
    const fields = [
      "name",
      "address",
      "phone",
      "email",
      "website",
      "logoUrl",
      "notes",
    ];
    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        payload[field] = req.body[field];
      }
    });

    // Optional dispatch settings update
    if (req.body.dispatchSettings && typeof req.body.dispatchSettings === 'object') {
      const ds = req.body.dispatchSettings;
      const dsPayload = {};
      if (ds.maxDistanceMiles !== undefined) dsPayload['dispatchSettings.maxDistanceMiles'] = Number(ds.maxDistanceMiles);
      if (ds.maxCandidates !== undefined) dsPayload['dispatchSettings.maxCandidates'] = Number(ds.maxCandidates);
      if (Array.isArray(ds.distanceStepsMiles)) dsPayload['dispatchSettings.distanceStepsMiles'] = ds.distanceStepsMiles.map(Number).filter((n) => Number.isFinite(n) && n > 0);
      Object.assign(payload, dsPayload);
    }

    if (!payload.name || payload.name.trim() === "") {
      return res.status(400).json({ message: "Company name is required." });
    }

    const updated = await CompanyModel.findByIdAndUpdate(
      COMPANY_ID,
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return res.status(200).json({
      message: "Company profile updated.",
      company: updated,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to update company profile",
      error: error.message,
    });
  }
};
