import React from 'react';
import type { Attendance } from '../../types';
import { formatTime, cn } from '../../lib/utils';

/**
 * Format date and time for tooltip (e.g. 2026-07-25 12:45)
 */
function formatEditDateTime(isoOrDate: string): string {
  if (!isoOrDate) return '';
  try {
    const d = new Date(isoOrDate);
    if (isNaN(d.getTime())) return isoOrDate;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${mins}`;
  } catch {
    return isoOrDate;
  }
}

/**
 * Builds tooltip message for edited attendance times: "Edited by [user name] on [date and time]"
 */
export function getEditTooltip(record?: Attendance, type: 'in' | 'out' = 'in'): string {
  if (!record) return 'Manually edited by authorized user';
  const editor = (type === 'in' ? record.checkInEditedBy : record.checkOutEditedBy) || record.createdBy || 'Admin';
  const rawAt = type === 'in' ? record.checkInEditedAt : record.checkOutEditedAt;
  const timeStr = rawAt ? formatEditDateTime(rawAt) : record.updatedAt ? formatEditDateTime(record.updatedAt) : record.date;
  return `Edited by ${editor} on ${timeStr}`;
}

/** True when this row has any explicit per-field edit metadata. */
function hasPerFieldEditMeta(record: Attendance): boolean {
  // Do NOT treat checkInEdited === false as metadata — DB default is false for all rows.
  return (
    record.checkInEdited === true ||
    record.checkOutEdited === true ||
    Boolean(record.manualCheckIn) ||
    Boolean(record.manualCheckOut) ||
    Boolean(record.checkInEditedBy) ||
    Boolean(record.checkOutEditedBy) ||
    Boolean(record.checkInEditedAt) ||
    Boolean(record.checkOutEditedAt)
  );
}

/**
 * Checks whether a check-in or check-out time was manually added/edited by an admin/account user.
 * - With per-field metadata: only the edited side gets a star.
 * - Legacy rows (manualOverride, no per-field flags): star each present time.
 */
export function isManualTime(record?: Attendance, type: 'in' | 'out' = 'in'): boolean {
  if (!record) return false;

  const hasTime =
    type === 'in'
      ? Boolean(record.manualCheckIn || record.checkIn)
      : Boolean(record.manualCheckOut || record.checkOut);
  if (!hasTime) return false;

  if (type === 'in') {
    if (record.checkInEdited === true || Boolean(record.manualCheckIn)) return true;
  } else if (record.checkOutEdited === true || Boolean(record.manualCheckOut)) {
    return true;
  }

  // Record already tracks edits per field — do not fall back to whole-row override.
  if (hasPerFieldEditMeta(record)) {
    return false;
  }

  // Legacy: admin-saved override, or statuses that are always entered manually.
  if (record.manualOverride) return true;
  if (
    record.status === 'field_work' ||
    record.status === 'meeting' ||
    record.status === 'personal_work'
  ) {
    return true;
  }
  return false;
}

interface TimeDisplayProps {
  time?: string;
  isManual?: boolean;
  record?: Attendance;
  type?: 'in' | 'out';
  className?: string;
  title?: string;
}

/**
 * Renders formatted time string. If manual/edited, displays a small red superscript star (*) with a tooltip.
 */
export function TimeDisplay({
  time,
  isManual,
  record,
  type = 'in',
  className,
  title,
}: TimeDisplayProps) {
  const formatted = formatTime(time);
  if (!formatted || formatted === '—') {
    return <span className={cn('text-slate-400 dark:text-slate-600', className)}>—</span>;
  }

  const showStar = isManual ?? (record ? isManualTime(record, type) : false);
  const tooltipTitle = title || (record ? getEditTooltip(record, type) : 'Manually edited by authorized user');

  return (
    <span className={cn('inline-flex items-center font-mono', className)}>
      <span>{formatted}</span>
      {showStar && (
        <sup
          className="edited-time-mark text-red-600 dark:text-red-500 font-bold align-super text-[0.75em] cursor-help ml-0.5 select-none"
          title={tooltipTitle}
        >
          *
        </sup>
      )}
    </span>
  );
}
