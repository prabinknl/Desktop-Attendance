import {
  getActiveDeviceRecord,
  updateDeviceMeta,
  updateDeviceStatus,
  getAdapterForDevice,
} from '../../models/DeviceModel.js';
import { isMemoryMode, memoryStore } from '../../db/memoryStore.js';
import { query } from '../../db/pool.js';
import { logDeviceAction } from './deviceLogger.js';
import type { DeviceAttendanceEvent, SyncResult } from '../../types/index.js';

/** Overlap window so events near the last sync boundary are not missed. */
const SYNC_OVERLAP_MS = 2 * 60 * 1000;

/**
 * Attendance derivation rule: FIRST_LAST_PUNCH
 * ------------------------------------------------
 * Raw Hikvision events are stored verbatim as punches (or as check_in/check_out
 * only when the device itself supplies attendanceStatus).
 *
 * When applying a new event to the daily `attendance` table:
 * - If the machine labeled the event check_in / check_out, honour that.
 * - Otherwise (checkType === 'punch' | 'unknown'):
 *   - If no check_in exists for that employee+date → set check_in (first punch)
 *   - Else → set/update check_out (last punch wins)
 *
 * We never invent alternating check-in/check-out from event order alone
 * without this rule, and we never fabricate employee identities.
 */
const ATTENDANCE_RULE = 'FIRST_LAST_PUNCH' as const;

function utcDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcTimeStr(d: Date): string {
  return d.toISOString().slice(11, 19);
}

async function persistEvent(
  deviceId: string,
  event: DeviceAttendanceEvent,
): Promise<'inserted' | 'duplicate' | 'failed'> {
  try {
    if (isMemoryMode()) {
      const isNew = memoryStore.addLog({
        id: `log-${event.externalId}`,
        device_id: deviceId,
        external_id: event.externalId,
        employee_id: event.employeeId,
        employee_name: event.employeeName,
        check_type: event.checkType,
        event_time: event.eventTime.toISOString(),
        auth_method: event.authMethod ?? null,
        card_number: event.cardNumber ?? null,
        source: event.source ?? 'hikvision-device',
        raw_event_code: event.rawEventCode ?? null,
        raw_data: event.rawData ? JSON.stringify(event.rawData) : null,
      });
      return isNew ? 'inserted' : 'duplicate';
    }

    const insertResult = await query(
      `INSERT INTO device_attendance_logs
        (device_id, external_id, employee_id, employee_name, check_type, event_time,
         raw_data, source, auth_method, card_number, raw_event_code, event_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (device_id, external_id) DO NOTHING
       RETURNING id`,
      [
        deviceId,
        event.externalId,
        event.employeeId,
        event.employeeName,
        event.checkType,
        event.eventTime.toISOString(),
        event.rawData ? JSON.stringify(event.rawData) : null,
        event.source ?? 'hikvision-device',
        event.authMethod ?? null,
        event.cardNumber ?? null,
        event.rawEventCode ?? null,
        event.eventType ?? null,
      ],
    );

    if (insertResult.rowCount === 0) return 'duplicate';

    await applyAttendanceRule(deviceId, event);

    await query(
      `UPDATE device_attendance_logs
       SET synced_to_attendance = true
       WHERE device_id = $1 AND external_id = $2`,
      [deviceId, event.externalId],
    );

    return 'inserted';
  } catch (err) {
    logDeviceAction({
      action: 'persistEvent',
      result: 'error',
      message: err instanceof Error ? err.message : 'persist failed',
    });
    return 'failed';
  }
}

async function applyAttendanceRule(deviceId: string, event: DeviceAttendanceEvent): Promise<void> {
  const dateStr = utcDateStr(event.eventTime);
  const timeStr = utcTimeStr(event.eventTime);

  if (event.checkType === 'check_in') {
    await query(
      `INSERT INTO attendance (employee_id, date, check_in, status, source_device_id, location, source)
       VALUES ($1, $2, $3, 'present', $4, 'Device Sync', 'hikvision-device')
       ON CONFLICT (employee_id, date) DO UPDATE SET
         check_in = COALESCE(attendance.check_in, EXCLUDED.check_in),
         source = 'hikvision-device',
         source_device_id = EXCLUDED.source_device_id,
         updated_at = NOW()`,
      [event.employeeId, dateStr, timeStr, deviceId],
    );
    return;
  }

  if (event.checkType === 'check_out') {
    await query(
      `INSERT INTO attendance (employee_id, date, check_out, status, source_device_id, location, source)
       VALUES ($1, $2, $3, 'present', $4, 'Device Sync', 'hikvision-device')
       ON CONFLICT (employee_id, date) DO UPDATE SET
         check_out = EXCLUDED.check_out,
         source = 'hikvision-device',
         source_device_id = EXCLUDED.source_device_id,
         updated_at = NOW()`,
      [event.employeeId, dateStr, timeStr, deviceId],
    );
    return;
  }

  // FIRST_LAST_PUNCH for unlabeled punches
  const existing = await query<{ check_in: string | null }>(
    `SELECT check_in FROM attendance WHERE employee_id = $1 AND date = $2`,
    [event.employeeId, dateStr],
  );

  if (!existing.rows[0]?.check_in) {
    await query(
      `INSERT INTO attendance (employee_id, date, check_in, status, source_device_id, location, source, remarks)
       VALUES ($1, $2, $3, 'present', $4, 'Device Sync', 'hikvision-device', $5)
       ON CONFLICT (employee_id, date) DO UPDATE SET
         check_in = COALESCE(attendance.check_in, EXCLUDED.check_in),
         source = 'hikvision-device',
         source_device_id = EXCLUDED.source_device_id,
         updated_at = NOW()`,
      [event.employeeId, dateStr, timeStr, deviceId, `rule=${ATTENDANCE_RULE}`],
    );
  } else {
    await query(
      `INSERT INTO attendance (employee_id, date, check_out, status, source_device_id, location, source, remarks)
       VALUES ($1, $2, $3, 'present', $4, 'Device Sync', 'hikvision-device', $5)
       ON CONFLICT (employee_id, date) DO UPDATE SET
         check_out = EXCLUDED.check_out,
         source = 'hikvision-device',
         source_device_id = EXCLUDED.source_device_id,
         updated_at = NOW()`,
      [event.employeeId, dateStr, timeStr, deviceId, `rule=${ATTENDANCE_RULE}`],
    );
  }
}

export interface SyncOptions {
  startTime?: Date;
  endTime?: Date;
}

export async function syncDeviceAttendance(options: SyncOptions = {}): Promise<SyncResult> {
  const device = await getActiveDeviceRecord();
  if (!device) throw new Error('No device configured');

  await updateDeviceStatus(device.id, 'syncing');

  const rangeEnd = options.endTime ?? new Date();
  let rangeStart =
    options.startTime ??
    (device.last_sync
      ? new Date(new Date(device.last_sync).getTime() - SYNC_OVERLAP_MS)
      : new Date(Date.now() - 24 * 60 * 60 * 1000));

  try {
    const adapter = getAdapterForDevice(device);
    const events = await adapter.syncAttendance(rangeStart, rangeEnd);

    let inserted = 0;
    let duplicates = 0;
    let failed = 0;

    for (const event of events) {
      const result = await persistEvent(device.id, event);
      if (result === 'inserted') inserted++;
      else if (result === 'duplicate') duplicates++;
      else failed++;
    }

    const lastEvent = [...events].sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime())[0];
    const info = await adapter.getDeviceInfo().catch(() => null);

    await updateDeviceMeta(device.id, {
      lastSync: new Date(),
      lastAttendanceReceived: lastEvent?.eventTime,
      deviceTime: info?.deviceTime,
      model: info?.model,
      macAddress: info?.macAddress,
      status: 'online',
    });

    logDeviceAction({
      ip: device.ip_address,
      action: 'sync',
      result: 'ok',
      message: `downloaded=${events.length} inserted=${inserted} duplicates=${duplicates} failed=${failed} rule=${ATTENDANCE_RULE}`,
    });

    return {
      downloaded: events.length,
      inserted,
      duplicates,
      failed,
      synced: inserted,
      skipped: duplicates,
      total: events.length,
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
    };
  } catch (err) {
    // Keep previous connectivity — a sync/query failure is not a disconnect
    await updateDeviceStatus(device.id, device.status === 'syncing' ? 'online' : device.status);
    logDeviceAction({
      ip: device.ip_address,
      action: 'sync',
      result: 'error',
      message: err instanceof Error ? err.message : 'Sync failed',
    });
    throw err;
  }
}
