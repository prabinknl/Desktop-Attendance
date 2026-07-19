import { EmployeeAPI } from '../data/store';
import type { AttendanceLogEntry } from '../types/device';
import { saveDeviceLogsCache } from './deviceLogsCache';

/** Upsert employees using names and IDs from real device attendance logs. */
export async function upsertEmployeesFromDeviceLogs(
  logs: AttendanceLogEntry[],
): Promise<number> {
  if (logs.length) {
    saveDeviceLogsCache(logs);
  }
  const byId = new Map<string, string>();

  for (const log of logs) {
    const id = String(log.employeeId ?? '').trim();
    if (!id || id === '—' || id.toLowerCase() === 'unknown') continue;
    const name = String(log.employeeName ?? '').trim();
    // Prefer a real machine name over a previous Unknown placeholder
    const prev = byId.get(id);
    if (!prev || prev.toLowerCase() === 'unknown' || prev === id) {
      byId.set(id, name || id);
    }
  }

  let count = 0;
  for (const [employeeId, name] of byId) {
    const emp = await EmployeeAPI.upsertFromDevice({ employeeId, name });
    if (emp) count += 1;
  }
  return count;
}
