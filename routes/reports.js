import express from 'express';
import {
  driverComplianceReport,
  hoursOfServiceReport,
  incomePerDriver,
  queryReports,
  tripDataReport,
  vehicleComplianceReport,
} from '../controllers/ReportsController.js';
import { financialReport } from '../controllers/FinancialReports.js';

const router = express.Router();

// POST /api/reports/query
router.post('/query', queryReports);

router.get('/trip-data', tripDataReport);
router.get('/hours-of-service', hoursOfServiceReport);
router.get('/driver-compliance', driverComplianceReport);
router.get('/vehicle-compliance', vehicleComplianceReport);

// GET /api/reports/income-per-driver?from=YYYY-MM-DD&to=YYYY-MM-DD&driverId=xxxx&limit=100
router.get('/income-per-driver', incomePerDriver);

// GET /api/reports/financials?from=YYYY-MM-DD&to=YYYY-MM-DD&driverId=xxxx
router.get('/financials', financialReport);

export default router;
