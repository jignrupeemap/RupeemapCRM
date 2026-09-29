import { crc32 } from 'zlib';
import type { Col, ReportResult } from './report-engine.service';

/** Report exports without extra libraries: CSV (Excel-friendly UTF-8) and a real .xlsx workbook. */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Neutralise spreadsheet formulas in text cells (CSV / formula injection).
const safeText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

function cellValue(v: unknown, c: Col): string | number {
  if (v === null || v === undefined || v === '') return '';
  if (c.type === 'date') return new Date(v as string).toISOString().slice(0, 10);
  if (c.type === 'money' || c.type === 'number' || c.type === 'percent') return typeof v === 'number' ? v : Number(v);
  return safeText(String(v));
}

export function toCsv(r: ReportResult): Buffer {
  const line = (vals: (string | number)[]) => vals.map((v) => (typeof v === 'number' ? String(v) : `"${String(v).replace(/"/g, '""')}"`)).join(',');
  const lines = [line(r.columns.map((c) => c.label)), ...r.rows.map((row) => line(r.columns.map((c) => cellValue(row[c.key], c))))];
  if (r.totals) lines.push(line(r.columns.map((c, i) => (i === 0 ? 'Total' : c.key in r.totals! ? r.totals![c.key] : ''))));
  return Buffer.from('﻿' + lines.join('\r\n'), 'utf8');
}

function colName(i: number) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function toXlsx(r: ReportResult): Buffer {
  // Styles: 0 default, 1 bold header, 2 ₹ money, 3 date, 4 bold total money
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;₹&quot;#,##,##0.00"/><numFmt numFmtId="165" formatCode="dd-mmm-yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="5"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" applyNumberFormat="1" applyFont="1"/></cellXfs>
</styleSheet>`;
  const cell = (ref: string, v: string | number, c?: Col, style?: number) => {
    if (v === '') return '';
    if (typeof v === 'number') return `<c r="${ref}"${style ? ` s="${style}"` : c?.type === 'money' ? ' s="2"' : ''}><v>${v}</v></c>`;
    if (c?.type === 'date') {
      const serial = (Date.parse(v) - Date.UTC(1899, 11, 30)) / 86_400_000;
      return `<c r="${ref}" s="3"><v>${serial}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t>${esc(v)}</t></is></c>`;
  };
  const rows: string[] = [];
  rows.push(`<row r="1">${r.columns.map((c, i) => cell(`${colName(i)}1`, c.label, undefined, 1)).join('')}</row>`);
  r.rows.forEach((row, ri) => rows.push(`<row r="${ri + 2}">${r.columns.map((c, i) => cell(`${colName(i)}${ri + 2}`, cellValue(row[c.key], c), c)).join('')}</row>`));
  if (r.totals) {
    const n = r.rows.length + 2;
    rows.push(`<row r="${n}">${r.columns.map((c, i) => (i === 0 ? cell(`A${n}`, 'Total', undefined, 1) : c.key in r.totals! ? cell(`${colName(i)}${n}`, r.totals![c.key], c, c.type === 'money' ? 4 : 1) : '')).join('')}</row>`);
  }
  const widths = r.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.type === 'money' ? 16 : c.type === 'date' ? 13 : Math.min(40, Math.max(10, c.label.length + 4))}" customWidth="1"/>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`;
  const name = esc(r.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  const files: [string, string][] = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles],
    ['xl/worksheets/sheet1.xml', sheet],
  ];
  return zipStored(files.map(([n, s]) => [n, Buffer.from(s, 'utf8')]));
}

/** Minimal ZIP writer (no compression), enough for an .xlsx package. */
function zipStored(entries: [string, Buffer][]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
