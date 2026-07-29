import { Router } from 'express';
import { gatewayController, authenticateConnector } from '../controllers/gatewayController.js';
import { gatewayRateLimit } from '../middleware/gatewayRateLimit.js';

const router = Router();

router.use(gatewayRateLimit);
router.use(authenticateConnector);

router.post('/heartbeat', gatewayController.heartbeat);
router.post('/logs', gatewayController.uploadLogs);
router.post('/command-result', gatewayController.commandResult);

export default router;
