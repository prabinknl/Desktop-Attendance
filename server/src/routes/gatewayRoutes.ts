import { Router } from 'express';
import { gatewayController, authenticateGatewaySecret } from '../controllers/gatewayController.js';

const router = Router();

router.use(authenticateGatewaySecret);

router.post('/heartbeat', gatewayController.heartbeat);
router.post('/logs', gatewayController.uploadLogs);
router.post('/command-result', gatewayController.commandResult);

export default router;
