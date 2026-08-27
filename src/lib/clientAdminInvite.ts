import { getInsforgeBrowserClient, isInsforgeBrowserConfigured } from './insforgeClient';

const TABLE = 'client_admin_invitations';

export interface ClientAdminInviteInput {
  email: string;
  phone: string;
  companyName?: string;
  planType: 'free' | 'paid';
  durationDays: number;
}

export interface ClientAdminInviteDeliveryResult {
  success: boolean;
  emailSent: boolean;
  message: string;
}

export interface ClientAdminInviteRecord {
  invitationToken: string;
  companyName: string;
  invitedEmail: string;
  invitingOwner: string;
  packageDuration: string;
  phone: string;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Nepal-aware E.164 normalization used when matching invite phone numbers. */
export function normalizeInvitePhone(phone: string): string {
  let cleaned = (phone || '').trim().replace(/[\s\-()]/g, '');
  if (!cleaned) return '';

  if (cleaned.startsWith('+')) {
    return `+${cleaned.slice(1).replace(/\D/g, '')}`;
  }

  cleaned = cleaned.replace(/\D/g, '');

  if (cleaned.length === 11 && cleaned.startsWith('09')) {
    cleaned = cleaned.slice(1);
  }
  if (cleaned.length === 10 && cleaned.startsWith('9')) {
    return `+977${cleaned}`;
  }
  if (cleaned.length === 13 && cleaned.startsWith('977')) {
    return `+${cleaned}`;
  }
  return cleaned ? `+${cleaned}` : '';
}

function durationLabel(days: number, planType: string) {
  const planLabel = planType === 'paid' ? 'Paid Subscription' : 'Free Trial';
  if (days < 1) return `${Math.round(days * 24)} Hours (${planLabel})`;
  if (days === 1) return `1 Day (${planLabel})`;
  return `${days} Days (${planLabel})`;
}

function otpErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Could not email the 6-digit verification code.';
}

async function persistInvitation(input: ClientAdminInviteInput) {
  if (!isInsforgeBrowserConfigured()) return null;

  const client = getInsforgeBrowserClient();
  const email = normalizeEmail(input.email);
  const phone = normalizeInvitePhone(input.phone);
  const now = new Date();
  const ttlDays = Math.max(1, Number(input.durationDays) || 1);
  const row = {
    email,
    phone,
    company_name: input.companyName?.trim() || null,
    plan_type: input.planType,
    duration_days: input.durationDays,
    status: 'pending',
    invitation_token: crypto.randomUUID(),
    expires_at: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: now.toISOString(),
  };

  const { data: existing, error: lookupError } = await client.database
    .from(TABLE)
    .select('id')
    .eq('email', email)
    .eq('status', 'pending');

  if (lookupError) {
    console.warn('[ClientAdminInvite] Lookup failed:', lookupError.message);
  }

  const existingId = Array.isArray(existing) && existing[0] && typeof existing[0] === 'object' && 'id' in existing[0]
    ? String((existing[0] as { id: string }).id)
    : null;

  if (existingId) {
    const { error } = await client.database.from(TABLE).update(row).eq('id', existingId);
    if (error) console.warn('[ClientAdminInvite] Update failed:', error.message);
    return { ...row, id: existingId };
  }

  const { error } = await client.database.from(TABLE).insert([row]);
  if (error) {
    console.warn('[ClientAdminInvite] Insert failed:', error.message);
    return null;
  }
  return row;
}

export async function deliverClientAdminInviteEmail(
  input: ClientAdminInviteInput,
): Promise<ClientAdminInviteDeliveryResult> {
  if (!isInsforgeBrowserConfigured()) {
    return {
      success: false,
      emailSent: false,
      message: 'Email service is not configured, so the 6-digit code could not be sent.',
    };
  }

  await persistInvitation(input);

  const client = getInsforgeBrowserClient();
  const email = normalizeEmail(input.email);
  const { error } = await client.auth.signInWithOtp({ email });
  if (error) {
    return {
      success: false,
      emailSent: false,
      message: otpErrorMessage(error),
    };
  }

  return {
    success: true,
    emailSent: true,
    message: `6-digit verification code emailed to ${email}.`,
  };
}

export async function verifyClientAdminInviteCode(input: {
  invitationCode: string;
  phone: string;
}): Promise<{ success: boolean; message?: string; invitation?: ClientAdminInviteRecord }> {
  const code = input.invitationCode.trim();
  const phone = normalizeInvitePhone(input.phone);

  if (!code || code.length !== 6) {
    return { success: false, message: 'Enter the 6-digit verification code from your email.' };
  }
  if (!phone) {
    return { success: false, message: 'Enter the mobile number registered with this invitation.' };
  }
  if (!isInsforgeBrowserConfigured()) {
    return { success: false, message: 'Invitation verification service is not configured.' };
  }

  const client = getInsforgeBrowserClient();
  const { data, error } = await client.database
    .from(TABLE)
    .select('email, phone, company_name, plan_type, duration_days, invitation_token, status, expires_at')
    .eq('phone', phone)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, message: error.message || 'Could not look up this invitation.' };
  }

  const rows = Array.isArray(data) ? data : [];
  const inv = rows[0] as {
    email?: string;
    phone?: string;
    company_name?: string | null;
    plan_type?: string;
    duration_days?: number;
    invitation_token?: string;
    expires_at?: string | null;
  } | undefined;

  if (!inv?.email) {
    return {
      success: false,
      message: 'No pending invitation matches this mobile number. Ask the Owner to send a new code.',
    };
  }

  if (inv.expires_at && Date.parse(inv.expires_at) < Date.now()) {
    return { success: false, message: 'This invitation has expired. Ask the Owner to send a new code.' };
  }

  const { data: otpData, error: otpError } = await client.auth.verifyOtp({
    email: inv.email,
    otp: code,
    name: inv.company_name || 'Client Admin',
  });

  if (otpError || !otpData) {
    return { success: false, message: otpErrorMessage(otpError) || 'Invalid or expired verification code.' };
  }

  return {
    success: true,
    invitation: {
      invitationToken: inv.invitation_token || inv.email,
      companyName: inv.company_name || 'Organization',
      invitedEmail: inv.email,
      invitingOwner: 'Owner',
      packageDuration: durationLabel(Number(inv.duration_days) || 30, inv.plan_type || 'free'),
      phone: inv.phone || phone,
    },
  };
}

export async function markClientAdminInviteAccepted(email: string) {
  if (!isInsforgeBrowserConfigured()) return;
  const client = getInsforgeBrowserClient();
  const { error } = await client.database
    .from(TABLE)
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('email', normalizeEmail(email))
    .eq('status', 'pending');
  if (error) {
    console.warn('[ClientAdminInvite] Could not mark invitation accepted:', error.message);
  }
}

const AUTH_USERS_KEY = 'ams_auth_users';

export function saveInvitedClientAdminAccount(input: {
  name: string;
  email: string;
  password: string;
  phone: string;
  companyName?: string;
}) {
  const email = normalizeEmail(input.email);
  const created = {
    id: `usr-${Date.now()}`,
    name: input.name.trim() || 'Client Admin',
    email,
    role: 'admin' as const,
    password: input.password,
    phone: input.phone,
    timezone: 'Asia/Kathmandu',
    companyName: input.companyName,
    planType: 'free' as const,
    status: 'active' as const,
    emailVerified: true,
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(email)}`,
  };

  try {
    const raw = localStorage.getItem(AUTH_USERS_KEY);
    const users = raw ? (JSON.parse(raw) as Array<{ email?: string }>) : [];
    const next = users.filter((user) => (user.email || '').toLowerCase() !== email);
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify([...next, created]));
  } catch (err) {
    console.warn('[ClientAdminInvite] Could not save local admin account:', err);
  }
}
