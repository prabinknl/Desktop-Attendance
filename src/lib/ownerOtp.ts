import { authApi } from '../api/authApi';
import { getInsforgeBrowserClient, useInsforgeOtp } from './insforgeClient';

function otpErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Could not complete owner verification.';
}

export async function sendOwnerVerificationCode(emails: string[]) {
  // Always prefer Hostinger backend API first.
  try {
    return await authApi.sendAdminCode({ name: 'Owner', emails });
  } catch (primaryErr) {
    if (!useInsforgeOtp()) {
      return {
        success: false,
        emailSent: false,
        message:
          primaryErr instanceof Error ? primaryErr.message : 'Could not send the owner verification code.',
      };
    }
  }

  // OBSOLETE: InsForge OTP only when VITE_USE_INSFORGE_OTP=true.
  const client = getInsforgeBrowserClient();
  const ordered = [...emails].sort(
    (a, b) => Number(a.startsWith('noreply')) - Number(b.startsWith('noreply')),
  );
  const results: Array<{ email: string; error: unknown }> = [];
  for (const email of ordered) {
    const { error } = await client.auth.signInWithOtp({ email });
    results.push({ email, error });
  }
  const sent = results.filter((result) => !result.error);
  if (sent.length === 0) {
    const message = results.map((result) => otpErrorMessage(result.error)).filter(Boolean)[0]
      || 'Could not send the owner verification code.';
    return { success: false, emailSent: false, message };
  }
  return {
    success: true,
    emailSent: true,
    message: `A verification code was sent to ${sent.map((result) => result.email).join(', ')}.`,
  };
}

export async function verifyOwnerVerificationCode(emails: string[], code: string) {
  let lastMessage = 'Invalid or expired code.';
  for (const email of emails) {
    try {
      const verified = await authApi.verifyAdminCode({ email, code });
      if (verified.success && verified.verified) {
        return verified;
      }
      lastMessage = verified.message || lastMessage;
    } catch (err) {
      lastMessage = err instanceof Error ? err.message : lastMessage;
    }
  }

  if (!useInsforgeOtp()) {
    return { success: false, verified: false, message: lastMessage };
  }

  // OBSOLETE: InsForge OTP only when VITE_USE_INSFORGE_OTP=true.
  const client = getInsforgeBrowserClient();
  for (const email of emails) {
    const { data, error } = await client.auth.verifyOtp({
      email,
      otp: code,
      name: 'Owner',
    });
    if (!error && data) {
      return { success: true, verified: true, email };
    }
    lastMessage = otpErrorMessage(error) || lastMessage;
  }
  return { success: false, verified: false, message: lastMessage };
}
