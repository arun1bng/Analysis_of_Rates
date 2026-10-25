import React, { useEffect, useState } from "react";

export default function RateAnalysisDSR({ estimateRows, theme = "dark" }: any) {
  const [analyses, setAnalyses] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchAnalyses = async () => {
      setLoading(true);
      const uniqueCodes = Array.from(new Set(estimateRows.map((r: any) => r.itemCode).filter(Boolean)));
      const newAnalyses: Record<string, any> = {};

      for (const code of uniqueCodes) {
        try {
          const res = await fetch(`/api/rate-analysis?code=${code}`);
          const data = await res.json();
          newAnalyses[code as string] = Array.isArray(data) ? data : [];
        } catch (e) {
          console.error(`Failed to fetch AR for ${code}`, e);
          newAnalyses[code as string] = [];
        }
      }
      setAnalyses(newAnalyses);
      setLoading(false);
    };

    if (estimateRows.length > 0) fetchAnalyses();
  }, [estimateRows]);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[#0b0f19] text-slate-100 font-sans text-xs">
      <div className="flex justify-between items-center mb-6 pb-2 border-b border-slate-800">
        <h2 className="text-sm font-bold text-blue-400 uppercase tracking-widest">Rate Analysis (DSR)</h2>
        <button className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded font-bold shadow flex items-center gap-1">📄 Export RA PDF</button>
      </div>

      {loading ? (
        <div className="text-center text-slate-500 py-20 text-base animate-pulse">Fetching Rate Analyses from database...</div>
      ) : estimateRows.length === 0 ? (
        <div className="text-center text-slate-500 py-20 italic text-base">No items in Measurement Sheet to analyze.</div>
      ) : (
        <div className="space-y-10 max-w-6xl mx-auto pb-10">
          {estimateRows.map((item: any, idx: number) => {
            const breakdown = analyses[item.itemCode] || [];
            
            return (
              <div key={idx} className="border border-slate-800 rounded-xl overflow-hidden bg-[#0b0f19] shadow-2xl mb-8">
                <div className="bg-slate-900/60 border-b border-slate-800 p-4">
                  <div className="text-amber-500 font-bold mb-2">Item {idx + 1} [{item.itemCode}]</div>
                  <div className="text-slate-300 text-sm leading-relaxed text-justify">{item.description}</div>
                </div>

                <div className="overflow-x-auto p-4">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-900 text-slate-400 border-b border-slate-700">
                      <tr>
                        <th className="p-3 w-28">Code</th>
                        <th className="p-3">Description</th>
                        <th className="p-3 w-16 text-center">Unit</th>
                        <th className="p-3 w-24 text-right">Qty</th>
                        <th className="p-3 w-24 text-right">Rate (₹)</th>
                        <th className="p-3 w-28 text-right">Amount (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {breakdown.length > 0 ? breakdown.map((row: any, i: number) => {
                        const isNCR = row.row_type === 'NCR';
                        const hasAmtNum = row.amount !== null && row.amount !== undefined && row.amount !== '';
                        const hasAmtStr = row.amount_str && row.amount_str.trim() !== '';
                        const hasAmt = hasAmtNum || hasAmtStr;
                        const descText = row.description || "";
                        const dUp = descText.toUpperCase();

                        if (isNCR && !hasAmt) {
                          const isBoldHeader = ["MATERIAL", "LABOUR", "MACHINERY"].includes(dUp) || dUp.startsWith("DETAILS OF COST");
                          return (
                            <tr key={i} className="border-b border-slate-800/50 bg-transparent">
                              <td className="p-3"></td>
                              <td className={`p-3 text-slate-200 ${isBoldHeader ? 'font-bold uppercase tracking-wider' : ''}`}>
                                {descText}
                              </td>
                              <td className="p-3"></td>
                              <td className="p-3"></td>
                              <td className="p-3"></td>
                              <td className="p-3"></td>
                            </tr>
                          );
                        } else {
                          const code = row.component_code || "";
                          const unit = row.unit || "";
                          const qty = (row.quantity !== null && row.quantity !== undefined && row.quantity !== '') ? Number(row.quantity).toFixed(3) : "";
                          const rate = (row.rate !== null && row.rate !== undefined && row.rate !== '') ? (Number(row.rate) === 0 ? "0.00" : Number(row.rate).toFixed(2)) : "";
                          let amt = "";
                          if (hasAmtStr && row.amount_str.includes('%')) {
                            amt = row.amount_str;
                          } else if (hasAmtNum) {
                            amt = Number(row.amount).toFixed(2);
                          }

                          if (isNCR && hasAmt) {
                            return (
                              <tr key={i} className="hover:bg-slate-900/60 border-b border-slate-800/50 transition-colors">
                                <td className="p-3"></td>
                                <td className="p-3 text-slate-300">{descText}</td>
                                <td className="p-3"></td>
                                <td className="p-3"></td>
                                <td className="p-3"></td>
                                <td className="p-3 text-right font-mono text-green-400 font-bold">{amt}</td>
                              </tr>
                            );
                          }

                          return (
                            <tr key={i} className="hover:bg-slate-900/60 border-b border-slate-800/50 transition-colors">
                              <td className="p-3 font-mono text-amber-500 font-bold">{code}</td>
                              <td className="p-3 text-slate-300">{descText}</td>
                              <td className="p-3 text-center text-slate-400">{unit}</td>
                              <td className="p-3 text-right font-mono text-slate-200">{qty}</td>
                              <td className="p-3 text-right font-mono text-slate-200">{rate}</td>
                              <td className="p-3 text-right font-mono text-green-400 font-bold">{amt}</td>
                            </tr>
                          );
                        }
                      }) : <tr><td colSpan={6} className="p-6 text-center opacity-60 text-base italic">No calculation breakdown available in database.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}