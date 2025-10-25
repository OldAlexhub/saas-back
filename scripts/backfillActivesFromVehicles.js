import connectTodb from '../db/connectTodb.js';
import ActiveModel from '../models/ActiveSchema.js';
import VehicleModel from '../models/VehicleSchema.js';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
}

async function main() {
  await connectTodb();
  console.log('Connected to DB — starting Active->Vehicle backfill');

  // Find actives missing either regisExpiry or annualInspection
  const missingQuery = {
    $or: [
      { regisExpiry: { $in: [null, undefined] } },
      { annualInspection: { $in: [null, undefined] } },
    ],
  };

  const cursor = ActiveModel.find(missingQuery).cursor();
  let processed = 0;
  let updated = 0;
  for await (const active of cursor) {
    processed += 1;
    const cab = active.cabNumber && String(active.cabNumber).trim();
    if (!cab) continue;

    const vehicle = await VehicleModel.findOne({ cabNumber: { $regex: `^${escapeRegex(cab)}$`, $options: 'i' } }).lean();
    if (!vehicle) continue;

    const now = new Date();
    let changed = false;
    const issues = [];

    const reg = vehicle.regisExpiry || vehicle.registrationExpiry || null;
    const insp = vehicle.annualInspection || null;

    if (!active.regisExpiry && reg) {
      active.regisExpiry = reg;
      changed = true;
    }
    if (!active.annualInspection && insp) {
      active.annualInspection = insp;
      changed = true;
    }

    // Build vehicleCompliance from the (possibly updated) values
    const finalReg = active.regisExpiry || null;
    const finalInsp = active.annualInspection || null;

    if (!finalReg) issues.push('registrationMissing');
    else if (new Date(finalReg) < now) issues.push('registrationExpired');
    if (!finalInsp) issues.push('inspectionMissing');
    else if (new Date(finalInsp) < now) issues.push('inspectionExpired');

    const compliance = { isCompliant: issues.length === 0, issues };
    if (!active.vehicleCompliance || JSON.stringify(active.vehicleCompliance) !== JSON.stringify(compliance)) {
      active.vehicleCompliance = compliance;
      changed = true;
    }

    if (changed) {
      await active.save();
      updated += 1;
      console.log(`Updated active ${active._id} (cab: ${cab})`);
    }
  }

  console.log(`Backfill complete. Processed: ${processed}, Updated: ${updated}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed', err);
  process.exit(1);
});
