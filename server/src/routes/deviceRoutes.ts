import { Router } from 'express';
import { deviceController } from '../controllers/deviceController.js';

const router = Router();

router.get('/', deviceController.getDevice);
router.put('/', deviceController.save);
router.post('/', deviceController.save);
router.post('/connect', deviceController.connect);
router.post('/test', deviceController.test);
router.post('/test-connection', deviceController.test);
router.post('/disconnect', deviceController.disconnect);
router.get('/status', deviceController.status);
router.get('/logs', deviceController.logs);
router.get('/diagnostics', deviceController.diagnostics);
router.post('/sync', deviceController.sync);
router.post('/scan', deviceController.scan);
router.patch('/sync-settings', deviceController.updateSyncSettings);
router.post('/reconnect', deviceController.reconnect);
router.post('/connector-token', deviceController.createConnectorToken);
router.patch('/connection-mode', deviceController.patchConnectionMode);
// Parametric routes last
router.get('/:id/attendance', deviceController.logs);

export default router;
