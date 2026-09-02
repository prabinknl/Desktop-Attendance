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
  verifyAdminSignupInvite,
  submitAdminSignup,
  verifyAdminSignupEmail,
  resendAdminSignupEmail,
  purgeAdminAccount,
  deleteStaffAccess,
  getInvitationsByRole,
} from '../controllers/authController.js';

const router = Router();

router.post('/admin/send-code', sendAdminCode);
router.post('/admin/verify-code', verifyAdminCode);
router.post('/admin/send-invite', sendInviteEmail);

// New invitation-only Admin sign up routes
router.post('/admin-signup/verify-invitation', verifyAdminSignupInvite);
router.post('/admin-signup/submit', submitAdminSignup);
router.post('/admin-signup/verify-email', verifyAdminSignupEmail);
router.post('/admin-signup/resend-email', resendAdminSignupEmail);

// Client Admin invitation workflow routes
router.post('/client-admin/invite', createClientAdminInvite);
router.get('/client-admin/invitations/validate', validateClientAdminInvite);
router.post('/client-admin/resend-sms', resendClientAdminSms);
router.post('/client-admin/signup', signupClientAdmin);

router.get('/invitations/:token', getInvitationByToken);
router.get('/invitations/by-role/:role', getInvitationsByRole);
router.post('/invitations/:token/use', markInvitationUsed);
router.get('/users', getUsers);
router.post('/users/sync', syncUser);
router.post('/users/delete', deleteStaffAccess);
router.post('/admin-accounts/purge', purgeAdminAccount);
router.post('/login', login);

export default router;

