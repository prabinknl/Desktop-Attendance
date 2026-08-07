import { env } from '../../config/env.js';

export interface SendSmsInput {
  to: string;
  code: string;
  message?: string;
}

export interface SendSmsResult {
  success: boolean;
  code?: 'config_missing' | 'blocked_destination' | 'provider_failed' | 'invalid_number';
  message?: string;
  devFallback?: boolean;
  providerMessageId?: string;
  providerStatus?: string;
  provider?: string;
}

/**
 * Normalizes phone numbers to international E.164 format.
 * Supports Nepal mobile formats:
 * - 9851064130 -> +9779851064130
 * - 09851064130 -> +9779851064130
 * - 9779851064130 -> +9779851064130
 * - +9779851064130 -> +9779851064130
 */
export function normalizePhoneE164(phone: string): string {
  let cleaned = (phone || '').trim().replace(/[\s\-\(\)]/g, '');
  if (!cleaned) return '';

  if (cleaned.startsWith('+')) {
    return '+' + cleaned.slice(1).replace(/\D/g, '');
  }

  cleaned = cleaned.replace(/\D/g, '');

  // 11-digit Nepal local number starting with 09 (e.g. 09851064130) -> drop 0 -> 9851064130
  if (cleaned.length === 11 && cleaned.startsWith('09')) {
    cleaned = cleaned.slice(1);
  }

  // 10-digit mobile number starting with 9 (Nepal mobile range 96x, 97x, 98x)
  if (cleaned.length === 10 && cleaned.startsWith('9')) {
    return `+977${cleaned}`;
  }

  // 13-digit number starting with 977 (Nepal international format without +)
  if (cleaned.length === 13 && cleaned.startsWith('977')) {
    return `+${cleaned}`;
  }

  return cleaned ? `+${cleaned}` : '';
}

export function isPhoneE164Valid(phone: string): boolean {
  const norm = normalizePhoneE164(phone);
  // Standard E.164: + followed by 8 to 15 digits
  if (!/^\+[1-9]\d{7,14}$/.test(norm)) {
    return false;
  }
  // For Nepal numbers (+977), verify 10-digit mobile payload starting with 9
  if (norm.startsWith('+977')) {
    return /^\+9779[6-8]\d{8}$/.test(norm);
  }
  return true;
}

/** Safely masks phone numbers for logs (e.g. +9779851064130 -> +97798******30) */
export function maskPhoneNumber(phone: string): string {
  const norm = normalizePhoneE164(phone);
  if (!norm || norm.length < 8) return '***';
  return `${norm.slice(0, 7)}******${norm.slice(-2)}`;
}

export const smsService = {
  async sendVerificationCode(input: SendSmsInput): Promise<SendSmsResult> {
    const to = normalizePhoneE164(input.to);
    const maskedTo = maskPhoneNumber(to);

    if (!to || !isPhoneE164Valid(to)) {
      console.warn(`[SMS] Rejected malformed phone number: ${maskedTo}`);
      return {
        success: false,
        code: 'invalid_number',
        message: 'Invalid mobile number format. Please provide a valid Nepal mobile number (e.g. +9779851064130 or 9851064130).',
      };
    }

    const text = input.message || `Your PACE Attendance verification code is ${input.code}. It expires in 10 minutes. Do not share this code.`;

    const smsProvider = (env.smsProvider || process.env.SMS_PROVIDER || '').trim().toLowerCase();
    const isDevModeExplicit = env.smsDevMode || (process.env.SMS_DEV_MODE || '').trim().toLowerCase() === 'true';

    console.log(`[SMS] Initiating verification code request for ${maskedTo} (Provider: ${smsProvider || 'default'})`);

    // Explicit Development Mock Mode (only allowed when SMS_DEV_MODE=true in non-production)
    if (isDevModeExplicit && env.nodeEnv !== 'production') {
      console.log('\n==========================================================');
      console.log(`[SMS DEV MODE] Mock SMS Dispatch`);
      console.log(`[SMS DEV MODE] To: ${maskedTo}`);
      console.log(`[SMS DEV MODE] Code: ${input.code}`);
      console.log('==========================================================\n');
      return {
        success: true,
        devFallback: true,
        provider: 'dev_mode',
        message: 'SMS verification code sent (Development SMS mode).',
      };
    }

    const twilioSid = env.twilioAccountSid || (process.env.TWILIO_ACCOUNT_SID || '').trim();
    const twilioToken = env.twilioAuthToken || (process.env.TWILIO_AUTH_TOKEN || '').trim();
    const twilioFrom = env.twilioFromNumber || (process.env.TWILIO_FROM_NUMBER || '').trim();
    const smsApiUrl = env.smsApiUrl || (process.env.SMS_API_URL || '').trim();

    const isTwilioConfigured = Boolean(twilioSid && twilioToken && twilioFrom);
    const isHttpGatewayConfigured = Boolean(smsApiUrl);

    if (!isTwilioConfigured && !isHttpGatewayConfigured && smsProvider !== 'twilio') {
      console.warn('[SMS] Service configuration missing in server/.env (No real SMS credentials configured)');
      return {
        success: false,
        code: 'config_missing',
        message: 'SMS service is not configured. Please contact the application administrator.',
      };
    }

    try {
      if (smsProvider === 'twilio' || isTwilioConfigured) {
        if (!isTwilioConfigured) {
          console.warn('[SMS] Twilio credentials incomplete in server/.env');
          return {
            success: false,
            code: 'config_missing',
            message: 'SMS service is not configured. Please contact the application administrator.',
          };
        }

        const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
        const params = new URLSearchParams({
          To: to,
          From: twilioFrom,
          Body: text,
        });

        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        const responseData = await res.json().catch(() => ({})) as {
          sid?: string;
          status?: string;
          code?: number;
          message?: string;
        };

        if (!res.ok || responseData.status === 'failed') {
          console.error(`[SMS] Twilio dispatch rejected for ${maskedTo}:`, {
            status: res.status,
            code: responseData.code,
            message: responseData.message,
          });

          // Unverified recipient in Twilio trial or blocked destination
          if (responseData.code === 21608 || responseData.code === 21211 || responseData.code === 21614) {
            return {
              success: false,
              code: 'blocked_destination',
              message: 'SMS could not be sent to this mobile number.',
            };
          }

          return {
            success: false,
            code: 'provider_failed',
            message: 'We could not send the verification code. Please check the mobile number or try again.',
          };
        }

        console.log(`[SMS] Provider accepted request for ${maskedTo} (Message SID: ${responseData.sid || 'N/A'}, Status: ${responseData.status || 'accepted'})`);

        return {
          success: true,
          providerMessageId: responseData.sid,
          providerStatus: responseData.status || 'accepted',
          provider: 'twilio',
        };
      }

      // Custom HTTP REST Gateway (e.g. Sparrow SMS / Aakash SMS in Nepal or custom HTTP webhook)
      if (isHttpGatewayConfigured) {
        const apiKey = env.smsApiKey || (process.env.SMS_API_KEY || '').trim();
        const senderId = env.smsSenderId || (process.env.SMS_SENDER_ID || 'PACE').trim();

        const response = await fetch(smsApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            to,
            text,
            token: apiKey,
            sender: senderId,
          }),
        });

        const resData = await response.json().catch(() => ({})) as { id?: string; messageId?: string; status?: string };

        if (!response.ok) {
          console.error(`[SMS] HTTP Gateway dispatch failed for ${maskedTo}: HTTP ${response.status}`);
          return {
            success: false,
            code: 'provider_failed',
            message: 'We could not send the verification code. Please check the mobile number or try again.',
          };
        }

        const msgId = resData.id || resData.messageId || `http-${Date.now()}`;
        console.log(`[SMS] HTTP Gateway accepted request for ${maskedTo} (Message ID: ${msgId})`);

        return {
          success: true,
          providerMessageId: msgId,
          providerStatus: 'accepted',
          provider: 'http_gateway',
        };
      }

      return {
        success: false,
        code: 'config_missing',
        message: 'SMS service is not configured. Please contact the application administrator.',
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown SMS error';
      console.error(`[SMS] Provider dispatch error for ${maskedTo}:`, errorMsg);
      return {
        success: false,
        code: 'provider_failed',
        message: 'We could not send the verification code. Please check the mobile number or try again.',
      };
    }
  },
};

