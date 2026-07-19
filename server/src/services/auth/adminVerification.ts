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

export function generateVerificationCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

export function storeVerificationCode(email: string, code: string): void {
  pendingCodes.set(normalizeEmail(email), {
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
  to: string;
  name: string;
  code: string;
}): Promise<{ sent: boolean; error?: string }> {
  if (!smtpConfigured()) {
    console.warn(
      '[Auth] SMTP not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in server/.env to send verification emails.',
    );
    return {
      sent: false,
      error: 'Email service is not configured. Set SMTP_USER and SMTP_PASS in server/.env (SMTP_HOST is already set), then restart the server.',
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
      subject: 'Admin signup verification code',
      text: [
        `Hello ${input.name || 'Admin'},`,
        '',
        `Your verification code is: ${input.code}`,
        '',
        'This code expires in 10 minutes.',
        '',
        'If you did not request this, ignore this email.',
      ].join('\n'),
      html: `
      <p>Hello ${input.name || 'Admin'},</p>
      <p>Your admin signup verification code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px">${input.code}</p>
      <p>This code expires in 10 minutes.</p>
    `,
    });

    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email';
    console.error('[Auth] Failed to send verification email:', message);
    return { sent: false, error: message };
  }
}
