/** Safe device operation logging — never logs passwords or Authorization headers. */

export function logDeviceAction(details: {
  ip?: string;
  action: string;
  result: 'ok' | 'error' | 'auth_failed' | 'unreachable';
  status?: number | string;
  errorCode?: string;
  message?: string;
}): void {
  const parts = [
    `[Device] action=${details.action}`,
    details.ip ? `ip=${details.ip}` : null,
    `result=${details.result}`,
    details.status !== undefined ? `status=${details.status}` : null,
    details.errorCode ? `code=${details.errorCode}` : null,
    details.message ? `msg=${details.message}` : null,
  ].filter(Boolean);
  const line = parts.join(' ');
  if (details.result === 'ok') console.log(line);
  else console.error(line);
}
