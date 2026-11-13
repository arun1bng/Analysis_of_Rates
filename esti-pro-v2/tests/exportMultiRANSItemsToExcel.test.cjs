/* eslint @typescript-eslint/no-require-imports: off */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const Database = require("better-sqlite3");

const projectRoot = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, fileName) => {
  const source = fs.readFileSync(fileName, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(compiled, fileName);
};

const { buildMultiRANSItemsWorkbook } = require(path.join(projectRoot, "app/utils/exportMultiRANSItemsToExcel.ts"));

function loadFixtureItems() {
  const nsrDb = new Database(path.join(projectRoot, "backend/NSR_Items.db"), { readonly: true });
  const darDb = new Database(path.join(projectRoot, "backend/CPWD_Software_Backend.db"), { readonly: true });
  const requestedCodes = ["51.5", "51.8", "51.10", "51.11", "51.12", "51.13.1", "51.15", "51.15.1"];
  const items = requestedCodes.map(code => {
    const record = nsrDb.prepare("SELECT * FROM custom_rates WHERE code = ?").get(code);
    assert.ok(record, `Expected NSR fixture ${code} to exist in the supplied project database`);
    return {
      ...record,
      itemCode: record.code,
      itemNo: record.code,
      itemDescription: record.description,
      baseQty: null,
      analysisRows: JSON.parse(record.analysisRows || "[]"),
      nsrSettings: JSON.parse(record.settings_json || "{}"),
      isExternalAR: Boolean(record.is_external_ar),
    };
  });
  nsrDb.close();

  global.fetch = async requestUrl => {
    const code = new URL(String(requestUrl), "http://localhost").searchParams.get("code");
    const record = darDb.prepare("SELECT dar_item_id, item_code, description, unit, dar_rate FROM dar_items WHERE LOWER(TRIM(item_code)) = LOWER(?)").get(code);
    if (!record) return { ok: false, status: 404, json: async () => [] };
    const rows = darDb.prepare(`SELECT row_type, component_code, description, unit, quantity, rate, amount,
      calc_mark, is_sub_ar FROM rate_analysis WHERE dar_item_id = ? ORDER BY component_sequence`).all(record.dar_item_id);
    return { ok: true, json: async () => rows };
  };
  return { items, darDb };
}

function itemBlock(sheet, code) {
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    if (row.getCell(1).value === "Item No." && String(row.getCell(2).value) === code) {
      const headerRow = rowNumber;
      let end = headerRow + 1;
      while (end <= sheet.rowCount && sheet.getRow(end).getCell(1).value !== "Item No.") end++;
      return { start: headerRow, end: end - 1, rows: Array.from({ length: end - headerRow }, (_, i) => sheet.getRow(headerRow + i)) };
    }
  }
  return null;
}

function findDescription(block, pattern) {
  return block.rows.find(row => pattern.test(String(row.getCell(2).value ?? "")));
}

test("multi-NSR export formulas, hierarchy, amounts and separators match saved backend analyses", async () => {
  const { items, darDb } = loadFixtureItems();
  try {
    const workbook = await buildMultiRANSItemsWorkbook(items);
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [
      "AR _ NS Items",
      "AR _ mDSR Items",
      "Sub AR _ NS Items",
      "Sub AR _ mDSR Items",
    ], "the four analysis worksheets use the requested names and order");
    const main = workbook.getWorksheet("AR _ NS Items");
    const subs = workbook.getWorksheet("Sub AR _ NS Items");
    assert.ok(main, "AR _ NS Items worksheet exists");
    assert.ok(subs, "Sub AR _ NS Items worksheet exists");

    assert.equal(itemBlock(main, "51.15"), null, "parent-only 51.15 is not printed as an analysis");
    assert.ok(itemBlock(main, "51.15.1"), "child analysis 51.15.1 is printed");

    for (const [code, expectedBaseQty, expectedRate, expectedSay] of [["51.5", 21.8, 172.62, 172.6], ["51.8", 110, 352.14, 352.15], ["51.13.1", 20.62, 604.3, 604.3]]) {
      const block = itemBlock(main, code);
      assert.ok(block, `analysis block ${code} exists`);
      const unitRate = findDescription(block, /^Cost of 1(?:\.00)?\s/i);
      assert.ok(unitRate, `${code} has a unit-rate row`);
      assert.match(unitRate.getCell(6).value.formula, new RegExp(`/\\s*${expectedBaseQty}(?:\\.|,|\\))`), `${code} unit rate divides by its analysis base quantity`);
      assert.equal(unitRate.getCell(6).value.result, expectedRate, `${code} unit-rate cached result matches the division`);
      const say = findDescription(block, /^SAY$/i);
      assert.equal(say.getCell(6).value.result, expectedSay, `${code} SAY cached result reflects five-paise rounding of the calculated unit rate`);
    }

    const five = itemBlock(main, "51.5");
    const physicalSubtotal = findDescription(five, /^Total\s*=\s*14\.49kg/i);
    assert.ok(physicalSubtotal, "physical subtotal note remains present");
    assert.equal(physicalSubtotal.getCell(6).value, null, "physical subtotal has no amount or SUM formula");
    assert.equal(physicalSubtotal.getCell(6).border?.top?.style, undefined, "physical subtotal notes have no horizontal separator");
    assert.equal(physicalSubtotal.getCell(6).border?.left?.style, "thin", "physical subtotal notes retain solid vertical outlines");
    const component1008 = five.rows.find(row => row.getCell(1).value === "1008");
    assert.equal(component1008.getCell(6).value.result, 790.25, "790.25 remains with the 1008 cost component, not a physical subtotal");
    assert.equal(component1008.getCell(4).numFmt, "0.00##########", "quantity displays at least two decimals while preserving extra precision");
    assert.equal(component1008.getCell(5).numFmt, "0.00##########", "rate displays at least two decimals while preserving extra precision");
    assert.equal(component1008.getCell(6).numFmt, "##,##,##,##0.00", "amount uses Indian lakh/crore grouping");
    assert.ok(component1008.getCell(1).border.left && component1008.getCell(1).border.right, "normal rows retain solid vertical outlines");
    const say = findDescription(five, /^SAY$/i);
    assert.deepEqual(
      [say.getCell(6).border.top.style, say.getCell(6).border.bottom.style, say.getCell(6).border.left.style, say.getCell(6).border.right.style],
      ["medium", "medium", "medium", "medium"],
      "only final SAY amount receives its medium four-sided border",
    );

    const twelve = itemBlock(main, "51.12");
    const fiftyPercent = findDescription(twelve, /^50%\s+of\s+P$/i);
    assert.ok(fiftyPercent, "derived 50% of P row exists");
    assert.match(fiftyPercent.getCell(6).value.formula, /F\d+\*\(50\/100\)/, "50% of P is linked with an Excel formula");
    assert.equal(fiftyPercent.getCell(6).value.result, 2675, "50% calculation cache matches the saved analysis");
    const totalW12 = findDescription(twelve, /^TOTAL\s+W$/i);
    assert.match(totalW12.getCell(6).value.formula, new RegExp(`F${fiftyPercent.number}(?:[,)]|$)`), "TOTAL W includes the 50% of P row exactly once");
    assert.equal(totalW12.getCell(6).value.result, 11308.43, "TOTAL W retains material, labour and derived amount");

    const thirteen = itemBlock(main, "51.13.1");
    const cpoh = findDescription(thirteen, /CPOH/i);
    const cess = findDescription(thirteen, /Cess/i);
    const gst = findDescription(thirteen, /GST/i);
    assert.match(cpoh.getCell(6).value.formula, /\*\(15\/100\)/, "CPOH uses its own 15% label and dependency");
    assert.match(cess.getCell(6).value.formula, /\*\(1\/100\)/, "Cess uses its own 1% label and dependency");
    assert.match(gst.getCell(6).value.formula, /\*\(21\.27\/100\)/, "GST uses its own 21.27% factor and dependency");

    const ten = itemBlock(main, "51.10");
    const totalW10 = findDescription(ten, /^TOTAL\s+W$/i);
    assert.ok(totalW10.getCell(6).value.formula.includes("SUM("), "51.10 TOTAL W is a native sum formula");
    assert.equal(totalW10.getCell(6).border?.top?.style, "thin", "financial block starts with a single top separator");
    assert.equal(totalW10.getCell(6).border?.left?.style, "thin", "financial rows retain vertical column borders");
    assert.equal(totalW10.getCell(6).value.result, 8114.64, "51.10 W sums the rounded component amounts, including materials and labour");
    const water10 = findDescription(ten, /Water charges/i);
    assert.match(water10.getCell(6).value.formula, /MAX\(0,\(F\d+-SUM\(F\d+\)\)\)/, "51.10 water uses W less the A-marked amount");
    assert.equal(water10.getCell(6).value.result, 78.21, "51.10 water charge matches the saved A-excluded calculation");
    assert.equal(water10.getCell(6).border?.top?.style, undefined, "financial rows have no inner horizontal separators");
    assert.equal(findDescription(ten, /^SAY$/i).getCell(6).value.result, 1203.75, "51.10 SAY follows saved charges and base quantity");
    const eleven = itemBlock(main, "51.11");
    const totalW11 = findDescription(eleven, /^TOTAL\s+W$/i);
    assert.equal(totalW11.getCell(6).value.result, 36096.70, "51.11 W uses the corrected linked 9.1.1 Sub-AR rate with all components");

    const woodSubAR = itemBlock(subs, "9.1.1");
    assert.ok(woodSubAR, "9.1.1 Sub-AR is included from the tested DSR database");
    const woodUnitRate = findDescription(woodSubAR, /^Cost of 1(?:\.00)?\s/i);
    assert.match(woodUnitRate.getCell(6).value.formula, /\/0\.036\b/, "9.1.1 uses the saved Cost of 0.036 cum denominator");
    assert.equal(woodUnitRate.getCell(6).value.result, 142949.72, "9.1.1 unit rate matches the supported DAR calculation");
    assert.equal(findDescription(woodSubAR, /^Say$/i).getCell(6).value.result, 142949.7, "9.1.1 SAY rounds its corrected unit rate to five paise");

    const refRow = five.rows.find(row => {
      const value = row.getCell(1).value;
      return value === "13.50.3" || value?.text === "13.50.3";
    });
    assert.ok(refRow.getCell(1).value.hyperlink?.includes("Sub AR _ NS Items"), "13.50.3 code links to the supporting worksheet");
    assert.ok(refRow.getCell(5).value.formula?.includes("Sub AR _ NS Items"), "13.50.3 rate is linked to its Sub-AR SAY rate");
    assert.ok(itemBlock(subs, "13.50.3"), "13.50.3 supporting analysis is present once");
    assert.equal(subs.getRows(1, subs.rowCount).filter(row => row.getCell(1).value === "Item No." && String(row.getCell(2).value) === "9.1.1").length, 1, "9.1.1 supporting analysis is not duplicated");
    assert.equal(subs.getRows(1, subs.rowCount).filter(row => row.getCell(1).value === "Item No." && String(row.getCell(2).value) === "13.50.3").length, 1, "Sub-AR analysis is not duplicated");
  } finally {
    darDb.close();
  }
});
