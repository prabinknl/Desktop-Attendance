import { describe, expect, it } from 'vitest';
import { normalizeMac, parseSadpReply } from './SadpDiscovery.js';
import { identityMatches, serialsMatch } from './DeviceIdentityStore.js';
import { isCompatibleModel } from './DeviceDiscovery.js';

const PROBE_MATCH = `<?xml version="1.0" encoding="UTF-8"?>
<ProbeMatch>
<Uuid>7C0D2A30-1F57-4B7E-9C4B-0E4A1A2B3C4D</Uuid>
<Types>inquiry</Types>
<DeviceType>196611</DeviceType>
<DeviceDescription>DS-K1T320EFWX</DeviceDescription>
<DeviceSN>DS-K1T320EFWX20240315V030800ENAB1234567</DeviceSN>
<CommandPort>8000</CommandPort>
<HttpPort>80</HttpPort>
<MAC>ac-cb-51-12-34-56</MAC>
<IPv4Address>192.168.1.64</IPv4Address>
<IPv4SubnetMask>255.255.255.0</IPv4SubnetMask>
<SoftwareVersion>V3.8.0build 240315</SoftwareVersion>
<DHCP>false</DHCP>
<Activated>true</Activated>
</ProbeMatch>`;

describe('parseSadpReply', () => {
  it('reads identity fields from a ProbeMatch', () => {
    expect(parseSadpReply(PROBE_MATCH)).toEqual({
      ipAddress: '192.168.1.64',
      httpPort: 80,
      commandPort: 8000,
      serialNumber: 'DS-K1T320EFWX20240315V030800ENAB1234567',
      model: 'DS-K1T320EFWX',
      deviceType: '196611',
      macAddress: 'ac:cb:51:12:34:56',
      firmwareVersion: 'V3.8.0build 240315',
      activated: true,
      dhcp: false,
    });
  });

  it('ignores our own probe and unrelated packets', () => {
    expect(parseSadpReply('<Probe><Uuid>x</Uuid><Types>inquiry</Types></Probe>')).toBeNull();
    expect(parseSadpReply('M-SEARCH * HTTP/1.1')).toBeNull();
  });

  it('falls back to the sender address when IPv4Address is missing', () => {
    const xml = PROBE_MATCH.replace(/<IPv4Address>.*<\/IPv4Address>/, '');
    expect(parseSadpReply(xml, '10.0.0.9')?.ipAddress).toBe('10.0.0.9');
  });
});

describe('device identity matching', () => {
  it('normalizes MAC formats', () => {
    expect(normalizeMac('AC-CB-51-12-34-56')).toBe('ac:cb:51:12:34:56');
    expect(normalizeMac('accb.5112.3456')).toBe('ac:cb:51:12:34:56');
  });

  it('matches full and short serial forms but not different machines', () => {
    expect(serialsMatch('DS-K1T320EFWX20240315V030800ENAB1234567', 'ds-k1t320efwx20240315v030800enab1234567')).toBe(true);
    expect(serialsMatch('DS-K1T320EFWX20240315V030800ENAB1234567', 'ENAB1234567')).toBe(true);
    expect(serialsMatch('DS-K1T320EFWX20240315V030800ENAB1234567', '1234567')).toBe(false);
    expect(serialsMatch('DS-K1T320EFWX20240315V030800ENAB1234567', 'DS-K1T320EFWX20240315V030800ENAB7654321')).toBe(false);
  });

  it('prefers serial, then MAC, else unknown', () => {
    const paired = { serialNumber: 'DS-K1T320EFWX20240315V030800ENAB1234567', macAddress: 'ac:cb:51:12:34:56' };
    expect(identityMatches(paired, { serialNumber: 'ENAB1234567' })).toBe('match');
    expect(identityMatches(paired, { serialNumber: 'ENAB7654321', macAddress: 'ac:cb:51:12:34:56' })).toBe('mismatch');
    expect(identityMatches({ macAddress: 'ac:cb:51:12:34:56' }, { macAddress: 'AC-CB-51-12-34-56' })).toBe('match');
    expect(identityMatches(paired, {})).toBe('unknown');
  });

  it('recognises DS-K attendance terminals only', () => {
    expect(isCompatibleModel('DS-K1T320EFWX')).toBe(true);
    expect(isCompatibleModel('DS-2CD2043G2-I')).toBe(false);
    expect(isCompatibleModel('Hikvision (ISAPI)')).toBe(false);
  });
});
