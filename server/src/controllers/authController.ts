import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import {
  generateVerificationCode,
  sendAdminVerificationEmail,
  storeVerificationCode,
  verifyStoredCode,
  sendInvitationEmail,
} from '../services/auth/adminVerification.js';

const ALLOWED_ADMIN_EMAIL = env.adminSignupEmail;

export async function sendAdminCode(req: Request, res: Response) {
  try {
    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '')
      .trim()
      .toLowerCase();

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }
    if (email !== ALLOWED_ADMIN_EMAIL.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: `Only ${ALLOWED_ADMIN_EMAIL} can register as admin.`,
      });
    }

    const code = generateVerificationCode();
    storeVerificationCode(email, code);

    const mail = await sendAdminVerificationEmail({ to: email, name, code });

    if (!mail.sent) {
      return res.status(503).json({
        success: false,
        emailSent: false,
        email,
        message:
          mail.error ||
          'Could not send verification email. Configure SMTP_* in server/.env and try again.',
      });
    }

    const responseMsg = mail.devFallback
      ? `SMTP not configured. Dev Mode code generated: ${code}`
      : `Verification code sent to ${email}`;

    return res.json({
      success: true,
      message: responseMsg,
      emailSent: true,
      email,
      devCode: mail.devFallback ? code : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send verification code';
    console.error('[Auth] sendAdminCode failed:', message);
    return res.status(500).json({ success: false, message });
  }
}

export async function verifyAdminCode(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? '')
      .trim()
      .toLowerCase();
    const code = String(req.body?.code ?? '').trim();

    if (!email || !code) {
      return res.status(400).json({ success: false, message: 'Email and code are required.' });
    }
    if (email !== ALLOWED_ADMIN_EMAIL.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: `Only ${ALLOWED_ADMIN_EMAIL} can register as admin.`,
      });
    }

    const result = verifyStoredCode(email, code);
    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.message });
    }

    return res.json({
      success: true,
      verified: true,
      email,
      message: 'Email verified successfully.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to verify code';
    return res.status(500).json({ success: false, message });
  }
}

export async function sendInviteEmail(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const role = String(req.body?.role ?? '').trim();
    const inviteLink = String(req.body?.inviteLink ?? '').trim();

    if (!email || !role || !inviteLink) {
      return res.status(400).json({
        success: false,
        message: 'Email, role, and inviteLink are required.',
      });
    }

    const mail = await sendInvitationEmail({ to: email, role, inviteLink });

    if (!mail.sent) {
      return res.status(503).json({
        success: false,
        emailSent: false,
        message:
          mail.error ||
          'Could not send invitation email. Configure SMTP_* in server/.env and try again.',
      });
    }

    return res.json({
      success: true,
      message: `Invitation email sent to ${email}`,
      emailSent: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send invitation email';
    console.error('[Auth] sendInviteEmail failed:', message);
    return res.status(500).json({ success: false, message });
  }
}

export async function getUsers(_req: Request, res: Response) {
  try {
    const { UserModel } = await import('../models/UserModel.js');
    const users = await UserModel.getAllSafe();
    return res.json({ success: true, data: users });
  } catch (err) {
    console.error('[Auth] getUsers error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
}

/** Credentials are checked here rather than in the browser so the account
 *  list can be served without passwords. */
export async function login(req: Request, res: Response) {
  try {
    const identifier = String(req.body?.identifier ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'User name or email is required.' });
    }
    const { UserModel } = await import('../models/UserModel.js');
    const user = await UserModel.verifyCredentials(identifier, password);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid user name or password' });
    }
    return res.json({ success: true, data: user });
  } catch (err) {
    console.error('[Auth] login error:', err);
    return res.status(500).json({ success: false, message: 'Failed to sign in' });
  }
}

export async function syncUser(req: Request, res: Response) {
  try {
    const user = req.body;
    if (!user || !user.email || !user.role || !user.password) {
      return res.status(400).json({ success: false, message: 'email, role, and password are required' });
    }
    const { UserModel } = await import('../models/UserModel.js');
    const saved = await UserModel.upsert({
      id: user.id || `u-${Date.now()}`,
      name: user.name || 'User',
      email: user.email,
      role: user.role,
      password: user.password,
      avatar: user.avatar,
      phone: user.phone,
      timezone: user.timezone,
      employeeId: user.employeeId,
      departmentId: user.departmentId,
    });
    return res.json({ success: true, data: saved });
  } catch (err) {
    console.error('[Auth] syncUser error:', err);
    return res.status(500).json({ success: false, message: 'Failed to sync user' });
  }
}

