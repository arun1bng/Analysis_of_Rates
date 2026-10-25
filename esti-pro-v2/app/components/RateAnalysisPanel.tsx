import React from "react";

export default function RateAnalysisPanel({ item, onClose, theme = "dark" }: any) {
  if (!item) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden text-slate-100 font-sans text-sm">
        
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950 shrink-0">
          <h3 className="font-bold text-blue-400 text-base tracking-wide">
            Item Code: {item.code || item.itemCode} AR
          </h3>
          <button 
            onClick={onClose} 
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded text-xs font-bold transition-colors border border-slate-700 shadow"
          >
            Close ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-auto p-6 space-y-6 text-slate-200 leading-relaxed">
          
          {/* Main Item Description Header */}
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 shadow-inner space-y-2">
            <p className="font-mono text-amber-400 font-bold text-sm text-justify break-words whitespace-normal">
              {item.code} {item.description}
            </p>
          </div>

          {/* Rate Analysis Breakdown Container */}
          <div className="bg-[#0b1121] border border-slate-800 rounded-lg overflow-hidden shadow-lg">
            <table className="w-full text-left border-collapse table-fixed">
              <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 text-xs uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="p-3 w-20 text-center border-r border-slate-800">Ref</th>
                  <th className="p-3 w-auto border-r border-slate-800">Description of Cost / Component</th>
                  <th className="p-3 w-16 text-center border-r border-slate-800">Unit</th>
                  <th className="p-3 w-20 text-right border-r border-slate-800">Qty</th>
                  <th className="p-3 w-24 text-right border-r border-slate-800">Rate (₹)</th>
                  <th className="p-3 w-28 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                
                {/* Section Title Note Row */}
                <tr className="bg-slate-900/40">
                  <td colSpan={6} className="p-3 font-mono font-bold text-amber-300 text-xs tracking-wider uppercase text-justify break-words whitespace-normal">
                    DETAILS OF COST FOR 1 MANHOLE / UNIT
                  </td>
                </tr>

                {/* Text Note / Calculation Step 1 */}
                <tr className="bg-slate-950/30">
                  <td colSpan={6} className="p-3 text-slate-300 text-justify break-words whitespace-normal font-mono text-xs">
                    Cement concrete 1:4:8 (1 cement : 4 coarse sand : 8 graded stone aggregate 40 mm nominal size)
                  </td>
                </tr>

                {/* Text Note / Calculation Step 2 */}
                <tr className="bg-slate-950/30">
                  <td colSpan={6} className="p-3 text-slate-400 text-justify break-words whitespace-normal font-mono text-xs">
                    1.51 x 1.41 x 0.20 m = 0.426 cum Say 0.43 cum
                  </td>
                </tr>

                {/* Standard Billable Item Row 1 */}
                <tr className="hover:bg-slate-900/40 transition-colors">
                  <td className="p-3 text-center font-mono text-blue-400 font-bold border-r border-slate-800 align-top">
                    4.1.8
                  </td>
                  <td className="p-3 text-slate-200 text-justify break-words whitespace-normal border-r border-slate-800 align-top">
                    Rate as per item no 4.1.8 of SH : Concrete Work
                  </td>
                  <td className="p-3 text-center text-slate-400 border-r border-slate-800 align-top">cum</td>
                  <td className="p-3 text-right font-mono border-r border-slate-800 align-top">0.430</td>
                  <td className="p-3 text-right font-mono border-r border-slate-800 align-top">6812.00</td>
                  <td className="p-3 text-right font-mono text-green-400 font-bold align-top">2929.16</td>
                </tr>

                {/* Text Note / Calculation Step 3 */}
                <tr className="bg-slate-950/30">
                  <td colSpan={6} className="p-3 text-slate-300 text-justify break-words whitespace-normal font-mono text-xs">
                    Brick work with bricks of class designation 7.5 in foundation & plinth in cement mortar 1:4 (1 cement : 4 coarse sand)
                  </td>
                </tr>

                {/* Text Note / Calculation Step 4 */}
                <tr className="bg-slate-950/30">
                  <td colSpan={6} className="p-3 text-slate-400 text-justify break-words whitespace-normal font-mono text-xs">
                    4.32 x 0.23 x 0.35 m = 0.348 cum
                  </td>
                </tr>

                {/* Standard Billable Item Row 2 */}
                <tr className="hover:bg-slate-900/40 transition-colors">
                  <td className="p-3 text-center font-mono text-blue-400 font-bold border-r border-slate-800 align-top">
                    6.1.1
                  </td>
                  <td className="p-3 text-slate-200 text-justify break-words whitespace-normal border-r border-slate-800 align-top">
                    Rate as per item no 6.1.1 of SH : Brick Work
                  </td>
                  <td className="p-3 text-center text-slate-400 border-r border-slate-800 align-top">cum</td>
                  <td className="p-3 text-right font-mono border-r border-slate-800 align-top">0.340</td>
                  <td className="p-3 text-right font-mono border-r border-slate-800 align-top">7370.65</td>
                  <td className="p-3 text-right font-mono text-green-400 font-bold align-top">2506.02</td>
                </tr>

              </tbody>
            </table>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex justify-between items-center shrink-0">
          <span className="text-slate-400 text-xs italic">
            * Rate analysis calculated as per CPWD DSR specifications and guidelines.
          </span>
          <div className="text-right font-mono font-bold text-emerald-400 text-base">
            Total AR Rate: ₹5,435.18
          </div>
        </div>

      </div>
    </div>
  );
}