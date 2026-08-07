import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import {
  generateVerificationCode,
  sendAdminVerificationEmail,
  storeVerificationCode,
  verifyStoredCode,
  sendInvitationEmail,
} from '../services/auth/adminVerification.js';

// ── Invitation helpers ────────────────────────────────────────────────────────

function generateToken(): string {
  // Use Node's crypto.randomBytes (sync) — always available in Node.js
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomBytes } = require('crypto') as typeof import('crypto');
  return randomBytes(24).toString('hex');
}

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


// ── Invitation CRUD ───────────────────────────────────────────────────────────

/** POST /auth/invitations — create & persist an invitation token */
export async function createInvitation(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const role  = String(req.body?.role  ?? '').trim();
    if (!email || !role) {
      return res.status(400).json({ success: false, message: 'email and role are required.' });
    }

    const token     = generateToken();
    const now       = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Remove any existing unused invitation for this email+role combo
    await pool.query(
      `DELETE FROM invitations WHERE LOWER(email) = $1 AND role = $2 AND used = FALSE`,
      [email, role],
    );

    await pool.query(
      `INSERT INTO invitations (token, email, role, created_at, expires_at, used)
       VALUES ($1, $2, $3, $4, $5, FALSE)`,
      [token, email, role, now.toISOString(), expiresAt.toISOString()],
    );

    const origin = req.headers['x-forwarded-host']
      ? `${req.protocol}://${req.headers['x-forwarded-host']}`
      : `${req.protocol}://${req.headers.host}`;

    return res.json({
      success: true,
      token,
      link: `${origin}/invite/${token}`,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('[Auth] createInvitation error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create invitation.' });
  }
}

/** GET /auth/invitations/:token — validate a token (not used, not expired) */
export async function validateInvitation(req: Request, res: Response) {
  try {
    const { token } = req.params;
    const result = await pool.query(
      `SELECT token, email, role, created_at, expires_at, used
         FROM invitations WHERE token = $1`,
      [token],
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ success: false, message: 'Invitation not found.' });
    }
    if (row.used) {
      return res.status(410).json({ success: false, message: 'Invitation has already been used.' });
    }
    if (new Date() > new Date(row.expires_at)) {
      return res.status(410).json({ success: false, message: 'Invitation has expired.' });
    }
    return res.json({
      success: true,
      data: {
        token: row.token,
        email: row.email,
        role:  row.role,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        used: row.used,
      },
    });
  } catch (err) {
    console.error('[Auth] validateInvitation error:', err);
    return res.status(500).json({ success: false, message: 'Failed to validate invitation.' });
  }
}

/** POST /auth/invitations/:token/use — mark an invitation as used */
export async function useInvitation(req: Request, res: Response) {
  try {
    const { token } = req.params;
    await pool.query(`UPDATE invitations SET used = TRUE WHERE token = $1`, [token]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[Auth] useInvitation error:', err);
    return res.status(500).json({ success: false, message: 'Failed to mark invitation as used.' });
  }
}

/** GET /auth/invitations — list all invitations (admin view) */
export async function listInvitations(_req: Request, res: Response) {
  try {
    const result = await pool.query(
      `SELECT token, email, role, created_at, expires_at, used
         FROM invitations ORDER BY created_at DESC`,
    );
    return res.json({
      success: true,
      data: result.rows.map((r) => ({
        token:     r.token,
        email:     r.email,
        role:      r.role,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        used:      r.used,
      })),
    });
  } catch (err) {
    console.error('[Auth] listInvitations error:', err);
    return res.status(500).json({ success: false, message: 'Failed to list invitations.' });
  }
}

/** DELETE /auth/invitations/:token — remove an invitation */
export async function deleteInvitationRecord(req: Request, res: Response) {
  try {
    const { token } = req.params;
    await pool.query(`DELETE FROM invitations WHERE token = $1`, [token]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[Auth] deleteInvitation error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete invitation.' });
  }
}
