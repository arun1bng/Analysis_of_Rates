import React from "react";

export default function JustificationSummary({ estimateRows, theme, marketRates }: any) {
  const getContainerClass = () => {
    if (theme === "dark") return "bg-slate-900 text-slate-200";
    if (theme === "custom") return "bg-indigo-950 text-indigo-100";
    return "bg-white text-gray-900";
  };

  const getTableClass = () => {
    if (theme === "dark") return "border-slate-700 bg-slate-800";
    if (theme === "custom") return "border-indigo-800 bg-indigo-900";
    return "border-gray-200 bg-gray-50";
  };

  const totalDSR = estimateRows.reduce((sum: number, item: any) => sum + (item.rate || 0) * (item.quantity || 1), 0);
  const totalMarket = estimateRows.reduce((sum: number, item: any) => {
    const mRate = marketRates && marketRates[item.itemCode] !== undefined ? marketRates[item.itemCode] : (item.rate || 0);
    return sum + (mRate * (item.quantity || 1));
  }, 0);
  
  const deviation = totalDSR > 0 ? (((totalMarket - totalDSR) / totalDSR) * 100).toFixed(2) : "0.00";
  const isPositive = Number(deviation) > 0;

  // Generate and download Summary CSV
  const exportToCSV = () => {
    const headers = ["Description", "Amount as per DSR (₹)", "Amount as per Market (₹)", "Deviation %"];
    const rows = [
      ["Total Estimated Cost", totalDSR.toFixed(2), totalMarket.toFixed(2), ""],
      ["Overall Financial Deviation", "", "", `${isPositive ? '+' : ''}${deviation}%`]
    ];
    const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Executive_Justification_Summary.csv";
    link.click();
  };

  return (
    <div className={`flex-1 overflow-y-auto p-8 ${getContainerClass()}`}>
      
      <div className="flex justify-between items-center mb-6 pb-2 border-b border-gray-200">
        <h2 className="text-sm font-bold text-blue-600 uppercase tracking-widest">Executive Justification Summary</h2>
        <div className="flex gap-2">
          <button onClick={exportToCSV} className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow transition-colors">📊 Export CSV</button>
          <button className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow transition-colors">📄 Export PDF</button>
        </div>
      </div>

      <div className={`border rounded-lg overflow-hidden shadow-md max-w-3xl mx-auto mt-10 ${getTableClass()}`}>
        <table className="w-full text-left text-sm">
          <thead className={theme !== 'light' ? 'bg-slate-900 text-slate-400' : 'bg-gray-100 text-gray-700 border-b border-gray-200'}>
            <tr>
              <th className="p-4 w-1/2">Description</th>
              <th className="p-4 text-right">Amount as per DSR (₹)</th>
              <th className="p-4 text-right">Amount as per Market (₹)</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${theme !== 'light' ? 'divide-slate-700 bg-slate-800' : 'divide-gray-200 bg-white'}`}>
            <tr className={`hover:${theme !== 'light' ? 'bg-slate-700' : 'bg-gray-50'}`}>
              <td className="p-4 font-bold text-lg">Total Estimated Cost</td>
              <td className="p-4 text-right font-mono text-blue-500 font-bold text-lg">{totalDSR.toFixed(2)}</td>
              <td className="p-4 text-right font-mono text-rose-500 font-bold text-lg">{totalMarket.toFixed(2)}</td>
            </tr>
            <tr className={theme !== 'light' ? 'bg-slate-900/80' : 'bg-gray-100'}>
              <td className="p-4 font-bold text-right uppercase tracking-wider text-xs text-slate-500">Overall Financial Deviation:</td>
              <td colSpan={2} className={`p-4 text-center font-mono font-bold text-xl ${isPositive ? 'text-rose-500' : 'text-emerald-500'}`}>
                {isPositive ? '+' : ''}{deviation}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}