import mongoose from 'mongoose';

const DriverDiagnosticsSchema = new mongoose.Schema(
	{
		driverId: { type: String, required: true },
		at: { type: Date, required: true, default: Date.now },
		level: { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
		tag: { type: String },
		message: { type: String },
		payload: { type: mongoose.Schema.Types.Mixed },
	},
	{
		timestamps: true,
	},
);

// explicit indexes
DriverDiagnosticsSchema.index({ driverId: 1 });
DriverDiagnosticsSchema.index({ at: -1 });
// compound index for efficient queries by driver/time
DriverDiagnosticsSchema.index({ driverId: 1, at: -1 });

// If a retention policy is configured at startup, a TTL index on `createdAt` will be created by
// the application bootstrap (config provides diagnostics.retentionDays). We also keep the
// `timestamps: true` option so `createdAt` is populated.
// Note: Index creation is idempotent; Mongo ignores duplicate index creation requests.
// The TTL index itself is created in app bootstrap where `config` is available.

const DriverDiagnosticsModel = mongoose.model('driver_diagnostics', DriverDiagnosticsSchema);

export default DriverDiagnosticsModel;
