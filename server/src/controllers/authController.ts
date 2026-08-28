import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import {
  canResendVerificationCode,
  generateVerificationCode,
  sendAdminVerificationEmail,
  storeVerificationCode,
  verifyStoredCode,
  sendInvitationEmail,
} from '../services/auth/adminVerification.js';
import { purgeAdminAccountByEmail } from '../services/auth/purgeAdminAccount.js';

const ALLOWED_ADMIN_EMAIL = env.adminSignupEmail;
const OWNER_SIGNIN_EMAILS = ['noreply@appnep.com', 'appnep@pacenp.com', 'bpkhanal.app@gmail.com'];

function formatEmailList(emails: string[]): string {
  if (emails.length <= 1) return emails[0] || '';
  if (emails.length === 2) return `${emails[0]} and ${emails[1]}`;
  return `${emails.slice(0, -1).join(', ')} and ${emails[emails.length - 1]}`;
}

export async function sendAdminCode(req: Request, res: Response) {
  try {
    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const emails = Array.isArray(req.body?.emails)
      ? req.body.emails.map((value: unknown) => String(value).trim().toLowerCase()).filter(Boolean)
      : [];

    const recipientEmails: string[] = emails.length > 0 ? emails : (email ? [email] : []);

    if (recipientEmails.length === 0) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const isOwnerRequest = emails.length > 0;
    const allowedEmails = isOwnerRequest ? OWNER_SIGNIN_EMAILS : [ALLOWED_ADMIN_EMAIL.toLowerCase()];

    if (!recipientEmails.every((recipient) => allowedEmails.includes(recipient))) {
      return res.status(400).json({
        success: false,
        message: isOwnerRequest
          ? `Owner sign in supports ${formatEmailList(OWNER_SIGNIN_EMAILS)}.`
          : `Only ${ALLOWED_ADMIN_EMAIL} can register as admin.`,
      });
    }

    if (!recipientEmails.every((recipient) => canResendVerificationCode(recipient))) {
      return res.status(429).json({
        success: false,
        emailSent: false,
        email: recipientEmails[0],
        message: 'Please wait 60 seconds before requesting a new verification code.',
      });
    }

    const code = generateVerificationCode();
    recipientEmails.forEach((recipient) => storeVerificationCode(recipient, code));

    if (env.nodeEnv !== 'production') {
      console.log(`[Auth DEV MODE] Verification code generated for ${recipientEmails.join(', ')}: ${code}`);
    }

    const mail = await sendAdminVerificationEmail({ to: recipientEmails, name, code });

    if (!mail.sent) {
      return res.status(503).json({
        success: false,
        emailSent: false,
        email,
        message:
          mail.error ||
          'Could not send verification email. Configure SMTP_HOST, SMTP_USER, and SMTP_PASS in the hosting environment and try again.',
      });
    }

    const responseMsg = `Verification code sent to ${recipientEmails.join(', ')}`;

    return res.json({
      success: true,
      message: responseMsg,
      emailSent: true,
      email: recipientEmails[0],
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
    if (email !== ALLOWED_ADMIN_EMAIL.toLowerCase() && !OWNER_SIGNIN_EMAILS.includes(email)) {
      return res.status(400).json({
        success: false,
        message: `Only ${ALLOWED_ADMIN_EMAIL} or the owner sign in emails can verify codes.`,
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

import { InvitationModel } from '../models/InvitationModel.js';
import {
  computeInvitationExpiry,
  extractTokenFromInviteLink,
  logInvitationDebug,
  normalizeInviteToken,
  serializeInvitation,
  validateInvitationRecord,
} from '../services/auth/invitationService.js';

export async function sendInviteEmail(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const name = String(req.body?.name ?? '').trim();
    const role = String(req.body?.role ?? '').trim();
    const inviteLink = String(req.body?.inviteLink ?? '').trim();
    let token = normalizeInviteToken(String(req.body?.token ?? req.body?.code ?? ''));

    if (!token && inviteLink) {
      token = extractTokenFromInviteLink(inviteLink);
    }

    if (!email || !role) {
      return res.status(400).json({
        success: false,
        message: 'Email and role are required.',
      });
    }

    if (token) {
      const now = new Date();
      const expires = computeInvitationExpiry(now);
      await InvitationModel.save({
        token,
        email,
        name: name || undefined,
        role,
        created_at: now.toISOString(),
        expires_at: expires.toISOString(),
        used: false,
      });
      logInvitationDebug('created', {
        token,
        createdAt: now,
        expiresAt: expires,
        serverNow: now,
        status: 'active',
      });
    }

    const publicLink =
      env.appPublicUrl && token
        ? `${env.appPublicUrl}/invite/${token}`
        : inviteLink ||
          (token && env.nodeEnv !== 'production' ? `http://localhost:3002/invite/${token}` : '');

    const mail = await sendInvitationEmail({
      to: email,
      name: name || undefined,
      role,
      inviteLink: publicLink,
      code: token || undefined,
    });

    if (!mail.sent) {
      if (mail.error) {
        console.error('[Auth] Invitation email not sent:', mail.error);
      }
      return res.status(503).json({
        success: false,
        emailSent: false,
        message: mail.error
          ? `Invitation created, but email could not be sent (${mail.error}).`
          : 'Invitation created, but email could not be sent. Please try again.',
      });
    }

    return res.json({
      success: true,
      message: `Invitation email sent to ${email}`,
      emailSent: true,
      inviteLink: publicLink,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send invitation email';
    console.error('[Auth] send-invite failed:', message);
    return res.status(500).json({
      success: false,
      message: 'Invitation created, but email could not be sent. Please try again.',
      emailSent: false,
    });
  }
}

export async function getInvitationByToken(req: Request, res: Response) {
  try {
    const token = normalizeInviteToken(String(req.params.token ?? ''));
    if (!token) {
      return res.status(400).json({
        success: false,
        code: 'invalid_token',
        message: 'Invalid invitation token.',
      });
    }

    const serverNow = new Date();
    const inv = await InvitationModel.getByToken(token);
    if (!inv) {
      logInvitationDebug('validate-miss', {
        token,
        serverNow,
        status: 'not_found',
        code: 'not_found',
      });
      return res.status(404).json({
        success: false,
        code: 'not_found',
        message: 'Invitation not found.',
      });
    }

    const validation = validateInvitationRecord(inv, serverNow);
    logInvitationDebug('validate', {
      token,
      createdAt: inv.created_at,
      expiresAt: inv.expires_at,
      serverNow,
      status: validation.ok ? 'valid' : validation.code,
      code: validation.ok ? undefined : validation.code,
    });

    if (!validation.ok) {
      return res.status(410).json({
        success: false,
        code: validation.code,
        message: validation.message,
      });
    }

    return res.json({
      success: true,
      data: serializeInvitation(inv),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch invitation';
    console.error('[Auth] getInvitationByToken failed:', message);
    return res.status(500).json({
      success: false,
      code: 'server_error',
      message,
    });
  }
}

export async function markInvitationUsed(req: Request, res: Response) {
  try {
    const token = normalizeInviteToken(String(req.params.token ?? ''));
    if (!token) {
      return res.status(400).json({
        success: false,
        code: 'invalid_token',
        message: 'Invalid invitation token.',
      });
    }

    const inv = await InvitationModel.getByToken(token);
    if (!inv) {
      return res.status(404).json({
        success: false,
        code: 'not_found',
        message: 'Invitation not found.',
      });
    }

    if (inv.used) {
      return res.status(410).json({
        success: false,
        code: 'already_used',
        message: 'This invitation has already been used.',
      });
    }

    await InvitationModel.markUsed(token);
    logInvitationDebug('marked-used', {
      token,
      createdAt: inv.created_at,
      serverNow: new Date(),
      status: 'used',
    });
    return res.json({ success: true, message: 'Invitation marked as used.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to mark invitation used';
    console.error('[Auth] markInvitationUsed failed:', message);
    return res.status(500).json({
      success: false,
      code: 'server_error',
      message,
    });
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
    if ((user as any).status === 'deleted' && (user as any).role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Your company account has been disabled. Please contact the application owner.',
      });
    }
    if ((user as any).status === 'pending_verification' || (user as any).emailVerified === false) {
      return res.status(403).json({
        success: false,
        message: 'Email verification required. Please complete email verification before signing in.',
      });
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
    if (String(user.status ?? '').toLowerCase() === 'deleted') {
      const purged = await purgeAdminAccountByEmail(user.email);
      if (!purged.ok) {
        return res.status(400).json({ success: false, message: purged.message || 'Could not release this email.' });
      }
      return res.json({ success: true, data: null, purged: true });
    }

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
      clientId: user.clientId,
      planType: user.planType,
      accessExpiresAt: user.accessExpiresAt,
    });
    return res.json({ success: true, data: saved });
  } catch (err) {
    console.error('[Auth] syncUser error:', err);
    return res.status(500).json({ success: false, message: 'Failed to sync user' });
  }
}

import {
  generateSecureToken,
  generateSmsCode,
  hashValue,
  timingSafeEqualStr,
  SMS_CODE_TTL_MS,
  SMS_RESEND_COOLDOWN_MS,
  MAX_SMS_ATTEMPTS,
} from '../services/auth/invitationService.js';
import { sendClientAdminInvitationEmail, sendClientAdminVerificationCodeEmail } from '../services/auth/adminVerification.js';
import { smsService, normalizePhoneE164, isPhoneE164Valid } from '../services/sms/smsService.js';

export async function createClientAdminInvite(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const rawPhone = String(req.body?.phone ?? '').trim();
    const companyName = String(req.body?.companyName ?? '').trim();
    const planType = (String(req.body?.planType ?? 'free').toLowerCase() === 'paid' ? 'paid' : 'free') as 'free' | 'paid';
    const durationDays = parseFloat(String(req.body?.durationDays ?? (planType === 'free' ? '30' : '365')));

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email address is required.' });
    }

    if (!rawPhone || !isPhoneE164Valid(rawPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Valid mobile number in E.164 format is required (e.g. +9779800000000).',
      });
    }

    const normalizedPhone = normalizePhoneE164(rawPhone);
    const now = new Date();
    const activeDays = Number.isNaN(durationDays) || durationDays <= 0 ? (planType === 'free' ? 30 : 365) : durationDays;
    const accessExpiresAt = new Date(now.getTime() + activeDays * 24 * 60 * 60 * 1000);
    const smsExpiresAt = new Date(now.getTime() + SMS_CODE_TTL_MS);

    // Single-use invitation token & 6-digit verification code
    const rawToken = generateSecureToken();
    const tokenHash = hashValue(rawToken);
    const smsCode = generateSmsCode();
    const smsCodeHash = hashValue(smsCode);

    // A new owner invitation means this email may register again.
    // Remove any leftover account first so signup is a clean identity.
    const { UserModel } = await import('../models/UserModel.js');
    const existingUser = await UserModel.getByEmail(email);
    if (existingUser && existingUser.role !== 'owner') {
      const isLiveAccount =
        (existingUser.status ?? 'active') === 'active' && existingUser.emailVerified !== false;
      if (!isLiveAccount) {
        await purgeAdminAccountByEmail(email);
      }
    }

    const existingInvite = await InvitationModel.getPendingByEmailAndRole(email, 'client_admin');
    const clientId = existingInvite?.client_id || `client-org-${Date.now()}`;
    const inviteId = existingInvite?.id || `inv-${Date.now()}`;

    // Validate public URL configuration before performing DB or email delivery operations
    let publicOrigin = (env.appPublicUrl || '').trim().replace(/\/+$/, '');
    if (!publicOrigin && env.nodeEnv === 'development') {
      publicOrigin = 'http://127.0.0.1:3002';
    }

    const isProduction = env.nodeEnv === 'production';
    const isLoopback = !publicOrigin || /localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[01])\./i.test(publicOrigin);

    if (isProduction && isLoopback) {
      return res.status(400).json({
        success: false,
        message: 'Invitation link configuration is missing or invalid. Please configure APP_PUBLIC_URL with your public HTTPS domain (e.g. https://attendance.appnep.com).',
      });
    }

    if (!publicOrigin) {
      return res.status(400).json({
        success: false,
        message: 'Invitation link configuration is missing. Please configure the application public URL.',
      });
    }

    const publicLink = `${publicOrigin}/client-admin/signup?token=${rawToken}`;

    const invitationRecord = {
      id: inviteId,
      token: rawToken,
      email,
      role: 'client_admin',
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + Math.max(24 * 60 * 60 * 1000, activeDays * 24 * 60 * 60 * 1000)).toISOString(),
      used: false,
      client_id: clientId,
      phone: normalizedPhone,
      company_name: companyName || undefined,
      plan_type: planType,
      duration_days: activeDays,
      access_start_at: now.toISOString(),
      access_expires_at: accessExpiresAt.toISOString(),
      token_hash: tokenHash,
      sms_code_hash: smsCodeHash,
      sms_expires_at: smsExpiresAt.toISOString(),
      sms_attempts: 0,
      sms_last_sent_at: now.toISOString(),
      status: 'pending' as const,
      created_by: (req as any).user?.id || 'owner',
      updated_at: now.toISOString(),
    };

    await InvitationModel.save(invitationRecord);

    // Format duration for display
    const durationLabel =
      activeDays < 1
        ? `${Math.round(activeDays * 24)} Hours`
        : activeDays === 1
          ? '1 Day'
          : `${activeDays} Days`;

    // 1. Send 6-digit verification code to the invited client admin email
    const mailRes = await sendClientAdminInvitationEmail({
      to: email,
      companyName,
      planType,
      durationLabel,
      expiresAtFormatted: accessExpiresAt.toLocaleString(),
      inviteLink: publicLink,
      verificationCode: smsCode,
    });

    if (!mailRes.sent) {
      return res.status(503).json({
        success: false,
        emailSent: false,
        codeEmailSent: false,
        message: mailRes.error
          ? `Failed to deliver the 6-digit verification code (${mailRes.error}).`
          : 'Failed to deliver the 6-digit verification code to the invited email.',
      });
    }

    logInvitationDebug('client-admin-invite-created', {
      token: rawToken,
      createdAt: now,
      expiresAt: accessExpiresAt,
      serverNow: now,
      status: 'pending',
      emailSent: mailRes.sent,
      codeEmailSent: mailRes.sent,
    });

    return res.json({
      success: true,
      emailSent: mailRes.sent,
      codeEmailSent: mailRes.sent,
      message: `6-digit verification code emailed to ${email}.`,
      inviteLink: publicLink,
      devSmsCode: mailRes.devFallback ? smsCode : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create client admin invitation';
    console.error('[Auth] createClientAdminInvite error:', message);
    return res.status(500).json({ success: false, message: 'Internal server error while creating client admin invitation.' });
  }
}

export async function validateClientAdminInvite(req: Request, res: Response) {
  try {
    const tokenParam = String(req.query.token || req.params.token || '').trim();
    if (!tokenParam) {
      return res.status(400).json({ success: false, code: 'invalid_token', message: 'Invitation token is required.' });
    }

    const tokenHash = hashValue(tokenParam);
    const inv = await InvitationModel.getByTokenHash(tokenHash) || await InvitationModel.getByToken(tokenParam);

    if (!inv) {
      return res.status(404).json({ success: false, code: 'not_found', message: 'Invitation not found.' });
    }

    const serverNow = new Date();
    const validation = validateInvitationRecord(inv, serverNow);

    if (!validation.ok) {
      return res.status(410).json({ success: false, code: validation.code, message: validation.message });
    }

    return res.json({
      success: true,
      data: serializeInvitation(inv),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to validate invitation';
    console.error('[Auth] validateClientAdminInvite error:', message);
    return res.status(500).json({ success: false, code: 'server_error', message: 'Server error validating invitation.' });
  }
}

export async function resendClientAdminSms(req: Request, res: Response) {
  try {
    const tokenParam = String(req.body?.token ?? '').trim();
    if (!tokenParam) {
      return res.status(400).json({ success: false, message: 'Invitation token is required.' });
    }

    const tokenHash = hashValue(tokenParam);
    const inv = await InvitationModel.getByTokenHash(tokenHash) || await InvitationModel.getByToken(tokenParam);

    if (!inv) {
      return res.status(404).json({ success: false, message: 'Invitation not found.' });
    }

    const validation = validateInvitationRecord(inv, new Date());
    if (!validation.ok) {
      return res.status(410).json({ success: false, message: validation.message });
    }

    const now = new Date();

    // Check cooldown (60 seconds)
    if (inv.sms_last_sent_at) {
      const lastSent = new Date(inv.sms_last_sent_at).getTime();
      if (!Number.isNaN(lastSent) && now.getTime() - lastSent < SMS_RESEND_COOLDOWN_MS) {
        const remainingSec = Math.ceil((SMS_RESEND_COOLDOWN_MS - (now.getTime() - lastSent)) / 1000);
        return res.status(429).json({
          success: false,
          code: 'cooldown_active',
          remainingSeconds: remainingSec,
          message: `Please wait ${remainingSec} seconds before requesting a new verification code.`,
        });
      }
    }

    // Check maximum resend limit per invitation (max 5 resends)
    const MAX_RESEND_LIMIT = 5;
    if ((inv.sms_attempts ?? 0) >= MAX_RESEND_LIMIT) {
      return res.status(429).json({
        success: false,
        code: 'too_many_resends',
        message: 'Maximum resend limit reached for this invitation. Please contact support or request a new invitation.',
      });
    }

    // Generate new code and invalidate previous code
    const newSmsCode = generateSmsCode();
    const newSmsCodeHash = hashValue(newSmsCode);
    const newSmsExpiresAt = new Date(now.getTime() + SMS_CODE_TTL_MS).toISOString();

    await InvitationModel.updateSmsCode(inv.token_hash || tokenHash, newSmsCodeHash, newSmsExpiresAt);

    // Send 6-digit code to the invited client admin email
    const codeRes = await sendClientAdminVerificationCodeEmail({
      to: inv.email,
      code: newSmsCode,
      clientEmail: inv.email,
      companyName: inv.company_name,
    });

    if (!codeRes.sent) {
      return res.status(503).json({
        success: false,
        message: codeRes.error || 'Failed to send verification code email.',
      });
    }

    return res.json({
      success: true,
      message: codeRes.devFallback
        ? `[Dev Mode] Verification code generated for ${inv.email}.`
        : `A new 6-digit verification code has been sent to ${inv.email}.`,
      devSmsCode: codeRes.devFallback ? newSmsCode : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resend verification code';
    console.error('[Auth] resendClientAdminSms error:', message);
    return res.status(500).json({ success: false, message: 'Failed to resend verification code.' });
  }
}

export async function signupClientAdmin(req: Request, res: Response) {
  try {
    const tokenParam = String(req.body?.token ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    const password = String(req.body?.password ?? '');
    const smsCode = String(req.body?.smsCode ?? '').trim();

    if (!tokenParam || !name || !password || !smsCode) {
      return res.status(400).json({ success: false, message: 'All fields (name, password, 6-digit SMS code) are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    const tokenHash = hashValue(tokenParam);
    const inv = await InvitationModel.getByTokenHash(tokenHash) || await InvitationModel.getByToken(tokenParam);

    if (!inv) {
      return res.status(404).json({ success: false, code: 'not_found', message: 'Invitation not found.' });
    }

    const now = new Date();
    const validation = validateInvitationRecord(inv, now);
    if (!validation.ok) {
      return res.status(410).json({ success: false, code: validation.code, message: validation.message });
    }

    // Check SMS code expiration
    if (!inv.sms_expires_at || new Date(inv.sms_expires_at) < now) {
      return res.status(400).json({
        success: false,
        code: 'code_expired',
        message: 'The SMS verification code has expired. Please click "Resend Code".',
      });
    }

    // Check maximum SMS verification attempts
    if ((inv.sms_attempts ?? 0) >= MAX_SMS_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        code: 'too_many_attempts',
        message: 'Too many incorrect attempts. Please request a new SMS verification code.',
      });
    }

    // Secure timing-safe verification of 6-digit SMS code
    const providedCodeHash = hashValue(smsCode);
    const codeMatches = inv.sms_code_hash
      ? timingSafeEqualStr(providedCodeHash, inv.sms_code_hash)
      : false;

    if (!codeMatches) {
      const attempts = await InvitationModel.incrementSmsAttempt(inv.token_hash || tokenHash);
      const remaining = Math.max(0, MAX_SMS_ATTEMPTS - attempts);
      return res.status(400).json({
        success: false,
        code: 'invalid_code',
        message: remaining > 0
          ? `Incorrect 6-digit SMS code. ${remaining} attempts remaining.`
          : 'Incorrect SMS code. Attempt limit exceeded. Please resend a new code.',
      });
    }

    // Create a brand-new account. Leftover deleted/pending rows for this email
    // are removed first so signup does not reuse the previous identity.
    const { UserModel } = await import('../models/UserModel.js');
    const existing = await UserModel.getByEmail(inv.email);
    if (existing) {
      await purgeAdminAccountByEmail(inv.email, { keepInvitations: true });
    }

    const userObj = {
      id: `usr-${Date.now()}`,
      name,
      email: inv.email,
      role: 'admin', // Admin of the invited client organization
      password,
      phone: inv.phone || undefined,
      clientId: inv.client_id || `client-org-${Date.now()}`,
      companyName: inv.company_name || name,
      planType: (inv.plan_type === 'paid' ? 'paid' : 'free') as 'free' | 'paid',
      accessExpiresAt: inv.access_expires_at || inv.expires_at,
    };

    const savedUser = await UserModel.upsert(userObj);

    // Mark invitation as used and accepted
    await InvitationModel.markUsed(inv.token);

    logInvitationDebug('client-admin-signup-completed', {
      token: tokenParam,
      status: 'accepted',
      serverNow: now,
    });

    return res.json({
      success: true,
      message: 'Account created successfully! You can now sign in.',
      data: savedUser,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to complete sign-up';
    console.error('[Auth] signupClientAdmin error:', message);
    return res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
}

export async function verifyAdminSignupInvite(req: Request, res: Response) {
  try {
    const invitationCode = String(req.body?.invitationCode ?? req.body?.code ?? '').trim();
    const phoneInput = String(req.body?.phone ?? '').trim();

    if (!invitationCode) {
      return res.status(400).json({ success: false, message: 'Invitation code is required.' });
    }
    if (!phoneInput) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    const normalizedPhone = normalizePhoneE164(phoneInput);
    if (!normalizedPhone || !isPhoneE164Valid(phoneInput)) {
      return res.status(400).json({
        success: false,
        message: 'Enter a valid phone number (e.g. +9779851064130 or 9851064130).',
      });
    }

    const codeHash = hashValue(invitationCode);
    // Owner shares the 6-digit invitation/SMS code; also accept raw token / token hash.
    const inv =
      (await InvitationModel.getBySmsCodeHash(codeHash)) ||
      (await InvitationModel.getByTokenHash(codeHash)) ||
      (await InvitationModel.getByToken(invitationCode));

    if (!inv) {
      return res.status(404).json({ success: false, message: 'Invalid or expired invitation code.' });
    }

    const invitePhone = inv.phone ? normalizePhoneE164(inv.phone) : '';
    if (invitePhone && invitePhone !== normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number does not match this invitation. Use the mobile number the Owner registered.',
      });
    }

    const serverNow = new Date();
    const validation = validateInvitationRecord(inv, serverNow);

    if (!validation.ok) {
      return res.status(410).json({ success: false, message: validation.message });
    }

    const days = Number(inv.duration_days) || 30;
    const planLabel = inv.plan_type === 'paid' ? 'Paid Subscription' : 'Free Trial';
    const durationLabel = days < 1
      ? `${Math.round(days * 24)} Hours (${planLabel})`
      : days === 1
        ? `1 Day (${planLabel})`
        : `${days} Days (${planLabel})`;

    return res.json({
      success: true,
      invitation: {
        invitationToken: inv.token,
        companyName: inv.company_name || 'Organization',
        invitedEmail: inv.email,
        invitingOwner: inv.created_by || 'Owner',
        packageDuration: durationLabel,
        phone: inv.phone || normalizedPhone,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to verify invitation';
    console.error('[Auth] verifyAdminSignupInvite error:', message);
    return res.status(500).json({ success: false, message: 'Server error verifying invitation.' });
  }
}

export async function submitAdminSignup(req: Request, res: Response) {
  try {
    const invitationToken = String(req.body?.invitationToken ?? req.body?.token ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    const password = String(req.body?.password ?? '');
    const phone = String(req.body?.phone ?? '').trim();

    if (!invitationToken || !name || !password) {
      return res.status(400).json({ success: false, message: 'Full name, password, and invitation token are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    const tokenHash = hashValue(invitationToken);
    const inv =
      (await InvitationModel.getByTokenHash(tokenHash)) ||
      (await InvitationModel.getByToken(invitationToken));

    if (!inv) {
      return res.status(404).json({ success: false, message: 'Invitation not found.' });
    }

    const validation = validateInvitationRecord(inv, new Date());
    if (!validation.ok) {
      return res.status(410).json({ success: false, message: validation.message });
    }

    const { UserModel } = await import('../models/UserModel.js');
    const existing = await UserModel.getByEmail(inv.email);
    if (existing && existing.status === 'active' && existing.emailVerified) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email address already exists and is active. Please sign in.',
      });
    }

    await UserModel.upsert({
      id: existing?.id || `usr-${Date.now()}`,
      name,
      email: inv.email,
      role: 'admin',
      password,
      phone: phone || inv.phone || undefined,
      clientId: inv.client_id || `client-org-${Date.now()}`,
      companyName: inv.company_name || name,
      planType: (inv.plan_type === 'paid' ? 'paid' : 'free') as 'free' | 'paid',
      accessExpiresAt: inv.access_expires_at || inv.expires_at,
      status: 'pending_verification',
      emailVerified: false,
    });

    if (!canResendVerificationCode(inv.email)) {
      return res.status(429).json({
        success: false,
        message: 'Please wait 60 seconds before requesting a new verification code.',
      });
    }

    const code = generateVerificationCode();
    storeVerificationCode(inv.email, code);

    if (env.nodeEnv !== 'production') {
      console.log(`[Auth DEV MODE] Verification code generated for invited Admin (${inv.email}): ${code}`);
    }

    const mail = await sendAdminVerificationEmail({
      to: inv.email,
      name,
      code,
    });

    if (!mail.sent) {
      return res.status(503).json({
        success: false,
        emailSent: false,
        message: mail.error || 'Could not send verification code email. Check SMTP settings.',
      });
    }

    return res.json({
      success: true,
      emailSent: true,
      email: inv.email,
      message: `Verification code sent to ${inv.email}.`,
      devCode: mail.devFallback ? code : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to submit sign up';
    console.error('[Auth] submitAdminSignup error:', message);
    return res.status(500).json({ success: false, message: 'Server error during sign up registration.' });
  }
}

export async function verifyAdminSignupEmail(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const code = String(req.body?.code ?? '').trim();
    const invitationToken = String(req.body?.invitationToken ?? req.body?.token ?? '').trim();

    if (!email || !code) {
      return res.status(400).json({ success: false, message: 'Email and verification code are required.' });
    }

    const verification = verifyStoredCode(email, code);
    if (!verification.ok) {
      return res.status(400).json({ success: false, message: verification.message });
    }

    const { UserModel } = await import('../models/UserModel.js');
    await UserModel.updateStatus(email, 'active', true);

    if (invitationToken) {
      await InvitationModel.markUsed(invitationToken);
    }

    return res.json({
      success: true,
      message: 'Admin account created successfully. You can now sign in.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to verify email';
    console.error('[Auth] verifyAdminSignupEmail error:', message);
    return res.status(500).json({ success: false, message: 'Server error verifying code.' });
  }
}

export async function resendAdminSignupEmail(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    if (!canResendVerificationCode(email)) {
      return res.status(429).json({
        success: false,
        message: 'Please wait 60 seconds before requesting a new verification code.',
      });
    }

    const { UserModel } = await import('../models/UserModel.js');
    const user = await UserModel.getByEmail(email);
    const name = user?.name || 'Admin';

    const code = generateVerificationCode();
    storeVerificationCode(email, code);

    if (env.nodeEnv !== 'production') {
      console.log(`[Auth DEV MODE] Resent verification code for invited Admin (${email}): ${code}`);
    }

    const mail = await sendAdminVerificationEmail({
      to: email,
      name,
      code,
    });

    if (!mail.sent) {
      return res.status(503).json({
        success: false,
        message: mail.error || 'Could not send verification code email.',
      });
    }

    return res.json({
      success: true,
      emailSent: true,
      message: `Verification code resent to ${email}.`,
      devCode: mail.devFallback ? code : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resend code';
    console.error('[Auth] resendAdminSignupEmail error:', message);
    return res.status(500).json({ success: false, message: 'Server error resending code.' });
  }
}

export async function purgeAdminAccount(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const result = await purgeAdminAccountByEmail(email);
    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.message || 'Could not delete this account.' });
    }
    return res.json({
      success: true,
      purgedEmail: result.purgedEmail,
      message: 'Account and invitation history for this email were removed. The email can sign up again.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete admin account';
    console.error('[Auth] purgeAdminAccount error:', message);
    return res.status(500).json({ success: false, message: 'Server error deleting admin account.' });
  }
}


