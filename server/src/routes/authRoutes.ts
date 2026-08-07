import { Router } from 'express';
import {
  sendAdminCode,
  verifyAdminCode,
  sendInviteEmail,
  getInvitationByToken,
  markInvitationUsed,
  getUsers,
  syncUser,
  login,
  createClientAdminInvite,
  validateClientAdminInvite,
  resendClientAdminSms,
  signupClientAdmin,
} from '../controllers/authController.js';

const router = Router();

router.post('/admin/send-code', sendAdminCode);
router.post('/admin/verify-code', verifyAdminCode);
router.post('/admin/send-invite', sendInviteEmail);

// Client Admin invitation workflow routes
router.post('/client-admin/invite', createClientAdminInvite);
router.get('/client-admin/invitations/validate', validateClientAdminInvite);
router.post('/client-admin/resend-sms', resendClientAdminSms);
router.post('/client-admin/signup', signupClientAdmin);

router.get('/invitations/:token', getInvitationByToken);
router.post('/invitations/:token/use', markInvitationUsed);
router.get('/users', getUsers);
router.post('/users/sync', syncUser);
router.post('/login', login);

export default router;
