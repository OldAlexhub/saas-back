import express from 'express';
import { queryReports } from '../controllers/ReportsController.js';

const router = express.Router();

// POST /api/reports/query
router.post('/query', queryReports);

export default router;
