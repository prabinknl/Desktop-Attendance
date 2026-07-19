import NepaliDatePkg from 'nepali-date-converter';
import { format as formatAd } from 'date-fns';

// CJS/ESM interop for nepali-date-converter
const NepaliDate =
  (NepaliDatePkg as unknown as { default?: typeof NepaliDatePkg }).default ??
  NepaliDatePkg;

export type CalendarSystem = 'ad' | 'bs';

export interface DateDisplaySettings {
  calendarSystem: CalendarSystem;
  showBothCalendars: boolean;
  nepaliDateFormat: string;
  weekStart: string;
}

export const DEFAULT_DATE_SETTINGS: DateDisplaySettings = {
  calendarSystem: 'ad',
  showBothCalendars: true,
  nepaliDateFormat: 'YYYY-MM-DD',
  weekStart: 'sunday',
};

const STORAGE_KEY = 'settings-date';

let currentSettings: DateDisplaySettings = loadSettings();

function loadSettings(): DateDisplaySettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULT_DATE_SETTINGS, ...JSON.parse(saved) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_DATE_SETTINGS };
}

export function getDateSettings(): DateDisplaySettings {
  return currentSettings;
}

export function setDateSettings(next: DateDisplaySettings) {
  currentSettings = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  localStorage.setItem('calendar-system', next.calendarSystem);
}

const BS_MONTHS_EN = [
  'Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Aswin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
];

const BS_MONTHS_NE = [
  'बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज',
  'कात्तिक', 'मंसिर', 'पुष', 'माघ', 'फाल्गुन', 'चैत',
];

const DIGITS_NE = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

function toNepaliDigits(value: string | number): string {
  return String(value).replace(/\d/g, d => DIGITS_NE[Number(d)]);
}

function parseInputDate(date: string | Date): Date | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatBsPrimary(d: Date, nepaliDateFormat: string): string {
  const nd = NepaliDate.fromAD(d);
  const bs = nd.getBS(); // month is 0-indexed
  const y = bs.year;
  const m = bs.month + 1;
  const day = bs.date;
  const mm = String(m).padStart(2, '0');
  const dd = String(day).padStart(2, '0');

  if (nepaliDateFormat === 'ne-unicode') {
    return `${toNepaliDigits(dd)} ${BS_MONTHS_NE[bs.month]} ${toNepaliDigits(y)}`;
  }
  if (nepaliDateFormat === 'DD MMMM YYYY') {
    return `${day} ${BS_MONTHS_EN[bs.month]} ${y}`;
  }
  // YYYY-MM-DD
  return `${y}-${mm}-${dd}`;
}

function formatAdPrimary(d: Date, fmt: string): string {
  // Map chart-friendly short formats
  try {
    return formatAd(d, fmt);
  } catch {
    return formatAd(d, 'dd MMM yyyy');
  }
}

/**
 * Formats a date using the current app date settings (AD / Nepali BS).
 * Prefer calling this for all user-visible dates so Settings changes apply globally.
 * BS values are always labeled when shown alongside AD so years like 2083 are not ambiguous.
 */
export function formatDate(date: string | Date, fmt = 'dd MMM yyyy'): string {
  const d = parseInputDate(date);
  if (!d) return '—';

  const settings = getDateSettings();
  const adLabel = formatAdPrimary(d, fmt);
  const bsLabel = formatBsPrimary(d, settings.nepaliDateFormat);

  if (settings.calendarSystem === 'bs') {
    if (settings.showBothCalendars) return `${bsLabel} (BS) · ${adLabel} (AD)`;
    return `${bsLabel} (BS)`;
  }

  if (settings.showBothCalendars && settings.calendarSystem === 'ad') {
    // Only append BS for full date styles, not tiny chart ticks like EEE / MMM
    const isFull = /y|d{2}|MMM|MMMM/i.test(fmt) && !/^E+$/i.test(fmt) && fmt !== 'MMM';
    if (isFull && fmt !== 'MMM dd' && fmt !== 'EEE') {
      return `${adLabel} (AD) · ${bsLabel} (BS)`;
    }
  }

  return adLabel;
}

export function formatDateTime(dt: string | Date): string {
  const d = parseInputDate(dt);
  if (!d) return '—';
  const settings = getDateSettings();
  const time = formatAd(d, 'hh:mm a');
  if (settings.calendarSystem === 'bs') {
    const bs = formatBsPrimary(d, settings.nepaliDateFormat);
    return settings.showBothCalendars
      ? `${bs} (BS) ${time} · ${formatAd(d, 'dd MMM yyyy')} (AD)`
      : `${bs} (BS) ${time}`;
  }
  const adDate = formatAd(d, 'dd MMM yyyy');
  return settings.showBothCalendars
    ? `${adDate} (AD), ${time} · ${formatBsPrimary(d, settings.nepaliDateFormat)} (BS)`
    : `${adDate}, ${time}`;
}

/** Convert AD `yyyy-MM-dd` → BS `yyyy-MM-dd` (Nepali calendar). */
export function adYmdToBsYmd(adYmd: string): string {
  const d = parseInputDate(`${adYmd}T12:00:00`);
  if (!d) return '';
  const bs = NepaliDate.fromAD(d).getBS();
  return `${bs.year}-${String(bs.month + 1).padStart(2, '0')}-${String(bs.date).padStart(2, '0')}`;
}

/** Convert BS `yyyy-MM-dd` → AD `yyyy-MM-dd`. */
export function bsYmdToAdYmd(bsYmd: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(bsYmd.trim());
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 32) return '';
  try {
    const nd = new NepaliDate(year, month - 1, day);
    const ad = nd.getAD();
    return `${ad.year}-${String(ad.month + 1).padStart(2, '0')}-${String(ad.date).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export function getBsMonthDayCount(year: number, month1to12: number): number {
  for (let day = 32; day >= 28; day -= 1) {
    try {
      const nd = new NepaliDate(year, month1to12 - 1, day);
      const bs = nd.getBS();
      if (bs.year === year && bs.month === month1to12 - 1 && bs.date === day) return day;
    } catch {
      /* try smaller */
    }
  }
  return 30;
}

export const BS_MONTH_OPTIONS = BS_MONTHS_EN.map((label, i) => ({
  value: i + 1,
  label: `${String(i + 1).padStart(2, '0')} · ${label}`,
}));
