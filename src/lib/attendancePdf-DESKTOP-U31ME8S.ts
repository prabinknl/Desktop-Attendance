import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Attendance, Department, Employee, LeaveRequest, Shift } from '../types';
import {
  attendanceStatusLabel,
  calcOtLtHours,
  formatHoursMinutes,
  formatOtLt,
  formatTime,
  isApprovedLeaveDay,
} from './utils';
import { formatDateBsPdf } from './dateDisplay';
import { resolveEmployeeSchedule } from './appSettings';
import { isManualTime } from '../components/common/TimeDisplay';

export interface AttendancePdfMeta {
  employeeName: string;
  /** Optional AD month label — not shown under the title (date only). */
  monthLabel?: string;
  /** Shown alone under "Daily attendance" (prefer BS range). */
  dateLabel: string;
  fileName?: string;
}

function formatWeekday(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleDateString('en-US', { weekday: 'long' });
}

function displayRemark(record: Attendance): string {
  if (record.remarks && !record.remarks.startsWith('source=') && !record.remarks.startsWith('rule=')) {
    return record.remarks;
  }
  if (record.location && record.location !== 'Device Sync') return record.location;
  return '';
}

export function downloadAttendancePdf(
  records: Attendance[],
  maps: {
    employees: Record<string, Employee>;
    departments: Record<string, Department>;
    shifts: Record<string, Shift>;
    leaves?: LeaveRequest[];
  },
  meta: AttendancePdfMeta,
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;

  const getSchedule = (record: Attendance) => {
    const shift = maps.shifts[record.shiftId];
    const emp = maps.employees[record.employeeId];
    const altIds = [emp?.id, emp?.employeeId].filter(
      (id): id is string => Boolean(id) && id !== record.employeeId,
    );
    return resolveEmployeeSchedule(record.employeeId, shift, altIds, record.date);
  };

  const getOtLt = (record: Attendance) => {
    if (String(record.id).startsWith('gap-row-') && record.status === 'holiday') return 0;
    const emp = maps.employees[record.employeeId];
    const aliases = [emp?.id, emp?.employeeId].filter((id): id is string => Boolean(id));
    if (isApprovedLeaveDay(maps.leaves || [], record.employeeId, record.date, aliases)) {
      return 0;
    }
    const schedule = getSchedule(record);
    return calcOtLtHours({
      checkIn: record.checkIn,
      workingHours: record.workingHours,
      overtime: record.overtime,
      lateMinutes: record.lateMinutes,
      shiftStart: schedule.shiftStart,
      graceMinutes: schedule.graceMinutes,
      dayHours: schedule.dayHours,
    });
  };

  const body = records.map((r) => {
    const schedule = getSchedule(r);
    const otLt = getOtLt(r);
    const effIn = r.manualCheckIn || r.checkIn;
    const effOut = r.manualCheckOut || r.checkOut;
    const formattedIn = formatTime(effIn);
    const formattedOut = formatTime(effOut);
    return [
      // Nepali BS date — Latin script so the PDF font can render it
      formatDateBsPdf(r.date),
      formatWeekday(r.date),
      isManualTime(r, 'in') && formattedIn !== '—' ? `${formattedIn}*` : formattedIn,
      isManualTime(r, 'out') && formattedOut !== '—' ? `${formattedOut}*` : formattedOut,
      formatHoursMinutes(r.workingHours || 0),
      formatHoursMinutes(schedule.dayHours),
      formatOtLt(otLt),
      attendanceStatusLabel[r.status] ?? r.status,
      displayRemark(r),
    ];
  });

  const otLtTotal = Math.round(records.reduce((s, r) => s + getOtLt(r), 0) * 100) / 100;

  autoTable(doc, {
    startY: 30,
    head: [[
      'Date (BS)',
      'Day',
      'Check In',
      'Check Out',
      'Hours',
      'Dayhour',
      'OT/LT',
      'Status',
      'Remarks',
    ]],
    body,
    foot: [[
      '',
      '',
      '',
      '',
      '',
      'Total',
      formatOtLt(otLtTotal),
      '',
      '',
    ]],
    theme: 'grid',
    styles: {
      fontSize: 7.5,
      cellPadding: 1.6,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: [248, 250, 252],
      textColor: [71, 85, 105],
      fontStyle: 'bold',
      fontSize: 7,
    },
    footStyles: {
      fillColor: [248, 250, 252],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 20 },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
      5: { cellWidth: 16, halign: 'center' },
      6: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
      7: { cellWidth: 20 },
      8: { cellWidth: 'auto' },
    },
    margin: { left: marginX, right: marginX, top: 30, bottom: 16 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 6) {
        const raw = String(data.cell.raw ?? '');
        if (raw.startsWith('+')) data.cell.styles.textColor = [5, 150, 105];
        else if (raw.startsWith('-')) data.cell.styles.textColor = [225, 29, 72];
      }
      if (data.section === 'foot' && data.column.index === 6) {
        if (otLtTotal > 0) data.cell.styles.textColor = [5, 150, 105];
        else if (otLtTotal < 0) data.cell.styles.textColor = [225, 29, 72];
      }
    },
  });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Employee name — top middle
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text(meta.employeeName, pageWidth / 2, 12, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text('Daily attendance', pageWidth / 2, 18, { align: 'center' });

    // Only the date range under the title (Nepali BS)
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(meta.dateLabel, pageWidth / 2, 23, { align: 'center' });

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(marginX, 26, pageWidth - marginX, 26);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - marginX, pageHeight - 8, {
      align: 'right',
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = meta.fileName ?? `attendance-report-${stamp}.pdf`;
  doc.save(fileName);
}
