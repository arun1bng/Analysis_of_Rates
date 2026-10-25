import React, { useState } from "react";

export default function RateList({ theme, marketRates, setMarketRates }: any) {
  const [rateCategories] = useState([
    {
      title: "0.1 BASIC RATES OF HIRE CHARGES OF PLANTS AND MACHINERIES (0001 - 0099)",
      items: [
        { sl: 1, code: "0049", desc: "Dozer 80 HP for spreading", unit: "hour", dsrRate: 1700.00 },
        { sl: 2, code: "0050", desc: "Motor grader for grading", unit: "hour", dsrRate: 2700.00 },
        { sl: 3, code: "0054", desc: "Vibratory roller 8-10 tonne", unit: "hour", dsrRate: 700.00 },
        { sl: 4, code: "0057", desc: "Water tanker 6 KL capacity", unit: "hour", dsrRate: 250.00 }
      ]
    },
    {
      title: "0.2 BASIC RATES OF LABOUR (0100 - 0221)",
      items: [
        { sl: 1, code: "0101", desc: "Bhisti", unit: "day", dsrRate: 816.00 },
        { sl: 2, code: "0112", desc: "Carpenter 2nd class", unit: "day", dsrRate: 816.00 },
        { sl: 3, code: "0114", desc: "Beldar", unit: "day", dsrRate: 736.00 },
        { sl: 4, code: "0115", desc: "Coolie", unit: "day", dsrRate: 736.00 },
        { sl: 5, code: "0128", desc: "Mate", unit: "day", dsrRate: 816.00 }
      ]
    },
    {
      title: "0.3 BASIC RATES OF MATERIALS (0222 - 9999 EXCEPT 2200-2358)",
      items: [
        { sl: 1, code: "0367", desc: "Portland Cement", unit: "tonne", dsrRate: 5156.00 },
        { sl: 2, code: "0982", desc: "Coarse sand (zone III)", unit: "cum", dsrRate: 1450.00 },
        { sl: 3, code: "9999", desc: "Sundries", unit: "L.S.", dsrRate: 2.27 }
      ]
    }
  ]);

  const handleRateChange = (code: string, value: string) => {
    setMarketRates((prev: any) => ({
      ...prev,
      [code]: parseFloat(value) || 0
    }));
  };

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

  const getInputClass = () => {
    if (theme === "dark") return "bg-slate-950 border-slate-600 text-slate-100 focus:border-blue-500";
    if (theme === "custom") return "bg-indigo-950 border-indigo-600 text-indigo-100 focus:border-blue-400";
    return "bg-white border-gray-300 text-gray-900 focus:border-blue-500";
  };

  return (
    <div className={`flex-1 overflow-y-auto p-6 ${getContainerClass()}`}>
      <div className="flex justify-between items-center mb-6 pb-2 border-b border-gray-200">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-bold text-emerald-500 uppercase tracking-widest">Rate List (Market Rates Justification)</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold opacity-70">Global Market Format:</span>
            <select className={`text-xs font-bold border rounded px-2 py-1 outline-none ${theme !== 'light' ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-300'}`}>
              <option>Conventional DSR (Water → GST 0.2127 → CPOH → Cess)</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <input type="text" placeholder="Search code or description..." className={`border rounded px-3 py-1.5 text-sm outline-none focus:border-blue-500 w-64 ${theme !== 'light' ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-gray-300'}`} />
          <button className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow transition-colors">📊 Export CSV</button>
          <button className="bg-slate-400 hover:bg-slate-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow transition-colors">↩ Undo Last Change</button>
          <button className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow transition-colors">✓ Update & Save</button>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {rateCategories.map((category, catIdx) => (
          <div key={catIdx} className={`border rounded-lg overflow-hidden shadow-sm ${getTableClass()}`}>
            
            <div className={`p-2.5 font-bold text-xs text-amber-500 ${theme !== 'light' ? 'bg-slate-900 border-b border-slate-700' : 'bg-gray-100 border-b border-gray-200'}`}>
              {category.title}
            </div>

            <table className="w-full text-left text-xs">
              <thead className={theme !== 'light' ? 'bg-slate-800 text-slate-400' : 'bg-white text-gray-700 border-b border-gray-200'}>
                <tr>
                  <th className="p-2 w-12 text-center">Sl.No.</th>
                  <th className="p-2 w-24">Code</th>
                  <th className="p-2">Description</th>
                  <th className="p-2 w-20 text-center">Unit</th>
                  <th className="p-2 w-28 text-right">DSR Rate (₹)</th>
                  <th className="p-2 w-32 text-center">Market Rate (₹)</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${theme !== 'light' ? 'divide-slate-700 bg-slate-800' : 'divide-gray-200 bg-white'}`}>
                {category.items.map((item, itemIdx) => {
                  const currentMarketRate = marketRates[item.code] !== undefined ? marketRates[item.code] : item.dsrRate;
                  
                  return (
                    <tr key={itemIdx} className={`hover:${theme !== 'light' ? 'bg-slate-700' : 'bg-gray-50'}`}>
                      <td className="p-2 text-center font-bold">{item.sl}</td>
                      <td className="p-2 font-bold">{item.code}</td>
                      <td className="p-2 font-bold">{item.desc}</td>
                      <td className="p-2 text-center">{item.unit}</td>
                      <td className="p-2 text-right font-bold bg-black/5">{item.dsrRate.toFixed(2)}</td>
                      <td className="p-1.5 text-center">
                        <input 
                          type="number" 
                          value={currentMarketRate || ''} 
                          onChange={(e) => handleRateChange(item.code, e.target.value)}
                          className={`w-24 text-right font-bold border rounded px-2 py-1 outline-none ${getInputClass()}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}