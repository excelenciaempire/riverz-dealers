// Local text extraction only. No URLs, OCR, formula calculation or HTML rendering.
// APIs: https://github.com/mehmet-kozan/pdf-parse, https://github.com/mwilliamson/mammoth.js,
// https://github.com/exceljs/exceljs. Executed in a time-limited child process.
import { unzipSync } from 'fflate';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 32000;
function fail(code = 'document_unreadable') { throw Object.assign(new Error(code), { code }); }
function officeArchive(bytes, format) {
  let expanded = 0, count = 0;
  const entries = unzipSync(bytes, { filter(entry) {
    expanded += entry.originalSize;
    if (++count > 2048 || expanded > 32 * 1024 * 1024) fail('document_too_large');
    if (/vbaproject|\/embeddings\/|\/externallinks\//i.test(entry.name)) fail();
    return true;
  } });
  if (!entries['[Content_Types].xml'] || !entries[format === 'docx' ? 'word/document.xml' : 'xl/workbook.xml']) fail();
  for (const [name, data] of Object.entries(entries)) {
    if (/\.(xml|rels)$/i.test(name) && /<!DOCTYPE|<!ENTITY/i.test(Buffer.from(data).toString('utf8'))) fail();
  }
}
function finish(text) {
  text = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  if (!text) fail('document_no_text');
  if (text.length > MAX_TEXT) fail('document_text_limit');
  return text;
}
async function extract(format, bytes) {
  if (!bytes.length || bytes.length > MAX_BYTES) fail('document_too_large');
  if (format === 'pdf') {
    if (bytes.subarray(0, 5).toString() !== '%PDF-') fail();
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(bytes), isEvalSupported: false, stopAtErrors: true });
    try {
      const info = await parser.getInfo();
      if (info.total > 100) fail('document_too_large');
      const result = await parser.getText({ pageJoiner: '\n' });
      // Page markers alone are not readable knowledge.
      if (!result.pages.some(page => page.text.trim())) fail('document_no_text');
      return finish(result.pages.map(page => page.text).join('\n\n'));
    } finally { await parser.destroy(); }
  }
  if (format !== 'docx' && format !== 'xlsx') fail();
  officeArchive(bytes, format);
  if (format === 'docx') {
    const { default: mammoth } = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: bytes }, { externalFileAccess: false });
    return finish(result.value);
  }
  const { default: { Workbook } } = await import('exceljs');
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes, { ignoreNodes: ['drawing', 'picture', 'conditionalFormatting', 'dataValidations', 'extLst'] });
  if (workbook.worksheets.length > 20) fail('document_too_large');
  const lines = [];
  let cells = 0, size = 0;
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== 'visible') continue;
    lines.push(`[${sheet.name}]`);size += sheet.name.length + 3;
    sheet.eachRow(row => {
      const values = [];
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        if (++cells > 20000 || column > 200) fail('document_too_large');
        // Formula cached results can be stale; never run or infer their value.
        if (cell.formula || cell.type === 6) fail('document_formulas');
        const value = cell.value;
        if (value && typeof value === 'object' && 'error' in value) fail();
        const text = value instanceof Date ? value.toISOString() : cell.text;
        values.push(`${column}: ${text.replace(/[\t\r\n]+/g, ' ')}`);
      });
      const line = values.join(' | ');size += line.length + 1;
      if (size > MAX_TEXT) fail('document_text_limit');
      if (line) lines.push(line);
    });
  }
  if (!cells) fail('document_no_text');
  return finish(lines.join('\n'));
}
let input = '', oversized = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (input.length + chunk.length > 7 * 1024 * 1024) { oversized = true;input = ''; } else if (!oversized) input += chunk;
});
process.stdin.on('end', async () => {
  try {
    if (oversized) fail('document_too_large');
    const request = JSON.parse(input);
    const text = await extract(request.format, Buffer.from(request.data, 'base64'));
    process.stdout.write(JSON.stringify({ ok: true, text }));
  } catch (error) {
    const allowed = ['document_too_large', 'document_no_text', 'document_text_limit', 'document_formulas'];
    process.stdout.write(JSON.stringify({ ok: false, code: allowed.includes(error.code) ? error.code : 'document_unreadable' }));
  }
});
