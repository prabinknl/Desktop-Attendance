import { describe, expect, it } from 'vitest';
import {
  OWNER_VERIFICATION_EMAIL,
  storeVerificationCode,
  verifyStoredCode,
} from './adminVerification.js';

describe('owner registration verification', () => {
  it('sends the code to the fixed noreply mailbox', () => {
    expect(OWNER_VERIFICATION_EMAIL).toBe('noreply@appnep.com');
  });

  it('accepts a code stored for that mailbox and rejects one stored for another address', () => {
    storeVerificationCode('someone@example.com', '111111');
    storeVerificationCode(OWNER_VERIFICATION_EMAIL, '222222');

    expect(verifyStoredCode(OWNER_VERIFICATION_EMAIL, '111111').ok).toBe(false);
    expect(verifyStoredCode(OWNER_VERIFICATION_EMAIL, '222222').ok).toBe(true);
    expect(verifyStoredCode(OWNER_VERIFICATION_EMAIL, '222222').ok).toBe(false);
  });
});
