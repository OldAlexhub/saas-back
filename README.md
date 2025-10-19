# TaxiOps Backend

TaxiOps is an Express + MongoDB service that powers dispatching, driver management, vehicle compliance, and booking workflows for a taxi operations platform. The API boots with hardened configuration checks, structured error handling, and health endpoints so it can be deployed as the operational core behind a dispatcher console and driver mobile app. 【F:server.js†L1-L65】【F:config/index.js†L1-L36】

## Tech stack
- **Node.js & Express 5** for the HTTP layer, security middleware (Helmet/CORS), static asset hosting, and request logging. 【F:server.js†L1-L65】
- **MongoDB via Mongoose** for persistence with models covering admins, drivers, vehicles, active rosters, fares, and bookings. 【F:models/AdminSchema.js†L1-L39】【F:models/DriverSchema.js†L1-L74】【F:models/VehicleSchema.js†L1-L45】【F:models/ActiveSchema.js†L1-L108】【F:models/FareSchema.js†L1-L29】【F:models/BookingSchema.js†L1-L156】
- **JWT authentication** to protect operational routes and identify the acting admin on writes. 【F:middleware/auth.js†L1-L40】
- **Multer + disk storage** for vehicle inspection uploads with automatic cleanup of superseded files. 【F:controllers/Vehicles.js†L1-L104】

## Key capabilities
- **Admin authentication & approvals** – admins can self-register, log in with bcrypt-secured credentials, and require approval before they can access protected routes. 【F:controllers/Admins.js†L1-L104】【F:routes/routes.js†L52-L59】
- **Driver lifecycle management** – CRUD endpoints validate ages and expiry dates, normalize emails, hash SSNs, and append historical snapshots for auditing. 【F:controllers/Drivers.js†L24-L220】【F:models/DriverSchema.js†L1-L74】
- **Vehicle compliance tracking** – vehicles enforce cab/VIN/plate uniqueness, compute age from the model year, capture inspection files on disk, and log change histories. 【F:controllers/Vehicles.js†L1-L104】【F:models/VehicleSchema.js†L1-L45】
- **Active roster & location tracking** – active driver records normalize GeoJSON locations, expose status/availability toggles, and persist granular change histories with a geospatial index for proximity queries. 【F:controllers/Activate.js†L1-L216】【F:models/ActiveSchema.js†L1-L99】
- **Booking orchestration** – booking flows enforce pickup lead times, avoid driver conflicts within a 20-minute window, offer manual or automatic driver dispatching, guard status transitions, timestamp lifecycle events, and audit every change—including driver-initiated flagdown rides that reuse the same fare accounting. 【F:controllers/Booking.js†L1-L360】【F:models/BookingSchema.js†L1-L214】
- **Driver mobile app APIs** – drivers receive dedicated auth, booking, flagdown, and presence endpoints to acknowledge dispatches, stream live location updates, capture walk-up trips, and progress rides from the field without exposing dispatcher-only data. 【F:controllers/DriverAppAuth.js†L1-L129】【F:controllers/DriverApp.js†L6-L657】【F:routes/driverApp.js†L1-L32】
- **Fare table singleton** – centralized pricing document with guarded create/update semantics for mileage, wait, and extra passenger rates. 【F:controllers/Fares.js†L1-L64】【F:models/FareSchema.js†L1-L29】

## Project layout
```
SaaS/
├── config/            # Environment bootstrap and shared constants
├── controllers/       # Express handlers for domain resources
├── db/                # Mongo connection helper
├── docs/              # Additional documentation (architecture, merge guide)
├── middleware/        # Auth guard and error handling
├── models/            # Mongoose schemas
├── public/            # Static assets + vehicle upload directory root
├── routes/            # API router mounting controllers and uploads
├── utils/             # Shared helpers (diffing, cross-controller utilities)
└── server.js          # Express app entry point
```

## Getting started
### Prerequisites
- Node.js 18+
- MongoDB instance reachable from the API

### Install dependencies
```bash
npm install
```

### Required environment
Create a `.env` file (or inject environment variables) with at least:

```
MONGO_URL=mongodb://localhost:27017/taxiops
SECRET_WORD=replace-with-strong-secret
# Optional driver app overrides (fallbacks use SECRET_WORD / 7d)
DRIVER_APP_SECRET=separate-secret-if-desired
DRIVER_JWT_EXPIRES_IN=7d
# Optional overrides
PORT=3001
VEHICLE_UPLOAD_DIR=/absolute/path/for/vehicle/uploads
```

`config/index.js` will abort startup if `MONGO_URL` or `SECRET_WORD` are missing and will create the vehicle upload directory automatically. 【F:config/index.js†L1-L31】

### Run the API
```bash
npm start
```

This runs `nodemon server.js`, connects to MongoDB with reconnection logging, serves static assets under `/public`, exposes `/health`, and then mounts all versioned routes under `/api` alongside the driver mobile namespace under `/driver-app`. 【F:package.json†L1-L24】【F:server.js†L1-L65】【F:db/connectTodb.js†L1-L36】

## API surface
All operational routes require a bearer token issued by `POST /api/admins/login`. Health and static assets remain unauthenticated.

### Authentication
- `POST /api/admins` – create an admin account (auto-lowercases email, stores bcrypt hash). 【F:controllers/Admins.js†L1-L61】
- `POST /api/admins/login` – authenticate an approved admin and receive a JWT. 【F:controllers/Admins.js†L63-L99】
- `PUT /api/admins/:id/approval` – flip another admin between `yes`/`no`. 【F:controllers/Admins.js†L101-L137】

### Drivers
- `POST /api/drivers`
- `GET /api/drivers`
- `GET /api/drivers/:id`
- `PUT /api/drivers/:id`
- `PATCH /api/drivers/:id/app-credentials`

These endpoints enforce required driver attributes, validate age & expiry dates, hash SSNs, record history, and let dispatchers manage driver app passwords/device bindings. 【F:controllers/Drivers.js†L24-L220】

### Vehicles
- `POST /api/vehicles` (accepts `annualInspectionFile` upload)
- `PUT /api/vehicles/:id` (replaces prior inspection file and logs changes)

Vehicle records enforce uniqueness and compute `ageVehicle` automatically. 【F:controllers/Vehicles.js†L1-L104】【F:models/VehicleSchema.js†L1-L45】

### Active roster
- `POST /api/actives`
- `PUT /api/actives/:id`
- `PUT /api/actives/:id/status`
- `PUT /api/actives/:id/availability`
- `GET /api/actives`
- `GET /api/actives/:id`

Requests only accept whitelisted fields, normalize coordinates, and append change history for auditability. `GET /api/actives` supports filtering and proximity queries when `lat`, `lng`, and `radius` are supplied. 【F:controllers/Activate.js†L1-L216】

### Fares
- `POST /api/fares` – create singleton
- `PUT /api/fares` – update singleton
- `GET /api/fares/current` – fetch current pricing

Numeric guards ensure fare values remain non-negative numbers. 【F:controllers/Fares.js†L1-L64】【F:models/FareSchema.js†L1-L29】

### Bookings
- `POST /api/bookings`
- `GET /api/bookings`
- `GET /api/bookings/:id`
- `PATCH /api/bookings/:id`
- `PATCH /api/bookings/:id/assign`
- `PATCH /api/bookings/:id/status`
- `POST /api/bookings/:id/cancel`

Booking flows enforce lead times, guard driver/cab conflicts, validate status transitions, and stamp lifecycle timestamps while preserving audit history. Assignments can be manual (provide a driver/cab) or automatic, which selects the nearest available active driver inside a 10 km (~6 mi) radius before falling back to the freshest online roster entries. 【F:controllers/Booking.js†L4-L360】【F:models/BookingSchema.js†L1-L156】

### Driver mobile app namespace (`/driver-app`)
- `POST /driver-app/auth/login` – driver credential exchange for a JWT.
- `POST /driver-app/auth/logout` – invalidate the active session and clear device bindings. 【F:controllers/DriverAppAuth.js†L1-L94】
- `POST /driver-app/auth/password` – change password after verifying the current secret. 【F:controllers/DriverAppAuth.js†L96-L129】
- `GET /driver-app/me` – return profile basics, current roster record, and the next five assignments. 【F:controllers/DriverApp.js†L190-L216】
- `GET /driver-app/bookings` – list assigned bookings with optional status/date filters. 【F:controllers/DriverApp.js†L218-L256】
- `GET /driver-app/bookings/current` – fetch the nearest in-progress assignment for rapid polling. 【F:controllers/DriverApp.js†L258-L277】
- `POST /driver-app/bookings/:id/acknowledge` – confirm a dispatch and move the ride to `EnRoute`. 【F:controllers/DriverApp.js†L279-L317】
- `PATCH /driver-app/bookings/:id/status` – advance rides, capture fares, or mark cancellations/no-shows with audit logging. 【F:controllers/DriverApp.js†L477-L588】
- `POST /driver-app/bookings/:id/location` – stream driver GPS points, heading, and speed for live tracking. 【F:controllers/DriverApp.js†L319-L363】
- `POST /driver-app/flagdowns` – log walk-up/flagdown trips that were not dispatched but still need fare reconciliation. 【F:controllers/DriverApp.js†L365-L475】
- `PATCH /driver-app/presence` – update availability, shift status, hours-of-service fields, or current location with geo-history tracking. 【F:controllers/DriverApp.js†L590-L657】

## Additional documentation
- [TaxiOps backend review](docs/taxiops-review.md) – deeper architecture notes and roadmap suggestions.
- [Merge guide](docs/merge-guide.md) – step-by-step instructions for integrating this branch with `main`.

## Contributing
1. Fork or branch from `work`.
2. Create focused commits with descriptive messages.
3. Ensure feature changes include tests or manual validation notes.
4. Open a PR and reference any relevant roadmap items.
---
by Mohamed Gad, Old Alex Hub, LLC
