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
  "level of service": "mobilityType",
  los: "mobilityType",
  "pickup address": "pickupAddress",
  pickupaddress: "pickupAddress",
  pickup: "pickupAddress",
  "pick up address": "pickupAddress",
  "pu address": "pickupAddress",
  "pickup street": "pickupStreet",
  "pickup city": "pickupCity",
  "pickup state": "pickupState",
  "pickup zip": "pickupZip",
  "pickup zipcode": "pickupZip",
  "dropoff address": "dropoffAddress",
  dropoffaddress: "dropoffAddress",
  destination: "dropoffAddress",
  "destination address": "dropoffAddress",
  dropoff: "dropoffAddress",
  "drop off": "dropoffAddress",
  "drop off address": "dropoffAddress",
  "do address": "dropoffAddress",
  "dropoff street": "dropoffStreet",
  "dropoff city": "dropoffCity",
  "dropoff state": "dropoffState",
  "dropoff zip": "dropoffZip",
  "dropoff zipcode": "dropoffZip",
  "pickup time": "scheduledPickupTime",
  pickuptime: "scheduledPickupTime",
  "scheduled pickup": "scheduledPickupTime",
  scheduledpickuptime: "scheduledPickupTime",
  "pick up time": "scheduledPickupTime",
  "pu time": "scheduledPickupTime",
  "ready time": "scheduledPickupTime",
  "pickup window start": "pickupWindowEarliest",
  "pickup window earliest": "pickupWindowEarliest",
  "earliest pickup": "pickupWindowEarliest",
  "pickup window end": "pickupWindowLatest",
  "pickup window latest": "pickupWindowLatest",
  "latest pickup": "pickupWindowLatest",
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
  "trip direction": "tripDirection",
  direction: "tripDirection",
  leg: "tripDirection",
  "leg type": "tripDirection",
  attendants: "attendantCount",
  attendantcount: "attendantCount",
  "attendant count": "attendantCount",
  passengers: "passengerCount",
  passengercount: "passengerCount",
  "passenger count": "passengerCount",
  // financials
  "estimated miles": "estimatedMiles",
  estimatedmiles: "estimatedMiles",
  "est miles": "estimatedMiles",
  estmiles: "estimatedMiles",
  miles: "estimatedMiles",
  distance: "estimatedMiles",
  "agency fare": "agencyFare",
  agencyfare: "agencyFare",
  fare: "agencyFare",
  rate: "agencyFare",
  "trip fare": "agencyFare",
  tripfare: "agencyFare",
  "fare basis": "agencyFareBasis",
  farebasis: "agencyFareBasis",
  agencyfarebasis: "agencyFareBasis",
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

function compactAddress(parts) {
  return parts
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

function coerceTripDirection(raw) {
  const s = String(raw || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (!s) return undefined;
  if (s.includes("return") || s === "r" || s.includes("inbound")) return "return";
  return "outbound";
}

function normalizeRow(rawRow) {
  const r = mapRowHeaders(rawRow);

  if (!r.pickupAddress) {
    r.pickupAddress = compactAddress([r.pickupStreet, r.pickupCity, r.pickupState, r.pickupZip]);
  }
  if (!r.dropoffAddress) {
    r.dropoffAddress = compactAddress([r.dropoffStreet, r.dropoffCity, r.dropoffState, r.dropoffZip]);
  }
  for (const key of [
    "pickupStreet", "pickupCity", "pickupState", "pickupZip",
    "dropoffStreet", "dropoffCity", "dropoffState", "dropoffZip",
  ]) {
    delete r[key];
  }

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
  if (r.tripDirection !== undefined) {
    const direction = coerceTripDirection(r.tripDirection);
    if (direction) r.tripDirection = direction;
    else delete r.tripDirection;
  }

  if (r.estimatedMiles !== undefined) {
    const v = parseFloat(r.estimatedMiles);
    r.estimatedMiles = isNaN(v) || v < 0 ? undefined : v;
    if (r.estimatedMiles === undefined) delete r.estimatedMiles;
  }
  if (r.agencyFare !== undefined) {
    const v = parseFloat(r.agencyFare);
    r.agencyFare = isNaN(v) || v < 0 ? undefined : v;
    if (r.agencyFare === undefined) delete r.agencyFare;
  }

  // Normalize fareBasis to accepted enum values
  if (r.agencyFareBasis !== undefined) {
    const fb = String(r.agencyFareBasis).toLowerCase().replace(/[\s_-]+/g, "");
    if (fb.includes("mile")) r.agencyFareBasis = "per_mile";
    else if (fb.includes("trip") || fb.includes("flat")) r.agencyFareBasis = "per_trip";
    else delete r.agencyFareBasis;
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
