import React from "react";

const formatAmt = (val: number, formatStr: string) => {
  const num = Math.round(val);
  if (formatStr === "Standard (Millions)") return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(num);
  if (formatStr === "Exact Value") return num.toString();
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(num);
};

export default function GeneralAbstract({ estimateRows = [], rates = [], projectDetails, marketRates = {}, theme = "dark" }: any) {
  
  const currentFormat = projectDetails?.currencyFormat || "Indian (Lakhs/Crores)";

  const SH_NAMES: Record<string, string> = {
    "1": "SH 1: CARRIAGE OF MATERIALS", "2": "SH 2: EARTH WORK", "3": "SH 3: MORTARS", "4": "SH 4: CONCRETE WORK",
    "5": "SH 5: REINFORCED CEMENT CONCRETE", "6": "SH 6: BRICK WORK", "7": "SH 7: STONE WORK", "8": "SH 8: MARBLE AND GRANITE WORK",
    "9": "SH 9: WOOD AND P.V.C. WORK", "10": "SH 10: STEEL WORK", "11": "SH 11: FLOORING", "12": "SH 12: ROOFING", "13": "SH 13: FINISHING",
    "14": "SH 14: REPAIRS TO BUILDINGS", "15": "SH 15: DISMANTLING AND DEMOLITION", "16": "SH 16: ROAD WORK", "17": "SH 17: SANITARY INSTALLATIONS",
    "18": "SH 18: WATER SUPPLY", "19": "SH 19: DRAINAGE", "20": "SH 20: PILE WORK", "21": "SH 21: ALUMINIUM WORK", "22": "SH 22: WATER PROOFING",
    "23": "SH 23: STRUCTURAL STEEL & METAL WORKS", "24": "SH 24: BUILDING MAINTENANCE", "25": "SH 25: ROAD & PAVEMENT REPAIRS",
    "26": "SH 26: WATER SUPPLY & SANITARY FITTINGS", "49": "SH 49: SPECIAL ARs / Sub ARs (NOT IN DSR)", 
    "50": "SH 50: MODIFIED DSR ITEMS (mDSR)", "51": "SH 51: NON-SCHEDULE ITEMS (NS)"
  };

  const extractSHNum = (shName: string) => {
    const match = shName.match(/SH (\d+)/);
    return match ? parseInt(match[1]) : 999;
  };

  const getSHName = (code: string) => {
    const prefix = code?.split('.')[0] || "1";
    return SH_NAMES[prefix] || `SH ${prefix}: GENERAL WORK`;
  };

  const groupedTotals: Record<string, number> = {};
  const isNSR = (code: string) => code?.startsWith("NSR") || code?.startsWith("51.");

  estimateRows.forEach((row: any) => {
    const shTitle = getSHName(row.itemCode);
    const mRate = marketRates && marketRates[row.itemCode] !== undefined ? Number(marketRates[row.itemCode]) : (Number(row.rate) || 0);
    const amt = Math.round(mRate * (Number(row.quantity) || 1));
    
    if (!groupedTotals[shTitle]) groupedTotals[shTitle] = 0;
    groupedTotals[shTitle] += amt;
  });

  const sortedSHNames = Object.keys(groupedTotals).sort((a, b) => extractSHNum(a) - extractSHNum(b));

  const totalDSR = Math.round(estimateRows.filter((r: any) => !isNSR(r.itemCode)).reduce((sum: number, row: any) => sum + (Number(row.rate) || 0) * (Number(row.quantity) || 1), 0));
  
  const ciRate = Number(projectDetails.costIndex) || 0;
  const ciAmount = Math.round(totalDSR * (ciRate / 100));
  const subtotalDSR_CI = totalDSR + ciAmount;

  const modFactor = Number(projectDetails.gstModificationFactor) || 1;
  const modifiedDSR = Math.round(subtotalDSR_CI * modFactor);

  const nsrTotal = Math.round(estimateRows.filter((r: any) => isNSR(r.itemCode)).reduce((sum: number, row: any) => {
       const mRate = marketRates && marketRates[row.itemCode] !== undefined ? Number(marketRates[row.itemCode]) : (Number(row.rate) || 0);
       return sum + (mRate * (Number(row.quantity) || 1));
    }, 0));

  const baseCombined = modifiedDSR + nsrTotal;

  const epfRate = (Number(projectDetails.epf) || 0) / 100;
  const esiRate = (Number(projectDetails.esi) || 0) / 100;
  const epfAmount = Math.round(baseCombined * epfRate);
  const esiAmount = Math.round(baseCombined * esiRate);

  let contingencyAmount = 0;
  let contLabel = "";
  if (projectDetails.contingencyType === 'Custom (%)') {
     const custRate = Number(projectDetails.customContingency) || 0;
     contingencyAmount = Math.round(baseCombined * (custRate / 100));
     contLabel = `Add Contingency @ ${custRate}%:`;
  } else if (projectDetails.contingencyType === 'Zero (0%)') {
     contingencyAmount = 0;
  } else {
     if (baseCombined <= 10000000) {
       contingencyAmount = Math.round(baseCombined * 0.05);
       contLabel = `Add Contingency @ 5%:`;
     } else {
       contingencyAmount = Math.max(500000, Math.round(baseCombined * 0.03));
       contLabel = `Add Contingency @ 3% (>1Cr):`;
     }
  }

  let customTaxAmount = 0;
  if (projectDetails.customTaxName && Number(projectDetails.customTaxRate) > 0) {
      customTaxAmount = Math.round(baseCombined * (Number(projectDetails.customTaxRate) / 100));
  }

  const preGrandTotal = baseCombined + epfAmount + esiAmount + contingencyAmount + customTaxAmount;
  const grandTotalRounded = Math.round(preGrandTotal / 100) * 100;
  
  const ciDecString = parseFloat((ciRate / 100).toFixed(4)).toString();
  const ciMultiplierString = parseFloat((1 + (ciRate / 100)).toFixed(4)).toString();

  let refFinalStr = "E + F + G";
  if (contingencyAmount > 0) refFinalStr += " + H";
  if (customTaxAmount > 0) refFinalStr += " + I";

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6 font-sans text-sm bg-[#0b1121] text-slate-100 items-center">
      
      <div className="w-full max-w-5xl flex justify-between items-center mb-6 pb-2 border-b border-slate-800 shrink-0">
        <div className="text-lg font-bold text-amber-500 tracking-widest uppercase">
          GENERAL ABSTRACT (FINANCIAL BREAKDOWN)
        </div>
        <div className="flex gap-2">
          <button className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded font-bold shadow flex items-center gap-1 text-sm">📊 Excel</button>
          <button className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded font-bold shadow flex items-center gap-1 text-sm">📄 PDF</button>
        </div>
      </div>

      <div className="w-full max-w-5xl border border-slate-800 rounded-lg overflow-auto shadow-2xl bg-slate-950 flex-1">
        <table className="w-full text-left border-collapse relative">
          <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 sticky top-0 z-10 text-[13px]">
            <tr>
              <th className="p-4 w-24 text-center border-r border-slate-700/50 font-bold">Sl. No.</th>
              <th className="p-4 border-r border-slate-700/50 font-bold">Description of Item</th>
              <th className="p-4 w-40 text-right border-r border-slate-700/50 font-bold">Amount (₹)</th>
              <th className="p-4 w-16 text-center font-bold">Ref</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {sortedSHNames.map((shTitle, idx) => {
              const seqNum = idx + 1;

              return (
                <tr key={idx} className="hover:bg-slate-900/40 transition-colors">
                  <td className="p-4 text-center font-bold text-amber-500 text-base border-r border-slate-700/50">{seqNum}</td>
                  <td className="p-4 font-bold text-slate-200 text-base border-r border-slate-700/50">{shTitle}</td>
                  <td className="p-4 text-right font-mono font-bold text-slate-300 text-base border-r border-slate-700/50">₹{formatAmt(groupedTotals[shTitle], currentFormat)}</td>
                  <td className="p-4"></td>
                </tr>
              );
            })}

            {estimateRows.length > 0 && (
              <>
                <tr className="bg-slate-900/50 border-t-4 border-slate-800">
                  <td colSpan={2} className="p-4 text-right font-bold text-slate-300 border-r border-slate-700/50 text-base">Total of DSR / Schedule Items:</td>
                  <td className="p-4 text-right text-blue-400 font-bold font-mono text-base border-r border-slate-700/50">₹{formatAmt(totalDSR, currentFormat)}</td>
                  <td className="p-4 text-center font-bold text-slate-400 border-r border-slate-700/50">A</td>
                </tr>
                {ciRate > 0 && (
                  <tr className="hover:bg-slate-900/50">
                    <td colSpan={2} className="p-4 text-right font-bold text-slate-300 border-r border-slate-700/50 text-base">Add Cost Index @ {ciRate}% on DSR Items:</td>
                    <td className="p-4 text-right text-blue-400 font-bold font-mono text-base border-r border-slate-700/50">₹{formatAmt(ciAmount, currentFormat)}</td>
                    <td className="p-4 text-center font-bold text-slate-400 border-r border-slate-700/50">{ciDecString}A</td>
                  </tr>
                )}
                {ciRate > 0 && (
                  <tr className="hover:bg-slate-900/50">
                    <td colSpan={2} className="p-4 text-right font-bold text-slate-300 border-r border-slate-700/50 text-base">Subtotal of DSR and MDSR items enhanced by CI @ {ciRate}%:</td>
                    <td className="p-4 text-right text-blue-400 font-bold font-mono text-base border-r border-slate-700/50">₹{formatAmt(subtotalDSR_CI, currentFormat)}</td>
                    <td className="p-4 text-center font-bold text-slate-400 border-r border-slate-700/50">B = {ciMultiplierString}A</td>
                  </tr>
                )}
                <tr className="bg-slate-900/30">
                  <td colSpan={2} className="p-4 text-right font-bold text-slate-300 border-r border-slate-700/50 text-base">Modified estimated cost after applying multiplying factor ({modFactor}) on DSR and mDSR items:</td>
                  <td className="p-4 text-right text-slate-200 font-bold font-mono text-base border-r border-slate-700/50">₹{formatAmt(modifiedDSR, currentFormat)}</td>
                  <td className="p-4 text-center font-bold text-slate-400 border-r border-slate-700/50">C = {modFactor}B</td>
                </tr>
                <tr className="bg-slate-900/30">
                  <td colSpan={2} className="p-4 text-right font-bold text-slate-400 border-r border-slate-700/50 text-base">Total of Non-Schedule (NS) Items:</td>
                  <td className="p-4 text-right text-slate-300 font-bold font-mono text-base border-r border-slate-700/50">₹{formatAmt(nsrTotal, currentFormat)}</td>
                  <td className="p-4 text-center font-bold text-slate-400 border-r border-slate-700/50">D</td>
                </tr>
                <tr className="bg-slate-900 border-y border-slate-700">
                  <td colSpan={2} className="p-4 text-right text-amber-400 font-bold border-r border-slate-700/50 text-base">Base Estimate Total (Schedule + Non-Schedule):</td>
                  <td className="p-4 text-right text-amber-500 font-bold font-mono text-base border-r border-slate-700/50">₹{formatAmt(baseCombined, currentFormat)}</td>
                  <td className="p-4 text-center font-bold text-slate-400 border-r border-slate-700/50">E = C + D</td>
                </tr>
                
                <tr className="hover:bg-slate-900/30">
                  <td colSpan={2} className="p-4 text-right font-bold text-slate-400 border-r border-slate-700/50 text-base">Add EPF @ {projectDetails.epf}%:</td>
                  <td className="p-4 text-right font-mono text-slate-300 text-base border-r border-slate-700/50">₹{formatAmt(epfAmount, currentFormat)}</td>
                  <td className="p-4 text-center font-bold text-slate-400 border-r border-slate-700/50">F</td>
                </tr>
                <tr className="hover:bg-slate-900/30">
                  <td colSpan={2} className="p-4 text-right font-bold text-slate-400 border-r border-slate-700/50 text-base">Add ESI @ {projectDetails.esi}%:</td>
                  <td className="p-4 text-right font-mono text-slate-300 text-base border-r border-slate-700/50">₹{formatAmt(esiAmount, currentFormat)}</td>
                  <td className="p-4 text-center font-bold text-slate-400 border-r border-slate-700/50">G</td>
                </tr>
                {contingencyAmount > 0 && (
                  <tr className="hover:bg-slate-900/30">
                    <td colSpan={2} className="p-4 text-right font-bold text-slate-400 border-r border-slate-700/50 text-base">{contLabel}</td>
                    <td className="p-4 text-right font-mono text-slate-300 text-base border-r border-slate-700/50">₹{formatAmt(contingencyAmount, currentFormat)}</td>
                    <td className="p-4 text-center font-bold text-slate-400 border-r border-slate-700/50">H</td>
                  </tr>
                )}
                {customTaxAmount > 0 && (
                  <tr className="hover:bg-slate-900/30">
                    <td colSpan={2} className="p-4 text-right font-bold text-slate-400 border-r border-slate-700/50 text-base">Add {projectDetails.customTaxName} @ {projectDetails.customTaxRate}%:</td>
                    <td className="p-4 text-right text-slate-200 font-mono text-base border-r border-slate-700/50">₹{formatAmt(customTaxAmount, currentFormat)}</td>
                    <td className="p-4 text-center font-bold text-slate-400 border-r border-slate-700/50">I</td>
                  </tr>
                )}
                
                <tr className="bg-slate-950 border-t-4 border-emerald-800">
                  <td colSpan={2} className="p-5 text-right font-bold text-emerald-400 uppercase tracking-widest text-base border-r border-slate-700/50">GRAND TOTAL:</td>
                  <td className="p-5 text-right text-emerald-400 text-xl font-bold font-mono border-r border-slate-700/50">₹{formatAmt(preGrandTotal, currentFormat)}</td>
                  <td className="p-5 text-center font-bold text-emerald-600 border-r border-slate-700/50">{refFinalStr}</td>
                </tr>
                <tr className="bg-slate-950">
                  <td colSpan={2} className="p-5 text-right font-bold text-emerald-500 uppercase tracking-widest text-base border-r border-slate-700/50">SAY:</td>
                  <td className="p-5 text-right text-emerald-500 font-bold font-mono text-2xl border-r border-slate-700/50">₹{formatAmt(grandTotalRounded, currentFormat)}</td>
                  <td className="p-5 text-center font-bold text-emerald-600 border-r border-slate-700/50"></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}