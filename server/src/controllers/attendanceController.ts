import type { Request, Response } from 'express';
import { AttendanceModel } from '../models/AttendanceModel.js';

export const attendanceController = {
  /** GET /api/attendance — fetch all records */
  async getAll(_req: Request, res: Response) {
    try {
      const records = await AttendanceModel.getAll();
      res.json({ success: true, data: records });
    } catch (err) {
      console.error('[Attendance] getAll error:', err);
      res.status(500).json({ success: false, message: 'Failed to fetch attendance records' });
    }
  },

  /** POST /api/attendance/upsert — single upsert */
  async upsert(req: Request, res: Response) {
    try {
      const userRole = String(req.headers['x-user-role'] || req.body.editorRole || '').toLowerCase();
      if (userRole && !['admin', 'account', 'accountant', 'hr', 'dept_manager'].includes(userRole)) {
        return res.status(403).json({ success: false, message: 'Only Admin or Account users are authorized to edit attendance times' });
      }

      const record = req.body;
      if (!record.employeeId || !record.date) {
        return res.status(400).json({ success: false, message: 'employeeId and date are required' });
      }
      const result = await AttendanceModel.upsert({
        appId: record.id,
        employeeId: record.employeeId,
        departmentId: record.departmentId,
        date: record.date,
        shiftId: record.shiftId,
        checkIn: record.checkIn,
        checkOut: record.checkOut,
        manualCheckIn: record.manualCheckIn,
        manualCheckOut: record.manualCheckOut,
        checkInEdited: record.checkInEdited,
        checkOutEdited: record.checkOutEdited,
        checkInEditedBy: record.checkInEditedBy,
        checkOutEditedBy: record.checkOutEditedBy,
        checkInEditedAt: record.checkInEditedAt,
        checkOutEditedAt: record.checkOutEditedAt,
        breakMinutes: record.breakMinutes,
        workingHours: record.workingHours,
        overtime: record.overtime,
        lateMinutes: record.lateMinutes,
        status: record.status,
        location: record.location,
        remarks: record.remarks,
        manualOverride: record.manualOverride,
        createdBy: record.createdBy ?? 'app',
        source: record.source,
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('[Attendance] upsert error:', err);
      return res.status(500).json({ success: false, message: 'Failed to save attendance record' });
    }
  },

  /** POST /api/attendance/bulk-upsert — many records at once */
  async bulkUpsert(req: Request, res: Response) {
    try {
      const userRole = String(req.headers['x-user-role'] || '').toLowerCase();
      if (userRole && !['admin', 'account', 'accountant', 'hr', 'dept_manager'].includes(userRole)) {
        return res.status(403).json({ success: false, message: 'Only Admin or Account users are authorized to edit attendance times' });
      }

      const { records } = req.body as { records: unknown[] };
      if (!Array.isArray(records)) {
        return res.status(400).json({ success: false, message: 'records must be an array' });
      }
      const mapped = records.map((r: any) => ({
        appId: r.id,
        employeeId: r.employeeId,
        departmentId: r.departmentId,
        date: r.date,
        shiftId: r.shiftId,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        manualCheckIn: r.manualCheckIn,
        manualCheckOut: r.manualCheckOut,
        checkInEdited: r.checkInEdited,
        checkOutEdited: r.checkOutEdited,
        checkInEditedBy: r.checkInEditedBy,
        checkOutEditedBy: r.checkOutEditedBy,
        checkInEditedAt: r.checkInEditedAt,
        checkOutEditedAt: r.checkOutEditedAt,
        breakMinutes: r.breakMinutes,
        workingHours: r.workingHours,
        overtime: r.overtime,
        lateMinutes: r.lateMinutes,
        status: r.status,
        location: r.location,
        remarks: r.remarks,
        manualOverride: r.manualOverride,
        createdBy: r.createdBy ?? 'app',
        source: r.source,
      }));
      const results = await AttendanceModel.bulkUpsert(mapped);
      return res.json({ success: true, data: results, count: results.length });
    } catch (err) {
      console.error('[Attendance] bulkUpsert error:', err);
      return res.status(500).json({ success: false, message: 'Failed to bulk save attendance' });
    }
  },

  /** PATCH /api/attendance/:id — partial update */
  async update(req: Request, res: Response) {
    try {
      const userRole = String(req.headers['x-user-role'] || req.body.editorRole || '').toLowerCase();
      if (userRole && !['admin', 'account', 'accountant', 'hr', 'dept_manager'].includes(userRole)) {
        return res.status(403).json({ success: false, message: 'Only Admin or Account users are authorized to edit attendance times' });
      }

      const id = String(req.params.id);
      const patch = req.body;
      const result = await AttendanceModel.updateById(id, {
        checkIn: patch.checkIn,
        checkOut: patch.checkOut,
        manualCheckIn: patch.manualCheckIn,
        manualCheckOut: patch.manualCheckOut,
        checkInEdited: patch.checkInEdited,
        checkOutEdited: patch.checkOutEdited,
        checkInEditedBy: patch.checkInEditedBy,
        checkOutEditedBy: patch.checkOutEditedBy,
        checkInEditedAt: patch.checkInEditedAt,
        checkOutEditedAt: patch.checkOutEditedAt,
        breakMinutes: patch.breakMinutes,
        workingHours: patch.workingHours,
        overtime: patch.overtime,
        lateMinutes: patch.lateMinutes,
        status: patch.status,
        location: patch.location,
        remarks: patch.remarks,
        shiftId: patch.shiftId,
        departmentId: patch.departmentId,
        manualOverride: patch.manualOverride,
        date: patch.date,
        employeeId: patch.employeeId,
      });
      if (!result) {
        return res.status(404).json({ success: false, message: 'Record not found' });
      }
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('[Attendance] update error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update attendance' });
    }
  },

  /** POST /api/attendance/bulk-update — update many records with the same patch */
  async bulkUpdate(req: Request, res: Response) {
    try {
      const userRole = String(req.headers['x-user-role'] || '').toLowerCase();
      if (userRole && !['admin', 'account', 'accountant', 'hr', 'dept_manager'].includes(userRole)) {
        return res.status(403).json({ success: false, message: 'Only Admin or Account users are authorized to edit attendance times' });
      }

      const { ids, patch } = req.body as { ids: string[]; patch: Record<string, unknown> };
      if (!Array.isArray(ids)) {
        return res.status(400).json({ success: false, message: 'ids must be an array' });
      }
      const results = await AttendanceModel.updateMany(ids, patch);
      return res.json({ success: true, data: results, count: results.length });
    } catch (err) {
      console.error('[Attendance] bulkUpdate error:', err);
      return res.status(500).json({ success: false, message: 'Failed to bulk update attendance' });
    }
  },

  /** DELETE /api/attendance/:id */
  async delete(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      await AttendanceModel.deleteById(id);
      res.json({ success: true });
    } catch (err) {
      console.error('[Attendance] delete error:', err);
      res.status(500).json({ success: false, message: 'Failed to delete attendance' });
    }
  },
};
