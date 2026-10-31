export type HierarchicalRow<T = any> = T & {
  rowKey: string;
  rowType: "subhead" | "parent" | "item";
  isSubhead: boolean;
  isParent: boolean;
  isItem: boolean;
  sectionCode: string;
  itemCode: string;
  serialNo: string;
  description: string;
  sourceRow?: T;
  ancestors?: Array<{ code: string; description: string; serialNo: string }>;
};

const SH_NAMES: Record<string, string> = {
  "1": "SH 1: CARRIAGE OF MATERIALS", "2": "SH 2: EARTH WORK", "3": "SH 3: MORTARS", "4": "SH 4: CONCRETE WORK",
  "5": "SH 5: REINFORCED CEMENT CONCRETE", "6": "SH 6: BRICK WORK", "7": "SH 7: STONE WORK", "8": "SH 8: MARBLE AND GRANITE WORK",
  "9": "SH 9: WOOD AND P.V.C. WORK", "10": "SH 10: STEEL WORK", "11": "SH 11: FLOORING", "12": "SH 12: ROOFING", "13": "SH 13: FINISHING",
  "14": "SH 14: REPAIRS TO BUILDINGS", "15": "SH 15: DISMANTLING AND DEMOLITION", "16": "SH 16: ROAD WORK", "17": "SH 17: SANITARY INSTALLATIONS",
  "18": "SH 18: WATER SUPPLY", "19": "SH 19: DRAINAGE", "20": "SH 20: PILE WORK", "21": "SH 21: ALUMINIUM WORK", "22": "SH 22: WATER PROOFING",
  "23": "SH 23: STRUCTURAL STEEL & METAL WORKS", "24": "SH 24: BUILDING MAINTENANCE", "25": "SH 25: ROAD & PAVEMENT REPAIRS",
  "26": "SH 26: WATER SUPPLY & SANITARY FITTINGS", "49": "SH 49: SPECIAL ARs / Sub ARs (NOT IN DSR)",
  "50": "Modified DSR Items", "51": "Non-Scheduled Items",
};

function codeOf(row: any): string {
  return String(row?.itemCode ?? row?.code ?? "").trim();
}

function compareCodes(a: string, b: string): number {
  const left = a.match(/\d+|[a-z]+/gi) || [];
  const right = b.match(/\d+|[a-z]+/gi) || [];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    const ln = Number(left[i]), rn = Number(right[i]);
    if (Number.isFinite(ln) && Number.isFinite(rn) && ln !== rn) return ln - rn;
    const result = left[i].localeCompare(right[i]);
    if (result) return result;
  }
  return 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanDescription(description: unknown, code: string, parentDescriptions: string | string[] = ""): string {
  let text = String(description ?? "").trim();
  const prefixes = (Array.isArray(parentDescriptions) ? parentDescriptions : [parentDescriptions])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (text.startsWith(prefix)) {
        text = text.slice(prefix.length).replace(/^[\s:;–-]+/, "");
        changed = true;
        break;
      }
    }
  }

  return text.replace(new RegExp("^" + escapeRegExp(code) + "(?=\\s|[:–-])\\s*[:–-]?\\s*"), "").trim();
}

function sectionOf(code: string): string {
  if (/^(?:NSR|51\.)/i.test(code)) return "51";
  if (/^50(?:\.|$)/.test(code)) return "50";
  return code.split(".")[0] || "1";
}

function sectionTitle(code: string): string {
  return SH_NAMES[code] || `SH ${code}: GENERAL WORK`;
}

/**
 * Produces a flat, stable display sequence of SH, ancestor, and actual item rows.
 * Codes remain strings throughout so codes such as 2.10 and 13.20 are never
 * coerced to floating-point values or matched as prefixes of shorter codes.
 */
export function buildHierarchicalRows(estimateRows: any[] = [], allRates: any[] = []): HierarchicalRow[] {
  const rateByCode = new Map<string, any>();
  for (const rate of allRates || []) {
    const code = String(rate?.code ?? rate?.itemCode ?? "").trim();
    if (code && !rateByCode.has(code)) rateByCode.set(code, rate);
  }

  const groups = new Map<string, any[]>();
  for (const row of estimateRows || []) {
    const code = codeOf(row);
    if (!code || row?.isSubtotal || row?.isSubhead || String(row?.type || "").toLowerCase() === "sh") continue;
    const section = sectionOf(code);
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section)!.push({ ...row, itemCode: code });
  }

  const sections = [...groups.keys()].sort((a, b) => {
    const an = Number(a), bn = Number(b);
    return Number.isFinite(an) && Number.isFinite(bn) ? an - bn : a.localeCompare(b);
  });
  const output: HierarchicalRow[] = [];

  sections.forEach((sectionCode, sectionIndex) => {
    const serialRoot = String(sectionIndex + 1);
    const sectionItems = groups.get(sectionCode)!.sort((a, b) => compareCodes(a.itemCode, b.itemCode));
    const ancestorCache = new Map<string, { code: string; description: string }[]>();
    const ancestorCodes = new Set<string>();
    for (const item of sectionItems) {
      const parts = item.itemCode.split(".");
      for (let depth = 2; depth < parts.length; depth++) ancestorCodes.add(parts.slice(0, depth).join("."));
    }

    for (const item of sectionItems) {
      const parts = item.itemCode.split(".");
      const ancestors: { code: string; description: string }[] = [];
      for (let depth = 2; depth < parts.length; depth++) {
        const code = parts.slice(0, depth).join(".");
        const record = rateByCode.get(code);
        ancestors.push({ code, description: String(record?.description ?? "") });
      }
      ancestorCache.set(item.itemCode, ancestors);
    }

    output.push({
      rowKey: `subhead:${sectionCode}`,
      rowType: "subhead",
      isSubhead: true,
      isParent: true,
      isItem: false,
      sectionCode,
      itemCode: sectionCode,
      serialNo: serialRoot,
      description: sectionTitle(sectionCode),
      unit: "",
      quantity: "",
      rate: "",
      amount: "",
      sourceRow: undefined,
      ancestors: [],
    });

    const counters = Array.from({ length: 24 }, () => 0);
    let currentPath: string[] = [];
    const emittedParents = new Set<string>();

    for (const item of sectionItems) {
      const code = item.itemCode;
      const ancestors = ancestorCache.get(code) || [];
      // Codes that own descendants are structural parents, never priced item rows.
      if (ancestorCodes.has(code)) continue;
      let divergence = 0;
      while (divergence < ancestors.length && divergence < currentPath.length && ancestors[divergence].code === currentPath[divergence]) divergence++;

      ancestors.slice(divergence).forEach((ancestor, offset) => {
        const depth = divergence + offset;
        counters[depth]++;
        for (let i = depth + 1; i < counters.length; i++) counters[i] = 0;
        const serialNo = `${serialRoot}${counters.slice(0, depth + 1).map((n) => `.${n}`).join("")}`;
        if (emittedParents.has(ancestor.code)) return;
        emittedParents.add(ancestor.code);
        const parentParts = ancestor.code.split(".");
        const parentCode = parentParts.slice(0, -1).join(".");
        const parentRecord = rateByCode.get(parentCode);
        output.push({
          ...parentRecord,
          rowKey: `parent:${sectionCode}:${ancestor.code}`,
          rowType: "parent",
          isSubhead: false,
          isParent: true,
          isItem: false,
          sectionCode,
          itemCode: ancestor.code,
          serialNo,
          description: cleanDescription(ancestor.description, ancestor.code, String(parentRecord?.description ?? "")),
          unit: "",
          quantity: "",
          rate: "",
          amount: "",
          sourceRow: parentRecord,
          ancestors: [],
        });
      });

      currentPath = [...ancestors.map((ancestor) => ancestor.code), code];
      const leafDepth = ancestors.length;
      counters[leafDepth]++;
      for (let i = leafDepth + 1; i < counters.length; i++) counters[i] = 0;
      const serialNo = `${serialRoot}${counters.slice(0, leafDepth + 1).map((n) => `.${n}`).join("")}`;
      const parentDescriptions = ancestors.map((ancestor) => ancestor.description);
      const itemDescription = String(item.description ?? rateByCode.get(code)?.description ?? "");
      output.push({
        ...item,
        rowKey: `item:${sectionCode}:${code}:${String(item.id ?? output.length)}`,
        rowType: "item",
        isSubhead: false,
        isParent: false,
        isItem: true,
        sectionCode,
        itemCode: code,
        serialNo,
        description: cleanDescription(itemDescription, code, parentDescriptions),
        sourceRow: item,
        ancestors,
      });
    }
  });

  return output;
}
