import React from "react";

export default function JustificationStatement({ estimateRows, theme, marketRates }: any) {
  const isDark = theme === "dark" || theme === "custom";

  const getContainerClass = () => {
    if (theme === "dark") return "bg-slate-900 text-slate-200";
    if (theme === "custom") return "bg-indigo-950 text-indigo-100";
    return "bg-white text-gray-900";
  };

  const getTableClass = () => {
    return isDark ? "border-slate-600" : "border-gray-400";
  };

  const getHeaderClass = () => {
    return isDark ? "bg-slate-800 text-slate-200" : "bg-[#e2e8f0] text-gray-900";
  };

  const getCellClass = () => {
    return isDark ? "border-slate-700" : "border-gray-300";
  };

  // Filter out Sub-heads as requested
  const displayRows = estimateRows.filter(
    (row: any) => row.itemCode && row.type !== "sh" && !row.isSubhead
  );

  let totalEstimateAmount = 0;
  let totalJustifiedAmount = 0;

  // Process rows for rendering and financial totals
  const processedRows = displayRows.map((item: any, idx: number) => {
    const qty = Number(item.quantity) || 0;
    const estRate = Number(item.rate) || 0;
    
    // NS items must keep their estimate rate
    const isNS = String(item.itemCode).toUpperCase().startsWith("NS");
    const justifiedRate = isNS 
      ? estRate 
      : (marketRates && marketRates[item.itemCode] !== undefined 
          ? Number(marketRates[item.itemCode]) 
          : estRate);

    const estAmount = Math.round(qty * estRate);
    const justifiedAmount = Math.round(qty * justifiedRate);
    
    const isParent = qty === 0 && estRate === 0;

    if (!isParent) {
      totalEstimateAmount += estAmount;
      totalJustifiedAmount += justifiedAmount;
    }

    return { ...item, idx, qty, estRate, estAmount, justifiedRate, justifiedAmount, isParent, isNS };
  });

  // Calculate final justification percentages
  let justifiedPercentage = 0;
  if (totalEstimateAmount !== 0) {
     justifiedPercentage = ((totalJustifiedAmount - totalEstimateAmount) / totalEstimateAmount) * 100;
  }
  const isBelow = justifiedPercentage < 0;
  const absPercentage = Math.abs(justifiedPercentage).toFixed(2);

  // Generate and download CSV file natively
  const exportToCSV = () => {
    const headers = [
      "Sl. No.",
      "Item Code / DSR Code",
      "Description of Items",
      "Unit",
      "Quantity",
      "Estimate Rate (₹)",
      "Estimate Amount (₹)",
      "Justified Rate (₹)",
      "Justified Amount (₹)"
    ];

    const rows = processedRows.map((item: any, idx: number) => {
      // Wrap description in quotes to prevent commas from breaking the CSV layout
      const cleanDesc = item.description ? `"${item.description.replace(/"/g, '""')}"` : "";
      
      return [
        idx + 1,
        `"${item.itemCode}"`,
        cleanDesc,
        item.isParent ? "" : (item.unit || ""),
        item.isParent ? "" : item.qty.toFixed(3),
        item.isParent ? "" : item.estRate.toFixed(2),
        item.isParent ? "" : item.estAmount,
        item.isParent ? "" : item.justifiedRate.toFixed(2),
        item.isParent ? "" : item.justifiedAmount
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Justification_Statement.csv";
    link.click();
  };

  return (
    <div className={`flex-1 overflow-y-auto p-6 ${getContainerClass()}`}>

      {/* Header Bar */}
      <div className="flex justify-between items-center mb-6 pb-2 border-b border-gray-300">
        <h2 className="text-lg font-bold text-blue-700 uppercase tracking-widest">Justification Statement</h2>
        <div className="flex gap-2">
          <button onClick={exportToCSV} className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow transition-colors">📊 Export CSV</button>
          <button className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow transition-colors">📄 Export PDF</button>
        </div>
      </div>

      {/* Comparative Table styled like Abstract Page */}
      <div className={`border shadow-sm overflow-x-auto bg-white ${getTableClass()}`}>
        <table className="w-full text-left text-[13px] border-collapse">
          <thead className={getHeaderClass()}>
            <tr>
              <th className="p-2 border border-gray-400 text-center w-12">Sl. No.</th>
              <th className="p-2 border border-gray-400 w-28">Item Code / DSR Code</th>
              <th className="p-2 border border-gray-400">Description of Items</th>
              <th className="p-2 border border-gray-400 text-center w-16">Unit</th>
              <th className="p-2 border border-gray-400 text-right w-24">Quantity</th>
              <th className="p-2 border border-gray-400 text-right w-24">Estimate Rate (₹)</th>
              <th className="p-2 border border-gray-400 text-right w-28">Estimate Amount (₹)</th>
              <th className="p-2 border border-gray-400 text-right w-24">Justified Rate (₹)</th>
              <th className="p-2 border border-gray-400 text-right w-28">Justified Amount (₹)</th>
            </tr>
          </thead>
          <tbody className={isDark ? "bg-slate-900" : "bg-white"}>
            {processedRows.length > 0 ? processedRows.map((item: any) => (
              <tr key={item.idx} className={`hover:${isDark ? 'bg-slate-800' : 'bg-gray-50'}`}>
                <td className={`p-2 border ${getCellClass()} text-center align-top font-semibold`}>{item.idx + 1}</td>
                <td className={`p-2 border ${getCellClass()} align-top font-semibold text-amber-600`}>{item.itemCode}</td>
                <td className={`p-2 border ${getCellClass()} align-top whitespace-pre-wrap`}>{item.description}</td>
                
                {item.isParent ? (
                  <>
                    <td className={`p-2 border ${getCellClass()}`}></td>
                    <td className={`p-2 border ${getCellClass()}`}></td>
                    <td className={`p-2 border ${getCellClass()}`}></td>
                    <td className={`p-2 border ${getCellClass()}`}></td>
                    <td className={`p-2 border ${getCellClass()}`}></td>
                    <td className={`p-2 border ${getCellClass()}`}></td>
                  </>
                ) : (
                  <>
                    <td className={`p-2 border ${getCellClass()} text-center align-top`}>{item.unit}</td>
                    <td className={`p-2 border ${getCellClass()} text-right align-top`}>{item.qty.toFixed(3)}</td>
                    <td className={`p-2 border ${getCellClass()} text-right align-top`}>{item.estRate.toFixed(2)}</td>
                    <td className={`p-2 border ${getCellClass()} text-right align-top font-semibold`}>{item.estAmount}</td>
                    <td className={`p-2 border ${getCellClass()} text-right align-top text-rose-600`}>{item.justifiedRate.toFixed(2)}</td>
                    <td className={`p-2 border ${getCellClass()} text-right align-top font-bold text-rose-600`}>{item.justifiedAmount}</td>
                  </>
                )}
              </tr>
            )) : (
              <tr><td colSpan={9} className="p-8 text-center opacity-60">No items in BOQ. Add items from the Database Explorer.</td></tr>
            )}
            
            {/* Totals Row */}
            {processedRows.length > 0 && (
              <tr className={`font-bold ${isDark ? 'bg-slate-800 text-slate-100' : 'bg-gray-100 text-gray-900'}`}>
                <td className={`p-2 border ${getCellClass()} text-right`} colSpan={6}>Total</td>
                <td className={`p-2 border ${getCellClass()} text-right text-[14px]`}>{totalEstimateAmount}</td>
                <td className={`p-2 border ${getCellClass()} text-right`}></td>
                <td className={`p-2 border ${getCellClass()} text-right text-[14px] text-rose-600`}>{totalJustifiedAmount}</td>
              </tr>
            )}
            
            {/* Financial Calculations (Excel Style) */}
            {processedRows.length > 0 && (
              <tr>
                <td colSpan={9} className={`p-4 border ${getCellClass()} text-center font-semibold text-[13px] leading-loose ${isDark ? 'bg-slate-900 text-slate-300' : 'bg-white text-gray-800'}`}>
                  <div>Overall Justified Amount = ({totalJustifiedAmount} / {totalEstimateAmount}) X {totalEstimateAmount} = {totalJustifiedAmount}</div>
                  <div>Justified Percentage = (({totalJustifiedAmount} - {totalEstimateAmount}) / {totalEstimateAmount}) X 100</div>
                  <div className={`mt-2 text-[15px] font-bold ${isDark ? 'text-blue-400' : 'text-blue-700'}`}>
                    Justification is {absPercentage}% {isBelow ? 'below' : 'above'} the Estimated Cost
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}