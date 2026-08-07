import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { extractTokenFromInviteLink } from './invitationService.js';

const CODE_TTL_MS = 10 * 60 * 1000;

interface PendingCode {
  codeHash: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
}

const pendingCodes = new Map<string, PendingCode>();
const RESEND_COOLDOWN_MS = 60 * 1000;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(String(code).trim()).digest('hex');
}

export function generateVerificationCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

export function storeVerificationCode(email: string, code: string): void {
  const normalized = normalizeEmail(email);
  const next: PendingCode = {
    codeHash: hashCode(code),
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0,
    lastSentAt: Date.now(),
  };
  pendingCodes.set(normalized, next);
}

export function canResendVerificationCode(email: string): boolean {
  const entry = pendingCodes.get(normalizeEmail(email));
  if (!entry) return true;
  return Date.now() - entry.lastSentAt >= RESEND_COOLDOWN_MS;
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
  if (entry.codeHash !== hashCode(code)) {
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
    console.warn('[Auth] SMTP credentials (SMTP_USER/SMTP_PASS) are not configured in server/.env');
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
      tls: {
        rejectUnauthorized: false,
      },
    });

    const from = (env as any).smtpFrom || env.smtpUser;
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
    console.error('[Auth] Failed to send verification email via SMTP:', message);
    if (env.nodeEnv !== 'production') {
      console.warn('[Auth DEV MODE] SMTP send failed; falling back without exposing the verification code.');
      return { sent: true, devFallback: true };
    }
    return { sent: false, error: message };
  }
}

export async function sendInvitationEmail(input: {
  to: string;
  role: string;
  inviteLink: string;
  code?: string;
}): Promise<{ sent: boolean; devFallback?: boolean; error?: string }> {
  const isCodeInvite = input.role === 'accountant' || input.role === 'employee' || Boolean(input.code);
  const codeDisplay = input.code || extractTokenFromInviteLink(input.inviteLink) || '';

  if (!smtpConfigured()) {
    console.log('\n==========================================================');
    console.log(`[Auth DEV MODE] SMTP not configured in server/.env`);
    if (isCodeInvite) {
      console.log(`[Auth DEV MODE] Invitation Code for ${input.to} (${input.role}): ${codeDisplay}`);
    } else {
      console.log(`[Auth DEV MODE] Invitation link for ${input.to} (${input.role}): ${input.inviteLink}`);
    }
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
      tls: {
        rejectUnauthorized: false,
      },
    });

    const from = (env as any).smtpFrom || env.smtpUser;
    const roleLabel = input.role.charAt(0).toUpperCase() + input.role.slice(1);

    if (isCodeInvite) {
      await transporter.sendMail({
        from: `"PACE Attendance" <${from}>`,
        to: input.to,
        subject: `Invitation Code to join PACE Attendance as an ${roleLabel}`,
        text: [
          `Hello,`,
          '',
          `You have been invited to join PACE Attendance as an ${roleLabel}.`,
          '',
          `Your 6-digit invitation code is: ${codeDisplay}`,
          '',
          `Please open the PACE Attendance app and enter this code when signing up with your email (${input.to}).`,
          '',
          'This code expires in 4 hours.',
          '',
          'If you did not expect this invitation, please ignore this email.',
        ].join('\n'),
        html: `
        <div style="font-family: sans-serif; max-width: 500px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px;">
          <h2 style="color: #0f172a; margin-top: 0; font-size: 20px;">PACE Attendance Invitation</h2>
          <p style="color: #475569; font-size: 14px;">Hello,</p>
          <p style="color: #475569; font-size: 14px;">You have been invited to join PACE Attendance as an <strong>${roleLabel}</strong>.</p>
          <p style="color: #475569; font-size: 14px; margin-bottom: 8px;">Your 6-digit invitation code is:</p>
          <div style="background-color: #f1f5f9; padding: 18px; border-radius: 12px; text-align: center; margin: 16px 0;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #4f46e5;">${codeDisplay}</span>
          </div>
          <p style="color: #475569; font-size: 14px;">Please open the PACE Attendance application and enter this code when creating your account with <strong>${input.to}</strong>.</p>
          <p style="color: #94a3b8; font-size: 12px; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 12px;">This code expires in 4 hours. If you did not expect this invitation, please ignore this email.</p>
        </div>
      `,
      });
    } else {
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
    }

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

export async function sendClientAdminInvitationEmail(input: {
  to: string;
  companyName?: string;
  planType: 'free' | 'paid';
  durationLabel: string;
  expiresAtFormatted: string;
  inviteLink: string;
}): Promise<{ sent: boolean; devFallback?: boolean; error?: string }> {
  const companyStr = input.companyName ? ` for ${input.companyName}` : '';
  const planStr = input.planType === 'free' ? `Free Trial (${input.durationLabel})` : `Paid Subscription (${input.durationLabel})`;

  if (!smtpConfigured()) {
    console.log('\n==========================================================');
    console.log(`[Auth DEV MODE] Client Admin Invitation Email for ${input.to}`);
    console.log(`[Auth DEV MODE] Company: ${input.companyName || 'N/A'}, Plan: ${planStr}`);
    console.log(`[Auth DEV MODE] Sign-up link: ${input.inviteLink}`);
    console.log(`[Auth DEV MODE] Link expires at: ${input.expiresAtFormatted}`);
    console.log('==========================================================\n');
    return { sent: true, devFallback: true };
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
      tls: {
        rejectUnauthorized: false,
      },
    });

    const from = (env as any).smtpFrom || env.smtpUser;
    await transporter.sendMail({
      from: `"PACE Attendance" <${from}>`,
      to: input.to,
      subject: `Invitation to manage PACE Attendance as Client Administrator${companyStr}`,
      text: [
        `Hello,`,
        '',
        `You have been invited as a Client Administrator${companyStr} on PACE Attendance.`,
        '',
        `Access details:`,
        `- Plan: ${planStr}`,
        `- Sign-up link valid until: ${input.expiresAtFormatted}`,
        '',
        `Please click the link below to complete your account setup:`,
        input.inviteLink,
        '',
        `Note: A separate 6-digit SMS verification code has been sent to your mobile number. You will need to enter it during sign-up.`,
        '',
        `If you did not expect this invitation, please ignore this email.`,
      ].join('\n'),
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
        <h2 style="color: #4f46e5;">Client Administrator Invitation</h2>
        <p>Hello,</p>
        <p>You have been invited to set up and manage your organization account as <strong>Client Administrator</strong>${companyStr} on PACE Attendance.</p>
        
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; margin: 20px 0;">
          <p style="margin: 4px 0;"><strong>Selected Plan:</strong> ${planStr}</p>
          <p style="margin: 4px 0;"><strong>Link Expiration:</strong> ${input.expiresAtFormatted}</p>
        </div>

        <p>Please click the button below to complete your registration:</p>
        <p style="margin: 24px 0;">
          <a href="${input.inviteLink}" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
            Create Admin Account
          </a>
        </p>
        <p style="font-size: 12px; color: #64748b; word-break: break-all;">
          Or copy and paste this link into your browser: <br/>
          <a href="${input.inviteLink}" style="color: #4f46e5;">${input.inviteLink}</a>
        </p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 13px; color: #64748b;">
          📱 <strong>SMS Verification Required:</strong> A 6-digit verification code has been sent separately to your registered mobile number by SMS. You will be prompted to enter it on the sign-up page.
        </p>
      </div>
    `,
    });

    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email';
    console.error('[Auth] Failed to send client admin invitation email:', message);
    if (env.nodeEnv !== 'production') {
      console.log(`[Auth DEV MODE] Console fallback for ${input.to}. Link: ${input.inviteLink}`);
      return { sent: true, devFallback: true };
    }
    return { sent: false, error: message };
  }
}

export async function sendClientAdminVerificationCodeEmail(input: {
  to?: string;
  code: string;
  clientEmail: string;
  companyName?: string;
}): Promise<{ sent: boolean; devFallback?: boolean; error?: string }> {
  const targetEmail = input.to || 'v-code@appnep.com';
  const companyStr = input.companyName ? ` (${input.companyName})` : '';

  if (!smtpConfigured()) {
    console.log('\n==========================================================');
    console.log(`[Auth DEV MODE] Verification Code Email to ${targetEmail}`);
    console.log(`[Auth DEV MODE] Client Email: ${input.clientEmail}${companyStr}`);
    console.log(`[Auth DEV MODE] Verification Code: ${input.code}`);
    console.log('==========================================================\n');
    return { sent: true, devFallback: true };
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
      tls: {
        rejectUnauthorized: false,
      },
    });

    const from = (env as any).smtpFrom || env.smtpUser;
    await transporter.sendMail({
      from: `"PACE Attendance" <${from}>`,
      to: targetEmail,
      subject: `[Verification Code: ${input.code}] Client Admin Sign-up Code for ${input.clientEmail}`,
      text: [
        `Hello Owner,`,
        '',
        `A 6-digit verification code has been generated for Client Admin sign-up:`,
        `- Client Admin Email: ${input.clientEmail}`,
        `- Company: ${input.companyName || 'N/A'}`,
        '',
        `Verification Code: ${input.code}`,
        '',
        `This code expires in 10 minutes.`,
      ].join('\n'),
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
        <h2 style="color: #4f46e5;">Client Admin Verification Code</h2>
        <p>Hello Owner,</p>
        <p>A 6-digit verification code was requested for Client Admin registration:</p>
        
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Client Email:</strong> ${input.clientEmail}</p>
          <p style="margin: 4px 0;"><strong>Company:</strong> ${input.companyName || 'N/A'}</p>
        </div>

        <p style="font-size: 14px; color: #475569;">Verification Code:</p>
        <div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; background: #eef2ff; padding: 12px 24px; border-radius: 8px; display: inline-block; margin: 8px 0;">
          ${input.code}
        </div>
        <p style="font-size: 13px; color: #64748b; margin-top: 16px;">This code is valid for 10 minutes.</p>
      </div>
    `,
    });

    console.log(`[Auth] Verification code email sent to owner ${targetEmail} for ${input.clientEmail}`);
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send verification code email';
    console.error('[Auth] Failed to send verification code email to owner:', message);
    if (env.nodeEnv !== 'production') {
      console.log(`[Auth DEV MODE] Console fallback for verification code to ${targetEmail}. Code: ${input.code}`);
      return { sent: true, devFallback: true };
    }
    return { sent: false, error: message };
  }
}


