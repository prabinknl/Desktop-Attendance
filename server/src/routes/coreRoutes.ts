import { Router } from 'express';
import { coreController } from '../controllers/coreController.js';

const router = Router();

router.get('/:resource', coreController.getAll);
router.post('/:resource', coreController.upsert);
router.post('/:resource/bulk', coreController.bulkUpsert);
router.patch('/:resource/:id', coreController.update);
router.delete('/:resource/:id', coreController.delete);

export default router;
