type ZipFile = { name: string; data: string | Uint8Array };

const xml = (value: unknown) => String(value ?? "").replace(/[<>&'\"]/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '\"': "&quot;" }[char] || char));
const columnName = (number: number) => {
  let result = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
};

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(files: ZipFile[]) {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const header = (length: number, entries: Array<[number, number, number]>) => {
    const bytes = new Uint8Array(length);
    const view = new DataView(bytes.buffer);
    entries.forEach(([position, value, size]) => size === 2 ? view.setUint16(position, value, true) : view.setUint32(position, value, true));
    return bytes;
  };
  for (const file of files) {
    const name = encoder.encode(file.name);
    const contents = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const checksum = crc32(contents);
    const localHeader = header(30, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [14, checksum, 4], [18, contents.length, 4], [22, contents.length, 4], [26, name.length, 2]]);
    local.push(localHeader, name, contents);
    const centralHeader = header(46, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [16, checksum, 4], [20, contents.length, 4], [24, contents.length, 4], [28, name.length, 2], [42, offset, 4]]);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + contents.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = header(22, [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, centralSize, 4], [16, offset, 4]]);
  const parts: BlobPart[] = [...local, ...central, end].map(part => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer);
  return new Blob(parts, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function cellText(cell: HTMLTableCellElement) {
  const clone = cell.cloneNode(true) as HTMLTableCellElement;
  clone.querySelectorAll("button, input[type=checkbox], svg").forEach(element => element.remove());
  clone.querySelectorAll("input, textarea, select").forEach(element => {
    const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const value = field instanceof HTMLInputElement && field.type === "checkbox" ? (field.checked ? "Yes" : "No") : field.value;
    field.replaceWith(document.createTextNode(value));
  });
  return (clone.innerText || clone.textContent || "").replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ").trim();
}

/** Exports the rendered table(s) in a component to a formatted .xlsx workbook. */
export function exportTableToExcel(root: HTMLElement | null, title: string, fileBaseName: string) {
  if (!root) {
    window.alert("The table is not ready to export yet.");
    return;
  }
  const tables = Array.from(root.querySelectorAll("table"));
  if (!tables.length) {
    window.alert("There are no tables on this page to export.");
    return;
  }

  type SheetCell = { text: string; style: number; span?: number };
  const sheetRows: SheetCell[][] = [[{ text: title, style: 1 }]];
  const sheetMerges: string[] = [];
  let headerLabels: string[] = [];
  for (const [tableIndex, table] of tables.entries()) {
    if (tableIndex > 0) sheetRows.push([]);
    const sourceRows = Array.from(table.querySelectorAll("tr"));
    const headerRow = sourceRows.find(row => row.closest("thead")) || sourceRows[0];
    const excluded = new Set<number>();
    if (headerRow) {
      headerLabels = [];
      Array.from(headerRow.cells).forEach((cell, index) => {
        const label = cellText(cell);
        if (/^(action|actions)$/i.test(label)) excluded.add(index);
        else {
          const span = Math.max(1, cell.colSpan || 1);
          for (let i = 0; i < span; i++) headerLabels.push(label);
        }
      });
    }
    for (const row of sourceRows) {
      const sourceCells = Array.from(row.cells);
      const hasHeader = row.closest("thead") !== null;
      const mapped: SheetCell[] = [];
      const pendingMerges: Array<{ start: number; end: number }> = [];
      sourceCells.forEach((cell, index) => {
        if (excluded.has(index)) return;
        const text = cellText(cell);
        const span = Math.max(1, cell.colSpan || 1);
        const start = mapped.length + 1;
        mapped.push({ text, style: hasHeader ? 2 : 3, span });
        for (let i = 1; i < span; i++) mapped.push({ text: "", style: hasHeader ? 2 : 3 });
        if (span > 1 && text) pendingMerges.push({ start, end: start + span - 1 });
      });
      if (mapped.some(cell => cell.text)) {
        sheetRows.push(mapped);
        const sheetRowNumber = sheetRows.length;
        pendingMerges.forEach(({ start, end }) => sheetMerges.push(`<mergeCell ref="${columnName(start)}${sheetRowNumber}:${columnName(end)}${sheetRowNumber}"/>`));
      }
    }
  }

  const maxColumns = Math.max(1, ...sheetRows.map(row => row.length));
  if (maxColumns > 1) sheetMerges.push(`<mergeCell ref="A1:${columnName(maxColumns)}1"/>`);
  const rowsXml = sheetRows.map((row, rowIndex) => {
    let column = 1;
    const cells = row.map(cell => {
      const ref = `${columnName(column)}${rowIndex + 1}`;
      column++;
      return `<c r="${ref}" t="inlineStr" s="${cell.style}"><is><t xml:space="preserve">${xml(cell.text)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="28" customHeight="1"' : ""}>${cells}</row>`;
  }).join("");
  const columns = Array.from({ length: maxColumns }, (_, index) => {
    const label = String(headerLabels[index] || "").toLowerCase();
    const width = /description/.test(label) ? 58 : /item code|code/.test(label) ? 18 : /sl\.?\s*no/.test(label) ? 12 : /unit/.test(label) ? 12 : /quantity|qty/.test(label) ? 14 : /amount|rate/.test(label) ? 18 : index === 0 ? 18 : 16;
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Book Antiqua"/></font><font><b/><sz val="16"/><name val="Book Antiqua"/><color rgb="FF1D4ED8"/></font><font><b/><sz val="11"/><name val="Book Antiqua"/><color rgb="FFFFFFFF"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const mergesXml = sheetMerges.length ? `<mergeCells count="${sheetMerges.length}">${sheetMerges.join("")}</mergeCells>` : "";
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="100"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData>${rowsXml}</sheetData>${mergesXml}<pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/><printOptions horizontalCentered="1"/></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(title).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const files: ZipFile[] = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: styles },
    { name: "xl/worksheets/sheet1.xml", data: worksheet },
  ];
  const blob = createStoredZip(files);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileBaseName.replace(/[^\w-]+/g, "_")}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
