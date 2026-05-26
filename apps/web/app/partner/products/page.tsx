"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";

interface ProductItem {
  id: string;
  name: string;
  category: "Template" | "Flow" | "Service";
  status: "DRAFT" | "READY" | "DISTRIBUTED";
  details: string;
  clientsInstalled: number;
}

export default function ProductManagerPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "Template" | "Flow" | "Service">("all");
  
  // Custom creator states
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState<"Template" | "Flow" | "Service">("Template");
  const [newDetails, setNewDetails] = useState("");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("nexaflow_products");
    if (stored) {
      try {
        setProducts(JSON.parse(stored));
      } catch (e) {}
    } else {
      const initialProducts: ProductItem[] = [
        { id: "PROD-101", name: "Appointment Booking flow template", category: "Flow", status: "READY", details: "Visual chatbot drag-drop block for salon and spa bookings.", clientsInstalled: 0 },
        { id: "PROD-102", name: "WhatsApp appointment reminder template", category: "Template", status: "DISTRIBUTED", details: "Meta-approved reminder template containing name & booking slots.", clientsInstalled: 12 },
        { id: "PROD-103", name: "Haircut & Styling standard config", category: "Service", status: "READY", details: "Pre-configured service bundle: 45 min duration, ₹500 price.", clientsInstalled: 0 },
        { id: "PROD-104", name: "Win-back low balance alert flow", category: "Flow", status: "READY", details: "Autopilot marketing campaign targeting churn risk contacts.", clientsInstalled: 2 },
      ];
      setProducts(initialProducts);
      localStorage.setItem("nexaflow_products", JSON.stringify(initialProducts));
    }
  }, []);

  const saveProducts = (updated: ProductItem[]) => {
    setProducts(updated);
    localStorage.setItem("nexaflow_products", JSON.stringify(updated));
  };

  const handleAddProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;

    const newItem: ProductItem = {
      id: `PROD-${Math.floor(100 + Math.random() * 900)}`,
      name: newName,
      category: newCat,
      status: "READY",
      details: newDetails || "No additional configuration instructions provided.",
      clientsInstalled: 0
    };

    const updated = [...products, newItem];
    saveProducts(updated);
    setNewName("");
    setNewDetails("");
    setShowForm(false);
    alert("New product asset template added to reseller library!");
  };

  // Simulating One-click distribution
  const handleDistribute = (id: string) => {
    const updated = products.map((p) => {
      if (p.id === id) {
        return {
          ...p,
          status: "DISTRIBUTED" as const,
          clientsInstalled: 12 // Distributed to all 12 agency clients
        };
      }
      return p;
    });

    saveProducts(updated);
    alert("Product reselling asset injected instantly into all client workspaces!");
  };

  if (loading || !user) {
    return <div className="p-10 text-center text-sm text-slate-500">Loading Product Catalog…</div>;
  }

  const filtered = activeTab === "all" ? products : products.filter((p) => p.category === activeTab);

  return (
    <PartnerShell user={user} signOut={signOut}>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Product & Flow Catalog</h1>
          <p className="text-sm text-slate-400">
            Design WhatsApp templates, visuals chatbots, and salon services, then distribute them to your client dashboards.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-indigo-500 transition-all duration-300"
        >
          {showForm ? "Close Form" : "+ Create Product Template"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAddProduct} className="mb-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-md space-y-4">
          <h2 className="text-sm font-bold text-white">Create Reseller Template Asset</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-slate-400">
              Asset Name
              <input
                required
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Laser Hair Consultation Slot"
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-slate-400">
              Asset Category
              <select
                value={newCat}
                onChange={(e) => setNewCat(e.target.value as any)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none"
              >
                <option value="Template">WhatsApp Meta Approved Template</option>
                <option value="Flow">Visual Chatbot Node Flow</option>
                <option value="Service">Preconfigured Salon/Spa Service Bundle</option>
              </select>
            </label>
          </div>
          <label className="block text-xs text-slate-400">
            Details & Meta Content Description
            <textarea
              value={newDetails}
              onChange={(e) => setNewDetails(e.target.value)}
              placeholder="Provide payload templates or parameters config."
              className="mt-1 h-20 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-emerald-600 px-4 py-1.5 text-xs text-white hover:bg-emerald-500 font-semibold"
          >
            Add Asset Template
          </button>
        </form>
      )}

      {/* Tabs list */}
      <div className="mb-6 flex gap-2 border-b border-slate-800 pb-3">
        {(["all", "Template", "Flow", "Service"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-all duration-300 ${
              activeTab === tab
                ? "bg-indigo-600 text-white shadow shadow-indigo-600/35"
                : "text-slate-400 hover:bg-slate-800/40 hover:text-white"
            }`}
          >
            {tab === "all" ? "All Products" : tab === "Template" ? "WhatsApp Templates" : tab === "Flow" ? "Chatbot Flows" : "Services Bundle"}
          </button>
        ))}
      </div>

      {/* Product List Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((p) => (
          <div key={p.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-md flex flex-col justify-between hover:border-slate-700 transition-all duration-300">
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-[10px] font-mono text-slate-500 font-bold">{p.id}</span>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold border ${
                  p.category === "Template"
                    ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                    : p.category === "Flow"
                    ? "text-indigo-400 bg-indigo-500/10 border-indigo-500/20"
                    : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                }`}>
                  {p.category}
                </span>
              </div>
              <h3 className="font-bold text-sm text-slate-100 mb-1">{p.name}</h3>
              <p className="text-xs text-slate-400 mb-4">{p.details}</p>
            </div>

            <div className="flex items-center justify-between border-t border-slate-800/60 pt-3">
              <span className="text-[10px] text-slate-500">
                {p.status === "DISTRIBUTED" ? `✓ Distributed to ${p.clientsInstalled} workspaces` : "Awaiting distribution"}
              </span>
              
              {p.status === "DISTRIBUTED" ? (
                <button
                  disabled
                  className="rounded bg-slate-800 px-3 py-1.5 text-xs text-slate-500 cursor-not-allowed"
                >
                  Distributed
                </button>
              ) : (
                <button
                  onClick={() => handleDistribute(p.id)}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 shadow-md transition-all duration-300"
                >
                  Distribute to clients
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </PartnerShell>
  );
}
