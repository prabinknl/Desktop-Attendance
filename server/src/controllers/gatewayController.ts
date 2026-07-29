import type { Request, Response, NextFunction } from 'express';
import {
  getActiveDeviceRecord,
  updateGatewayHeartbeat,
  setCommandResult,
  updateDeviceMeta,
} from '../models/DeviceModel.js';
import { persistEvent } from '../services/device/SyncService.js';
import { verifyConnectorToken } from '../services/connector/connectorAuth.js';
import type { DeviceAttendanceEvent } from '../types/index.js';

export async function authenticateConnector(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;
  const customHeader = (req.headers['x-gateway-secret'] as string) || '';
  const candidate = token || customHeader;

  const device = await getActiveDeviceRecord();
  if (!verifyConnectorToken(device, candidate)) {
    console.warn('[Connector] Rejected unauthorized heartbeat/upload');
    res.status(401).json({
      success: false,
      message: 'Unauthorized: invalid connector token',
    });
    return;
  }
  next();
}

export const gatewayController = {
  /** POST /api/gateway/heartbeat */
  async heartbeat(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body;
      const { pendingCommand } = await updateGatewayHeartbeat(payload);
      const deviceStatus = String(payload?.deviceStatus ?? 'unknown');
      const errMsg = payload?.errorMessage ? String(payload.errorMessage).slice(0, 200) : '';
      console.log(
        `[Connector] Heartbeat device=${deviceStatus}${errMsg ? ` err=${errMsg}` : ''}`,
      );
      res.json({
        success: true,
        message: 'Heartbeat received',
        pendingCommand,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Heartbeat failed';
      console.error('[Connector] Heartbeat failed:', message);
      res.status(500).json({
        success: false,
        message,
      });
    }
  },

  /** POST /api/gateway/logs */
  async uploadLogs(req: Request, res: Response): Promise<void> {
    try {
      const device = await getActiveDeviceRecord();
      if (!device) {
        res.status(404).json({ success: false, message: 'No active device configured in cloud database' });
        return;
      }

      const events: DeviceAttendanceEvent[] = req.body?.events ?? [];
      let inserted = 0;
      let duplicates = 0;
      let failed = 0;
      let maxEventTime: Date | undefined;

      for (const raw of events) {
        const eventTime = new Date(raw.eventTime);
        if (!maxEventTime || eventTime > maxEventTime) maxEventTime = eventTime;

        const result = await persistEvent(device.id, {
          externalId: raw.externalId,
          employeeId: String(raw.employeeId),
          employeeName: String(raw.employeeName),
          checkType: raw.checkType || 'punch',
          eventTime,
          authMethod: raw.authMethod,
          cardNumber: raw.cardNumber,
          rawEventCode: raw.rawEventCode,
          serialNumber: raw.serialNumber,
          source: raw.source ?? 'hikvision-device',
          rawData: raw.rawData,
        });

        if (result === 'inserted') inserted++;
        else if (result === 'duplicate') duplicates++;
        else failed++;
      }

      await updateDeviceMeta(device.id, {
        lastSync: new Date(),
        lastAttendanceReceived: maxEventTime,
        status: 'online',
      });

      console.log(
        `[Connector] Attendance batch events=${events.length} inserted=${inserted} dup=${duplicates} failed=${failed}`,
      );

      res.json({
        success: true,
        message: `Processed ${events.length} events (inserted: ${inserted}, duplicates: ${duplicates}, failed: ${failed})`,
        data: {
          downloaded: events.length,
          inserted,
          duplicates,
          failed,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Logs upload failed';
      console.error('[Connector] Upload failed:', message);
      res.status(500).json({
        success: false,
        message,
      });
    }
  },

  /** POST /api/gateway/command-result */
  async commandResult(req: Request, res: Response): Promise<void> {
    try {
      const { commandId, result } = req.body ?? {};
      if (!commandId) {
        res.status(400).json({ success: false, message: 'commandId is required' });
        return;
      }

      await setCommandResult(commandId, result ?? {});
      res.json({ success: true, message: 'Command result stored' });
    } catch (err) {
      res.status(500).json({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to store command result',
      });
    }
  },
};
