import express from 'express';
import { incomePerDriver, queryReports } from '../controllers/ReportsController.js';

const router = express.Router();

// POST /api/reports/query
router.post('/query', queryReports);

// GET /api/reports/income-per-driver?from=YYYY-MM-DD&to=YYYY-MM-DD&driverId=xxxx&limit=100
router.get('/income-per-driver', incomePerDriver);

export default router;
