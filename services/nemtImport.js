import xlsx from "xlsx";

// Maps normalized column header variants to NemtTrip schema field names.
// Keys are lowercased and whitespace-collapsed for comparison.
const COLUMN_MAP = {
  "passenger name": "passengerName",
  passengername: "passengerName",
  name: "passengerName",
  "patient name": "passengerName",
  patientname: "passengerName",
  phone: "passengerPhone",
  "passenger phone": "passengerPhone",
  passengerphone: "passengerPhone",
  telephone: "passengerPhone",
  "member id": "passengerId",
  memberid: "passengerId",
  "patient id": "passengerId",
  patientid: "passengerId",
  passengerid: "passengerId",
  "member #": "passengerId",
  dob: "passengerDob",
  "date of birth": "passengerDob",
  dateofbirth: "passengerDob",
  birthdate: "passengerDob",
  mobility: "mobilityType",
  "mobility type": "mobilityType",
  mobilitytype: "mobilityType",
  "mobility code": "mobilityType",
  "pickup address": "pickupAddress",
  pickupaddress: "pickupAddress",
  pickup: "pickupAddress",
  "pick up address": "pickupAddress",
  "dropoff address": "dropoffAddress",
  dropoffaddress: "dropoffAddress",
  destination: "dropoffAddress",
  dropoff: "dropoffAddress",
  "drop off": "dropoffAddress",
  "drop off address": "dropoffAddress",
  "pickup time": "scheduledPickupTime",
  pickuptime: "scheduledPickupTime",
  "scheduled pickup": "scheduledPickupTime",
  scheduledpickuptime: "scheduledPickupTime",
  "pick up time": "scheduledPickupTime",
  "appointment time": "appointmentTime",
  appointmenttime: "appointmentTime",
  appointment: "appointmentTime",
  appt: "appointmentTime",
  "appt time": "appointmentTime",
  "trip id": "agencyTripRef",
  tripid: "agencyTripRef",
  "order #": "agencyTripRef",
  "order id": "agencyTripRef",
  orderid: "agencyTripRef",
  agencytripref: "agencyTripRef",
  "trip ref": "agencyTripRef",
  tripref: "agencyTripRef",
  "special instructions": "specialInstructions",
  specialinstructions: "specialInstructions",
  instructions: "specialInstructions",
  notes: "specialInstructions",
  comments: "specialInstructions",
  attendants: "attendantCount",
  attendantcount: "attendantCount",
  "attendant count": "attendantCount",
  passengers: "passengerCount",
  passengercount: "passengerCount",
  "passenger count": "passengerCount",
};

function normalizeKey(key) {
  return String(key)
    .toLowerCase()
    .replace(/[\t_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapRowHeaders(rawRow) {
  const mapped = {};
  for (const [rawKey, value] of Object.entries(rawRow)) {
    const normalized = normalizeKey(rawKey);
    const field = COLUMN_MAP[normalized];
    if (field && value !== undefined && value !== null && value !== "") {
      mapped[field] = value;
    }
  }
  return mapped;
}

function coerceMobilityType(raw) {
  const s = String(raw).toLowerCase().replace(/[\s_-]+/g, "");
  if (s.includes("wheelchair") && (s.includes("xl") || s.includes("large") || s.includes("bariatric"))) {
    return "wheelchair_xl";
  }
  if (s.includes("wheelchair") || s.includes("wc")) return "wheelchair";
  if (s.includes("stretcher") || s.includes("gurney")) return "stretcher";
  if (s.includes("ambulatory") || s.includes("amb") || s.includes("ambulant")) return "ambulatory";
  return "ambulatory";
}

function normalizeRow(rawRow) {
  const r = mapRowHeaders(rawRow);

  if (r.passengerCount !== undefined) {
    r.passengerCount = parseInt(r.passengerCount, 10);
    if (isNaN(r.passengerCount) || r.passengerCount < 1) r.passengerCount = 1;
  }
  if (r.attendantCount !== undefined) {
    r.attendantCount = parseInt(r.attendantCount, 10);
    if (isNaN(r.attendantCount) || r.attendantCount < 0) r.attendantCount = 0;
  }
  if (r.mobilityType !== undefined) {
    r.mobilityType = coerceMobilityType(r.mobilityType);
  }

  // xlsx with cellDates:true already converts date cells to JS Date objects.
  // String date fields are left as-is for the caller to coerce.

  return r;
}

/**
 * Parse a file buffer (CSV or XLSX) into an array of normalized trip field objects.
 * The xlsx library handles both formats; CSV is treated as a single-sheet workbook.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {{ rows: object[], errors: string[] }}
 */
export function parseImportFile(buffer, mimeType) {
  try {
    const workbook = xlsx.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return { rows: [], errors: ["File contains no sheets."] };
    }
    const sheet = workbook.Sheets[sheetName];
    const rawRows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

    if (rawRows.length === 0) {
      return { rows: [], errors: ["File is empty or has no data rows after the header."] };
    }

    const rows = [];
    const errors = [];

    for (let i = 0; i < rawRows.length; i++) {
      try {
        const normalized = normalizeRow(rawRows[i]);
        // Skip blank rows
        if (!normalized.passengerName && !normalized.pickupAddress && !normalized.dropoffAddress) {
          continue;
        }
        rows.push(normalized);
      } catch (err) {
        errors.push(`Row ${i + 2}: ${err.message}`);
      }
    }

    return { rows, errors };
  } catch (err) {
    return { rows: [], errors: [`Failed to parse file: ${err.message}`] };
  }
}
