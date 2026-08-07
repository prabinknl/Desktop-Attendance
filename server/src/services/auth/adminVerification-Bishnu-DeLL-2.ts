import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';

const CODE_TTL_MS = 10 * 60 * 1000;

interface PendingCode {
  code: string;
  expiresAt: number;
  attempts: number;
}

const pendingCodes = new Map<string, PendingCode>();

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const RESEND_COOLDOWN_MS = 60 * 1000;
const lastSentAt = new Map<string, number>();

export function canResendVerificationCode(email: string): boolean {
  const key = normalizeEmail(email);
  const last = lastSentAt.get(key);
  if (last && Date.now() - last < RESEND_COOLDOWN_MS) {
    return false;
  }
  return true;
}

export function generateVerificationCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

export function storeVerificationCode(email: string, code: string): void {
  const key = normalizeEmail(email);
  lastSentAt.set(key, Date.now());
  pendingCodes.set(key, {
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0,
  });
}

export function verifyStoredCode(email: string, code: string): { ok: boolean; message?: string } {
  const key = normalizeEmail(email);
  const entry = pendingCodes.get(key);
  if (!entry) {
    return { ok: false, message: 'No verification code found. Please send a new code.' };
  }
  if (Date.now() > entry.expiresAt) {
    pendingCodes.delete(key);
    return { ok: false, message: 'Verification code expired. Please send a new code.' };
  }
  entry.attempts += 1;
  if (entry.attempts > 5) {
    pendingCodes.delete(key);
    return { ok: false, message: 'Too many attempts. Please send a new code.' };
  }
  if (entry.code !== String(code).trim()) {
    return { ok: false, message: 'Invalid verification code.' };
  }
  pendingCodes.delete(key);
  return { ok: true };
}

function smtpConfigured(): boolean {
  return Boolean(env.smtpHost && env.smtpUser && env.smtpPass);
}

export async function sendAdminVerificationEmail(input: {
  to: string | string[];
  name: string;
  code: string;
}): Promise<{ sent: boolean; devFallback?: boolean; error?: string }> {
  if (!smtpConfigured()) {
    const recipientStr = Array.isArray(input.to) ? input.to.join(', ') : input.to;
    console.warn('[Auth] SMTP credentials (SMTP_USER/SMTP_PASS) are not configured in server/.env');
    if (env.nodeEnv !== 'production') {
      console.log('\n==========================================================');
      console.log(`[Auth DEV MODE] SMTP not configured. Using console fallback.`);
      console.log(`[Auth DEV MODE] Verification Code for ${recipientStr}: ${input.code}`);
      console.log('==========================================================\n');
      return { sent: true, devFallback: true };
    }
    return {
      sent: false,
      error: 'SMTP credentials (SMTP_USER and SMTP_PASS) are not configured in server/.env. Please set your SMTP credentials to send verification emails.',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPass,
      },
    });

    const from = env.smtpFrom || env.smtpUser;
    await transporter.sendMail({
      from: `"PACE Attendance" <${from}>`,
      to: input.to,
      subject: 'Owner verification code',
      text: [
        `Hello ${input.name || 'Owner'},`,
        '',
        `Your verification code is: ${input.code}`,
        '',
        'This code expires in 10 minutes.',
        '',
        'If you did not request this, ignore this email.',
      ].join('\n'),
      html: `
      <p>Hello ${input.name || 'Owner'},</p>
      <p>Your verification code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px">${input.code}</p>
      <p>This code expires in 10 minutes.</p>
    `,
    });

    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email';
    const recipientStr = Array.isArray(input.to) ? input.to.join(', ') : input.to;
    console.error('[Auth] Failed to send verification email via SMTP:', message);
    if (env.nodeEnv !== 'production') {
      console.log('\n==========================================================');
      console.log(`[Auth DEV MODE] SMTP send failed (${message}). Using console fallback.`);
      console.log(`[Auth DEV MODE] Verification Code for ${recipientStr}: ${input.code}`);
      console.log('==========================================================\n');
      return { sent: true, devFallback: true };
    }
    return { sent: false, error: message };
  }
}

export async function sendInvitationEmail(input: {
  to: string;
  role: string;
  inviteLink: string;
}): Promise<{ sent: boolean; devFallback?: boolean; error?: string }> {
  if (!smtpConfigured()) {
    console.log('\n==========================================================');
    console.log(`[Auth DEV MODE] SMTP not configured in server/.env`);
    console.log(`[Auth DEV MODE] Invitation link for ${input.to} (${input.role}): ${input.inviteLink}`);
    console.log('==========================================================\n');
    return {
      sent: true,
      devFallback: true,
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPass,
      },
    });

    const from = env.smtpFrom || env.smtpUser;
    const roleLabel = input.role.charAt(0).toUpperCase() + input.role.slice(1);
    await transporter.sendMail({
      from: `"PACE Attendance" <${from}>`,
      to: input.to,
      subject: `Invitation to join PACE Attendance as an ${roleLabel}`,
      text: [
        `Hello,`,
        '',
        `You have been invited to join PACE Attendance as an ${roleLabel}.`,
        '',
        `Please click the link below to complete your sign-up:`,
        input.inviteLink,
        '',
        'This link expires in 4 hours.',
        '',
        'If you did not expect this invitation, please ignore this email.',
      ].join('\n'),
      html: `
      <p>Hello,</p>
      <p>You have been invited to join PACE Attendance as an <strong>${roleLabel}</strong>.</p>
      <p>Please click the link below to complete your sign-up:</p>
      <p><a href="${input.inviteLink}" style="display:inline-block;background-color:#10b981;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:bold;">Accept Invitation</a></p>
      <p>Or copy and paste this URL into your browser:</p>
      <p style="word-break:break-all;"><a href="${input.inviteLink}">${input.inviteLink}</a></p>
      <p>This link expires in 4 hours.</p>
      <p>If you did not expect this invitation, please ignore this email.</p>
    `,
    });

    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email';
    console.error('[Auth] Failed to send invitation email:', message);
    if (env.nodeEnv !== 'production') {
      console.log('\n==========================================================');
      console.log(`[Auth DEV MODE] SMTP send failed. Using console fallback.`);
      console.log(`[Auth DEV MODE] Invitation link for ${input.to} (${input.role}): ${input.inviteLink}`);
      console.log('==========================================================\n');
      return { sent: true, devFallback: true };
    }
    return { sent: false, error: message };
  }
}

