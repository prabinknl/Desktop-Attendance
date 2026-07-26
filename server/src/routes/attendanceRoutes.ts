import { Router } from 'express';
import { attendanceController } from '../controllers/attendanceController.js';

const router = Router();

router.get('/', attendanceController.getAll);
router.post('/upsert', attendanceController.upsert);
router.post('/bulk-upsert', attendanceController.bulkUpsert);
router.post('/bulk-update', attendanceController.bulkUpdate);
router.patch('/:id', attendanceController.update);
router.delete('/:id', attendanceController.delete);

export default router;
