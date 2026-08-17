/** Parse Google / Hamro Patro calendar files into holiday rows. */

export interface ImportedHoliday {
  name: string;
  date: string; // YYYY-MM-DD
}

function normalizeDate(raw: string): string | null {
  const trimmed = raw.trim();
  const ics = trimmed.match(/^(\d{4})(\d{2})(\d{2})/);
  if (ics) return `${ics[1]}-${ics[2]}-${ics[3]}`;

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

export function parseICS(content: string): ImportedHoliday[] {
  const blocks = content.split(/BEGIN:VEVENT/i).slice(1);
  const results: ImportedHoliday[] = [];

  for (const block of blocks) {
    const summaryMatch = block.match(/SUMMARY(?:;[^:\r\n]*)?:([^\r\n]+)/i);
    const startMatch = block.match(/DTSTART(?:;[^:\r\n]*)?:([^\r\n]+)/i);
    if (!summaryMatch || !startMatch) continue;

    const name = summaryMatch[1].trim().replace(/\\,/g, ',').replace(/\\n/gi, ' ');
    const date = normalizeDate(startMatch[1]);
    if (name && date) results.push({ name, date });
  }

  return dedupe(results);
}

export function parseHolidayCSV(content: string): ImportedHoliday[] {
  const lines = content
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const split = (line: string) =>
    line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));

  const header = split(lines[0]).map(h => h.toLowerCase());
  const hasHeader =
    header.some(h => /name|title|event|holiday|festival/.test(h)) &&
    header.some(h => /date|day|bs|ad/.test(h));

  const nameIdx = hasHeader
    ? header.findIndex(h => /name|title|event|holiday|festival/.test(h))
    : 0;
  const dateIdx = hasHeader
    ? header.findIndex(h => /date|day|ad/.test(h) && !/bs/.test(h))
    : 1;

  const rows = hasHeader ? lines.slice(1) : lines;
  const results: ImportedHoliday[] = [];

  for (const line of rows) {
    const cols = split(line);
    const name = cols[nameIdx >= 0 ? nameIdx : 0];
    const date = normalizeDate(cols[dateIdx >= 0 ? dateIdx : 1] ?? '');
    if (name && date) results.push({ name, date });
  }

  return dedupe(results);
}

export function parseHolidayJSON(content: string): ImportedHoliday[] {
  const data = JSON.parse(content);
  const list = Array.isArray(data)
    ? data
    : data.events ?? data.holidays ?? data.data ?? [];

  if (!Array.isArray(list)) return [];

  const results: ImportedHoliday[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name =
      item.name ?? item.title ?? item.summary ?? item.event ?? item.festival;
    const dateRaw =
      item.date ?? item.start ?? item.dtstart ?? item.ad_date ?? item.adDate;
    const date = dateRaw ? normalizeDate(String(dateRaw)) : null;
    if (name && date) results.push({ name: String(name), date });
  }

  return dedupe(results);
}

export async function parseHolidayFile(file: File): Promise<ImportedHoliday[]> {
  const text = await file.text();
  const name = file.name.toLowerCase();

  if (name.endsWith('.ics') || text.includes('BEGIN:VEVENT')) {
    return parseICS(text);
  }
  if (name.endsWith('.json') || text.trim().startsWith('[') || text.trim().startsWith('{')) {
    return parseHolidayJSON(text);
  }
  return parseHolidayCSV(text);
}

function dedupe(items: ImportedHoliday[]): ImportedHoliday[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.date}|${item.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
