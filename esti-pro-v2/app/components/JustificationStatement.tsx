import React from "react";

export default function JustificationStatement({ estimateRows, theme, marketRates }: any) {
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

  // Generate and download CSV file natively
  const exportToCSV = () => {
    const headers = ["Sl No.", "Item Code", "Description", "Unit", "Quantity", "DSR Rate (₹)", "Market Rate (₹)", "Deviation %"];
    const rows = estimateRows.map((item: any, idx: number) => {
      const dsrRate = item.rate || 0;
      const marketRate = marketRates && marketRates[item.itemCode] !== undefined ? marketRates[item.itemCode] : dsrRate;
      const deviation = dsrRate > 0 ? (((marketRate - dsrRate) / dsrRate) * 100).toFixed(2) : "0.00";
      
      // Wrap description in quotes to prevent commas from breaking the CSV layout
      const cleanDesc = item.description ? `"${item.description.replace(/"/g, '""')}"` : "";
      return [idx + 1, item.itemCode, cleanDesc, item.unit, item.quantity, dsrRate.toFixed(2), marketRate.toFixed(2), `${deviation}%`].join(",");
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
      <div className="flex justify-between items-center mb-6 pb-2 border-b border-gray-200">
        <h2 className="text-sm font-bold text-blue-500 uppercase tracking-widest">Justification Statement</h2>
        <div className="flex gap-2">
          <button onClick={exportToCSV} className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow transition-colors">📊 Export CSV</button>
          <button className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow transition-colors">📄 Export PDF</button>
        </div>
      </div>

      {/* Comparative Table */}
      <div className={`border rounded-lg overflow-hidden shadow-sm ${getTableClass()}`}>
        <table className="w-full text-left text-xs">
          <thead className={theme !== 'light' ? 'bg-slate-900 text-slate-400' : 'bg-gray-100 text-gray-700 border-b border-gray-200'}>
            <tr>
              <th className="p-3 w-16 text-center">Sl No.</th>
              <th className="p-3 w-24">Item Code</th>
              <th className="p-3">Description</th>
              <th className="p-3 w-20 text-center">Unit</th>
              <th className="p-3 w-24 text-right">Quantity</th>
              <th className="p-3 w-28 text-right">DSR Rate (₹)</th>
              <th className="p-3 w-28 text-right">Market Rate (₹)</th>
              <th className="p-3 w-24 text-center">Deviation %</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${theme !== 'light' ? 'divide-slate-700 bg-slate-800' : 'divide-gray-200 bg-white'}`}>
            {estimateRows.length > 0 ? estimateRows.map((item: any, idx: number) => {
              const dsrRate = item.rate || 0;
              const marketRate = marketRates && marketRates[item.itemCode] !== undefined ? marketRates[item.itemCode] : dsrRate;
              const deviation = dsrRate > 0 ? (((marketRate - dsrRate) / dsrRate) * 100).toFixed(2) : "0.00";
              const isPositive = Number(deviation) > 0;

              return (
                <tr key={idx} className={`hover:${theme !== 'light' ? 'bg-slate-700' : 'bg-gray-50'}`}>
                  <td className="p-3 text-center font-bold">{idx + 1}</td>
                  <td className="p-3 font-bold text-amber-500">{item.itemCode}</td>
                  <td className="p-3"><div className="line-clamp-2">{item.description}</div></td>
                  <td className="p-3 text-center">{item.unit}</td>
                  <td className="p-3 text-right">{item.quantity}</td>
                  <td className="p-3 text-right font-mono">{dsrRate.toFixed(2)}</td>
                  <td className="p-3 text-right font-mono text-rose-500">{marketRate.toFixed(2)}</td>
                  <td className={`p-3 text-center font-bold ${isPositive ? 'text-rose-500' : 'text-emerald-500'}`}>
                    {isPositive ? '+' : ''}{deviation}%
                  </td>
                </tr>
              );
            }) : (
              <tr><td colSpan={8} className="p-8 text-center opacity-60">No items in BOQ. Add items from the Database Explorer.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}