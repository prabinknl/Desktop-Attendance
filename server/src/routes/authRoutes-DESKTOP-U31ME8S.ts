import { Router } from 'express';
import {
  sendAdminCode,
  verifyAdminCode,
  sendInviteEmail,
  getUsers,
  syncUser,
  login,
  // invitation CRUD
  createInvitation,
  validateInvitation,
  useInvitation,
  listInvitations,
  deleteInvitationRecord,
} from '../controllers/authController.js';

const router = Router();

// ── Admin auth ────────────────────────────────────────────────────────────────
router.post('/admin/send-code',    sendAdminCode);
router.post('/admin/verify-code',  verifyAdminCode);
router.post('/admin/send-invite',  sendInviteEmail);

// ── Users ─────────────────────────────────────────────────────────────────────
router.get('/users',       getUsers);
router.post('/users/sync', syncUser);
router.post('/login',      login);

// ── Invitations (server-persisted) ───────────────────────────────────────────
router.post('/invitations',             createInvitation);
router.get('/invitations',              listInvitations);
router.get('/invitations/:token',       validateInvitation);
router.post('/invitations/:token/use',  useInvitation);
router.delete('/invitations/:token',    deleteInvitationRecord);

export default router;
