"use client";

import { useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { ShoppingBag, RefreshCw, Layers, Plus, Search, Tag, Eye, Trash2, CheckCircle, Smartphone } from "lucide-react";

export default function ProductsPage() {
  const { user, loading, signOut } = useAuth({ required: true });

  const [searchTerm, setSearchTerm] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Connected");
  const [showAddDrawer, setShowAddDrawer] = useState(false);

  // New product form states
  const [newProduct, setNewProduct] = useState({
    title: "",
    sku: "",
    price: "",
    stock: "In Stock",
    category: "Salon Products",
  });

  // Product lists mock data
  const [products, setProducts] = useState([
    { id: "p1", title: "Premium Argan Hair Oil (100ml)", sku: "AR-OIL-100", price: 35.00, stock: "In Stock", category: "Hair Care" },
    { id: "p2", title: "Professional Hair Styling Wax", sku: "WAX-STYL-80", price: 18.50, stock: "In Stock", category: "Styling" },
    { id: "p3", title: "Hydrating Keratin Shampoo", sku: "SHAMP-KER-250", price: 24.00, stock: "In Stock", category: "Hair Care" },
    { id: "p4", title: "Deep Nourishing Hair Mask", sku: "MASK-NOUR-150", price: 28.00, stock: "Low Stock", category: "Treatments" },
    { id: "p5", title: "Ergonomic Barber Comb Set", sku: "COMB-BARB-SET", price: 12.00, stock: "Out of Stock", category: "Tools" },
  ]);

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading...</div>;

  function syncCatalog() {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      setSyncStatus("Synced");
    }, 1800);
  }

  function handleCreateProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!newProduct.title || !newProduct.price) return;
    const addedProd = {
      id: `p${products.length + 1}`,
      title: newProduct.title,
      sku: newProduct.sku || `SKU-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
      price: parseFloat(newProduct.price),
      stock: newProduct.stock,
      category: newProduct.category,
    };
    setProducts((prev) => [addedProd, ...prev]);
    setNewProduct({ title: "", sku: "", price: "", stock: "In Stock", category: "Salon Products" });
    setShowAddDrawer(false);
  }

  const filteredProducts = products.filter(
    (p) =>
      p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 mb-2 border border-emerald-100">
            WhatsApp Business Catalog Sync
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
            WhatsApp Catalog Manager
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Publish products to Meta Commerce, sync e-commerce catalogs, and deploy products inside chatbot nodes.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={syncCatalog}
            disabled={syncing}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 text-indigo-500 ${syncing ? "animate-spin" : ""}`} />
            <span>{syncing ? "Syncing Catalog..." : "Sync with Meta"}</span>
          </button>

          <button
            onClick={() => setShowAddDrawer(true)}
            className="rounded-lg bg-emerald-500 hover:bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm flex items-center gap-1 transition-all active:scale-95"
          >
            <Plus className="h-4 w-4" />
            <span>Add Product</span>
          </button>
        </div>
      </header>

      {/* Sync Status Cards */}
      <section className="mb-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Commerce Account</div>
          <div className="mt-2 text-lg font-bold text-slate-900">Cutz & Bangs Salon</div>
          <div className="mt-1 text-xs text-slate-500">Meta ID: 89045612301</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sync Connection</div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="text-sm font-bold text-slate-800">{syncStatus}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">Last synchronized: 2 hrs ago</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Catalog Listings</div>
          <div className="mt-2 text-lg font-bold text-slate-900">{products.length} Products published</div>
          <div className="mt-1 text-xs text-slate-500">3 catalog categories mapped</div>
        </div>
      </section>

      {/* Product List Table / Grid */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {/* Search filter banner */}
        <div className="flex gap-2 max-w-sm mb-6">
          <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 w-full focus-within:border-indigo-500 bg-white transition-all">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search products by title, SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full outline-none text-xs"
            />
          </div>
        </div>

        {/* Catalog Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 uppercase text-slate-400 font-bold tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Stock Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/50 cursor-pointer transition-all">
                  <td className="px-4 py-3 font-semibold text-slate-900 flex items-center gap-2.5">
                    <div className="h-10 w-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                      <ShoppingBag className="h-4 w-4 text-slate-400" />
                    </div>
                    <span>{p.title}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600">{p.sku}</td>
                  <td className="px-4 py-3 text-slate-500">
                    <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[10px]">
                      <Tag className="h-3 w-3" />
                      {p.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono font-bold text-slate-900">${p.price.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      p.stock === "In Stock"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                        : p.stock === "Low Stock"
                        ? "bg-amber-50 text-amber-700 border border-amber-100"
                        : "bg-red-50 text-red-700 border border-red-100"
                    }`}>
                      {p.stock}
                    </span>
                  </td>
                  <td className="px-4 py-3 space-x-1">
                    <button className="rounded p-1 hover:bg-slate-100 text-slate-500 hover:text-slate-900 border border-transparent hover:border-slate-200" title="Preview Catalog Card">
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                    No products matching search criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Product Modal Drawer */}
      {showAddDrawer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-md p-4 animate-fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden animate-slide-up">
            <div className="bg-slate-950 text-white p-4 flex justify-between items-center">
              <h3 className="font-bold text-sm">Add Catalog Product</h3>
              <button
                onClick={() => setShowAddDrawer(false)}
                className="text-slate-400 hover:text-white text-xs font-bold"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-600 mb-1">Product Title</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Argan Hair Oil Shampoo"
                  value={newProduct.title}
                  onChange={(e) => setNewProduct((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-600 mb-1">Price (USD)</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    placeholder="25.00"
                    value={newProduct.price}
                    onChange={(e) => setNewProduct((prev) => ({ ...prev, price: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-600 mb-1">SKU Code</label>
                  <input
                    type="text"
                    placeholder="AR-SHAMP-250"
                    value={newProduct.sku}
                    onChange={(e) => setNewProduct((prev) => ({ ...prev, sku: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-600 mb-1">Stock Status</label>
                  <select
                    value={newProduct.stock}
                    onChange={(e) => setNewProduct((prev) => ({ ...prev, stock: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 outline-none focus:border-indigo-500 bg-white"
                  >
                    <option>In Stock</option>
                    <option>Low Stock</option>
                    <option>Out of Stock</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-600 mb-1">Category</label>
                  <select
                    value={newProduct.category}
                    onChange={(e) => setNewProduct((prev) => ({ ...prev, category: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 outline-none focus:border-indigo-500 bg-white"
                  >
                    <option>Salon Products</option>
                    <option>Hair Care</option>
                    <option>Styling</option>
                    <option>Tools</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 transition-all active:scale-95 mt-4"
              >
                Publish to WABA Catalog
              </button>
            </form>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
