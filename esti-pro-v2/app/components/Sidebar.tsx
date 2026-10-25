import React from "react";

export default function Sidebar({ activeTab, setActiveTab }: any) {
  const menuItems = [
    { id: "home", label: "Project Settings", icon: "⚙️" },
    { id: "database", label: "Database Explorer", icon: "🗄️" },
    { id: "measurement", label: "Measurement Sheet", icon: "📏" },
    { id: "abstract", label: "General Abstract", icon: "📊" },
    { id: "justification", label: "Justification Report", icon: "📝" },
    { id: "nsr", label: "Create NSR Item", icon: "➕" }
  ];

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-full shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-slate-800">
        <h1 className="text-xl font-bold text-blue-500 font-mono tracking-wider">eSTi-Pro <span className="text-slate-100 text-sm">v2</span></h1>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
              activeTab === item.id 
                ? "bg-blue-600 text-white shadow-md border border-blue-500" 
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-transparent"
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}