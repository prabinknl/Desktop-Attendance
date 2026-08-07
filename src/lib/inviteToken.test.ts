import { describe, expect, it } from 'vitest';
import {
  extractInviteTokenFromLocation,
  extractTokenFromInviteLink,
  maskInviteToken,
  normalizeInviteToken,
} from './inviteToken';

const SAMPLE_TOKEN = 'b'.repeat(48);

describe('inviteToken', () => {
  it('normalizes valid hex tokens', () => {
    expect(normalizeInviteToken(SAMPLE_TOKEN.toUpperCase())).toBe(SAMPLE_TOKEN);
  });

  it('rejects malformed tokens', () => {
    expect(normalizeInviteToken('short')).toBeNull();
  });

  it('extracts tokens from hash deep links', () => {
    expect(
      extractInviteTokenFromLocation({
        hash: `#/invite/${SAMPLE_TOKEN}`,
        pathname: '/',
      }),
    ).toBe(SAMPLE_TOKEN);
  });

  it('extracts tokens from path-style desktop links before redirect', () => {
    expect(
      extractInviteTokenFromLocation({
        hash: '',
        pathname: `/invite/${SAMPLE_TOKEN}`,
      }),
    ).toBe(SAMPLE_TOKEN);
  });

  it('extracts tokens from emailed links', () => {
    expect(extractTokenFromInviteLink(`http://127.0.0.1:3010/invite/${SAMPLE_TOKEN}`)).toBe(SAMPLE_TOKEN);
    expect(extractTokenFromInviteLink(`http://127.0.0.1:3010/#/invite/${SAMPLE_TOKEN}`)).toBe(SAMPLE_TOKEN);
  });

  it('masks tokens for client debug logs', () => {
    expect(maskInviteToken(SAMPLE_TOKEN)).toBe('bbbb...bbbb');
  });
});
