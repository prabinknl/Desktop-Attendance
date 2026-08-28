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

export function clearVerificationCode(email: string): void {
  pendingCodes.delete(normalizeEmail(email));
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

function redactSmtpSecrets(text: string): string {
  let safe = text;
  const pass = process.env.SMTP_PASS ?? '';
  const user = (process.env.SMTP_USER ?? '').trim();
  if (pass) safe = safe.split(pass).join('[redacted]');
  if (user) safe = safe.split(user).join('[redacted]');
  return safe;
}

function smtpErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code?: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  return '';
}

function smtpResponseCode(err: unknown): number {
  if (err && typeof err === 'object' && 'responseCode' in err) {
    const code = Number((err as { responseCode?: unknown }).responseCode);
    return Number.isFinite(code) ? code : 0;
  }
  return 0;
}

function classifySmtpError(err: unknown): string {
  const code = smtpErrorCode(err);
  const responseCode = smtpResponseCode(err);
  const raw = redactSmtpSecrets(err instanceof Error ? err.message : String(err));

  if (code === 'EAUTH' || responseCode === 535 || /invalid login|authentication failed|535-5\.7/i.test(raw)) {
    return 'SMTP authentication failure';
  }
  if (code === 'ETIMEDOUT' || code === 'ETIME' || /timeout/i.test(raw)) {
    return 'SMTP connection timeout';
  }
  if (
    code === 'EENVELOPE' ||
    responseCode === 550 ||
    responseCode === 551 ||
    responseCode === 553 ||
    /invalid recipient|mailbox unavailable|user unknown|550[- ]5\./i.test(raw)
  ) {
    return 'invalid recipient';
  }
  if (code === 'ECONNECTION' || code === 'ESOCKET' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return 'SMTP connection failed';
  }
  return raw ? `email delivery failed: ${raw}` : 'email delivery failed';
}

function logSmtpFailure(context: string, err: unknown): void {
  console.error(`[Auth] ${context}:`, classifySmtpError(err));
}

function smtpConfigError(): string {
  const missing: string[] = [];
  if (!(process.env.SMTP_HOST ?? '').trim()) missing.push('SMTP_HOST');
  if (!(process.env.SMTP_USER ?? '').trim()) missing.push('SMTP_USER');
  if (!(process.env.SMTP_PASS ?? '')) missing.push('SMTP_PASS');
  if (missing.length === 0) return '';
  return `Missing required email environment variables: ${missing.join(', ')}. Set them in the hosting environment, not as VITE_* variables.`;
}

function smtpConfigured(): boolean {
  return smtpConfigError() === '';
}

function mailFromAddress(): string {
  return (process.env.SMTP_FROM ?? '').trim() || (process.env.SMTP_USER ?? '').trim();
}

function smtpSecureEnabled(port: number): boolean {
  const raw = (process.env.SMTP_SECURE ?? '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Hostinger and many mail hosts use implicit TLS on 465.
  return port === 465;
}

function createMailTransporter() {
  const host = (process.env.SMTP_HOST ?? '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = smtpSecureEnabled(port);
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: (process.env.SMTP_USER ?? '').trim(),
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    // Prefer IPv4 — some SMTP hosts (including Hostinger mail) reject IPv6.
    family: 4,
    tls: {
      rejectUnauthorized: false,
    },
  } as Parameters<typeof nodemailer.createTransport>[0]);
}

async function sendMailConfirmed(
  transporter: ReturnType<typeof nodemailer.createTransport>,
  options: Parameters<ReturnType<typeof nodemailer.createTransport>['sendMail']>[0],
) {
  const info = await transporter.sendMail(options);
  const accepted = Array.isArray(info.accepted) ? info.accepted : [];
  if (accepted.length === 0) {
    throw new Error(info.response || 'SMTP server did not accept the message');
  }
  return info;
}

export async function sendAdminVerificationEmail(input: {
  to: string | string[];
  name: string;
  code: string;
}): Promise<{ sent: boolean; devFallback?: boolean; error?: string }> {
  if (!smtpConfigured()) {
    console.log('\n==========================================================');
    console.log(`[Auth DEV MODE] SMTP not configured — Admin verification code for ${Array.isArray(input.to) ? input.to.join(', ') : input.to}: ${input.code}`);
    console.log('==========================================================\n');
    if (env.nodeEnv !== 'production') {
      return { sent: true, devFallback: true };
    }
    return {
      sent: false,
      error: smtpConfigError(),
    };
  }

  try {
    const transporter = createMailTransporter();

    const from = mailFromAddress();
    await sendMailConfirmed(transporter, {
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
    logSmtpFailure('Failed to send verification email', err);
    if (env.nodeEnv !== 'production') {
      console.log('\n==========================================================');
      console.log(`[Auth DEV MODE] SMTP send failed — Admin verification code for ${Array.isArray(input.to) ? input.to.join(', ') : input.to}: ${input.code}`);
      console.log('==========================================================\n');
      return { sent: true, devFallback: true };
    }
    return { sent: false, error: classifySmtpError(err) };
  }
}

export async function sendInvitationEmail(input: {
  to: string;
  name?: string;
  role: string;
  inviteLink: string;
  code?: string;
}): Promise<{ sent: boolean; devFallback?: boolean; error?: string }> {
  const isCodeInvite = input.role === 'accountant' || input.role === 'employee' || Boolean(input.code);
  const codeDisplay = input.code || extractTokenFromInviteLink(input.inviteLink) || '';
  const recipientGreeting = input.name?.trim() ? `Hello ${input.name.trim()},` : 'Hello,';

  if (!smtpConfigured()) {
    console.log('\n==========================================================');
    console.log(`[Auth DEV MODE] SMTP not configured`);
    if (isCodeInvite) {
      console.log(`[Auth DEV MODE] Invitation Code for ${input.to} (${input.role}${input.name ? ` - ${input.name}` : ''}): ${codeDisplay}`);
    } else {
      console.log(`[Auth DEV MODE] Invitation link for ${input.to} (${input.role}${input.name ? ` - ${input.name}` : ''}): ${input.inviteLink}`);
    }
    console.log('==========================================================\n');
    if (env.nodeEnv !== 'production') {
      return { sent: true, devFallback: true };
    }
    console.error('[Auth] Invitation email blocked:', smtpConfigError());
    return { sent: false, error: smtpConfigError() };
  }

  try {
    const transporter = createMailTransporter();

    const from = mailFromAddress();
    const roleLabel = input.role.charAt(0).toUpperCase() + input.role.slice(1);

    if (isCodeInvite) {
      await sendMailConfirmed(transporter, {
        from: `"PACE Attendance" <${from}>`,
        to: input.to,
        subject: `Invitation Code to join PACE Attendance as an ${roleLabel}`,
        text: [
          recipientGreeting,
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
          <p style="color: #475569; font-size: 14px;">${recipientGreeting}</p>
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
      await sendMailConfirmed(transporter, {
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
    logSmtpFailure('Failed to send invitation email', err);
    if (env.nodeEnv !== 'production') {
      console.log('\n==========================================================');
      console.log(`[Auth DEV MODE] SMTP send failed. Using console fallback.`);
      console.log(`[Auth DEV MODE] Invitation link for ${input.to} (${input.role}): ${input.inviteLink}`);
      console.log('==========================================================\n');
      return { sent: true, devFallback: true };
    }
    return { sent: false, error: classifySmtpError(err) };
  }
}

export async function sendClientAdminInvitationEmail(input: {
  to: string;
  companyName?: string;
  planType: 'free' | 'paid';
  durationLabel: string;
  expiresAtFormatted: string;
  inviteLink: string;
  verificationCode: string;
}): Promise<{ sent: boolean; devFallback?: boolean; error?: string }> {
  const companyStr = input.companyName ? ` for ${input.companyName}` : '';
  const planStr = input.planType === 'free' ? `Free Trial (${input.durationLabel})` : `Paid Subscription (${input.durationLabel})`;

  if (!smtpConfigured()) {
    console.log('\n==========================================================');
    console.log(`[Auth DEV MODE] Client Admin Invitation Email for ${input.to}`);
    console.log(`[Auth DEV MODE] Company: ${input.companyName || 'N/A'}, Plan: ${planStr}`);
    console.log(`[Auth DEV MODE] 6-digit verification code: ${input.verificationCode}`);
    console.log(`[Auth DEV MODE] Code/invite expires at: ${input.expiresAtFormatted}`);
    console.log('==========================================================\n');
    if (env.nodeEnv !== 'production') {
      return { sent: true, devFallback: true };
    }
    return { sent: false, error: smtpConfigError() };
  }

  try {
    const transporter = createMailTransporter();

    const from = mailFromAddress();
    await sendMailConfirmed(transporter, {
      from: `"PACE Attendance" <${from}>`,
      to: input.to,
      subject: `Your 6-digit PACE Attendance verification code${companyStr}`,
      text: [
        `Hello,`,
        '',
        `You have been invited as a Client Administrator${companyStr} on PACE Attendance.`,
        '',
        `Access details:`,
        `- Plan: ${planStr}`,
        `- Valid until: ${input.expiresAtFormatted}`,
        '',
        `Your 6-digit verification code is: ${input.verificationCode}`,
        '',
        `Open the PACE Attendance app, choose Sign Up as Admin, and enter this code. Do not share it.`,
        '',
        `This code expires in 10 minutes.`,
        '',
        `If you did not expect this invitation, please ignore this email.`,
      ].join('\n'),
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
        <h2 style="color: #4f46e5;">Client Administrator Verification Code</h2>
        <p>Hello,</p>
        <p>You have been invited to set up and manage your organization account as <strong>Client Administrator</strong>${companyStr} on PACE Attendance.</p>
        
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; margin: 20px 0;">
          <p style="margin: 4px 0;"><strong>Selected Plan:</strong> ${planStr}</p>
          <p style="margin: 4px 0;"><strong>Valid until:</strong> ${input.expiresAtFormatted}</p>
        </div>

        <p style="font-size: 14px; color: #475569; margin-bottom: 8px;">Your 6-digit verification code is:</p>
        <div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; background: #eef2ff; padding: 16px 24px; border-radius: 12px; display: inline-block; margin: 8px 0;">
          ${input.verificationCode}
        </div>
        <p style="font-size: 14px; color: #475569;">Open PACE Attendance, choose <strong>Sign Up as Admin</strong>, and enter this code. Do not share it with anyone.</p>
        <p style="font-size: 13px; color: #64748b; margin-top: 16px;">This code expires in 10 minutes.</p>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">If you did not expect this invitation, please ignore this email.</p>
      </div>
    `,
    });

    return { sent: true };
  } catch (err) {
    logSmtpFailure('Failed to send client admin invitation email', err);
    if (env.nodeEnv !== 'production') {
      console.log(`[Auth DEV MODE] Console fallback for ${input.to}. Code: ${input.verificationCode}`);
      return { sent: true, devFallback: true };
    }
    return { sent: false, error: classifySmtpError(err) };
  }
}

export async function sendClientAdminVerificationCodeEmail(input: {
  to: string;
  code: string;
  clientEmail: string;
  companyName?: string;
}): Promise<{ sent: boolean; devFallback?: boolean; error?: string }> {
  const targetEmail = input.to.trim().toLowerCase();
  const companyStr = input.companyName ? ` (${input.companyName})` : '';

  if (!smtpConfigured()) {
    console.log('\n==========================================================');
    console.log(`[Auth DEV MODE] Verification Code Email to ${targetEmail}`);
    console.log(`[Auth DEV MODE] Client Email: ${input.clientEmail}${companyStr}`);
    console.log(`[Auth DEV MODE] Verification Code: ${input.code}`);
    console.log('==========================================================\n');
    if (env.nodeEnv !== 'production') {
      return { sent: true, devFallback: true };
    }
    return { sent: false, error: smtpConfigError() };
  }

  try {
    const transporter = createMailTransporter();

    const from = mailFromAddress();
    await sendMailConfirmed(transporter, {
      from: `"PACE Attendance" <${from}>`,
      to: targetEmail,
      subject: `Your 6-digit PACE Attendance verification code`,
      text: [
        `Hello,`,
        '',
        `Your 6-digit verification code for Client Admin sign-up is: ${input.code}`,
        '',
        `Email: ${input.clientEmail}`,
        `Company: ${input.companyName || 'N/A'}`,
        '',
        `Enter this code in the Admin Sign Up verification screen. Do not share it.`,
        '',
        `This code expires in 10 minutes.`,
      ].join('\n'),
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
        <h2 style="color: #4f46e5;">Your Verification Code</h2>
        <p>Hello,</p>
        <p>Use this 6-digit verification code to complete Client Admin registration for <strong>${input.clientEmail}</strong>${companyStr}.</p>

        <p style="font-size: 14px; color: #475569;">Verification Code:</p>
        <div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; background: #eef2ff; padding: 12px 24px; border-radius: 8px; display: inline-block; margin: 8px 0;">
          ${input.code}
        </div>
        <p style="font-size: 13px; color: #64748b; margin-top: 16px;">Enter this code in the app. It is valid for 10 minutes. Do not share it.</p>
      </div>
    `,
    });

    console.log(`[Auth] Verification code email sent to invited admin ${targetEmail}`);
    return { sent: true };
  } catch (err) {
    logSmtpFailure('Failed to send verification code email', err);
    if (env.nodeEnv !== 'production') {
      console.log(`[Auth DEV MODE] Console fallback for verification code to ${targetEmail}. Code: ${input.code}`);
      return { sent: true, devFallback: true };
    }
    return { sent: false, error: classifySmtpError(err) };
  }
}


