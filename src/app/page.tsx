"use client";

import React, { useState, useEffect } from "react";
import AdminProductsPage from "./admin/products/page";
import AdminOrdersPage from "./admin/orders/page";
import { LayoutDashboard, Sliders, PackageCheck, Sparkles, Database, ExternalLink, RefreshCw } from "lucide-react";
import {
  AdminErrorBanner,
  adminFetchErrorMessage,
  adminNetworkErrorMessage,
} from "@/components/AdminErrorBanner";

export default function EmbeddedAdminPage() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "products" | "orders">("dashboard");
  const [stats, setStats] = useState({ productsCount: 0, ordersCount: 0, readyOrders: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = async () => {
    try {
      setLoading(true);
      setError(null);
      const [prodRes, orderRes] = await Promise.all([
        fetch("/api/admin/products"),
        fetch("/api/admin/orders"),
      ]);

      let pCount = 0;
      let oCount = 0;
      let rCount = 0;
      const failures: string[] = [];

      if (prodRes.ok) {
        const prodData = await prodRes.json();
        pCount = prodData.configs?.length || 0;
      } else {
        failures.push(await adminFetchErrorMessage(prodRes, "Không tải được cấu hình sản phẩm"));
      }

      if (orderRes.ok) {
        const orderData = await orderRes.json();
        const designs = orderData.designs || [];
        oCount = designs.length;
        rCount = designs.filter((d: any) => d.status === "READY_FOR_PRODUCTION").length;
      } else {
        failures.push(await adminFetchErrorMessage(orderRes, "Không tải được đơn sản xuất"));
      }

      setStats({ productsCount: pCount, ordersCount: oCount, readyOrders: rCount });
      // Without this the dashboard reports 0 / 0 / 0 for an auth failure, which
      // reads exactly like an empty but healthy shop.
      setError(failures.length > 0 ? `${failures.join(" ")} Các số liệu bên dưới KHÔNG phản ánh dữ liệu thật.` : null);
    } catch (err) {
      console.error("Error loading admin stats:", err);
      setError(adminNetworkErrorMessage(err, "Không tải được số liệu tổng quan"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  return (
    <div className="min-h-screen bg-[#f6f6f7] flex flex-col text-slate-800 font-sans">
      {/* Top Header / Embedded App Bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-bold shadow-md">
            🎨
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900">Wild & King Customizer</h1>
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                Shopify Embedded GUI
              </span>
            </div>
            <p className="text-xs text-slate-500">Quản lý trực tiếp trong Shopify Admin</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("dashboard")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              activeTab === "dashboard"
                ? "bg-white text-emerald-700 shadow-sm font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <LayoutDashboard size={14} />
            <span>Tổng quan</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("products")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              activeTab === "products"
                ? "bg-white text-emerald-700 shadow-sm font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Sliders size={14} />
            <span>Cấu hình Sản phẩm ({stats.productsCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("orders")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              activeTab === "orders"
                ? "bg-white text-emerald-700 shadow-sm font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <PackageCheck size={14} />
            <span>Hàng chờ Sản xuất ({stats.readyOrders})</span>
          </button>

          <a
            href="/storefront-preview"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-emerald-700 hover:bg-emerald-50 transition-colors ml-1"
            title="Mở tab giả lập Storefront"
          >
            <ExternalLink size={13} />
            <span>Xem Giả Lập</span>
          </a>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-4">
        {/* Scoped to the dashboard: the two child tabs render their own. */}
        {activeTab === "dashboard" && <AdminErrorBanner message={error} />}

        {activeTab === "dashboard" && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div
                onClick={() => setActiveTab("products")}
                className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md cursor-pointer transition-shadow flex items-center justify-between"
              >
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Sản phẩm có Customizer</p>
                  <p className="text-3xl font-extrabold text-slate-900 mt-1">{stats.productsCount}</p>
                  <p className="text-[11px] text-emerald-600 mt-1 font-medium">Bấm để quản lý cấu hình &rarr;</p>
                </div>
                <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                  <Sliders size={22} />
                </div>
              </div>

              <div
                onClick={() => setActiveTab("orders")}
                className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md cursor-pointer transition-shadow flex items-center justify-between"
              >
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tổng Thiết Kế Tạo Ra</p>
                  <p className="text-3xl font-extrabold text-blue-600 mt-1">{stats.ordersCount}</p>
                  <p className="text-[11px] text-blue-600 mt-1 font-medium">Xem lịch sử thiết kế &rarr;</p>
                </div>
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                  <LayoutDashboard size={22} />
                </div>
              </div>

              <div
                onClick={() => setActiveTab("orders")}
                className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md cursor-pointer transition-shadow flex items-center justify-between"
              >
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Đơn Chờ Sản Xuất / In</p>
                  <p className="text-3xl font-extrabold text-amber-600 mt-1">{stats.readyOrders}</p>
                  <p className="text-[11px] text-amber-600 mt-1 font-medium">Mở hàng chờ sản xuất &rarr;</p>
                </div>
                <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
                  <PackageCheck size={22} />
                </div>
              </div>
            </div>

            {/* Quick Actions & Supabase Integration Banner */}
            <div className="bg-gradient-to-r from-emerald-800 to-slate-900 text-white rounded-2xl p-6 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Sparkles size={18} className="text-emerald-400" />
                  <span className="font-bold text-sm">Giao diện nhúng trực tiếp Shopify Admin (GUI Native)</span>
                </div>
                <p className="text-xs text-slate-300 max-w-xl">
                  Bạn có thể thêm font chữ nghệ thuật, bảng màu, tải ảnh mockup sản phẩm và duyệt đơn hàng sản xuất ngay tại màn hình này mà không cần mở tab ngoài.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("products")}
                  className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-xs font-bold px-4 py-2.5 rounded-lg transition-colors shadow-sm"
                >
                  + Thêm Sản Phẩm Mới
                </button>
              </div>
            </div>

            {/* Database & System Architecture Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                  <Database size={15} className="text-emerald-600" />
                  <span>Trạng thái Database & Lưu trữ</span>
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-slate-800">Cơ sở dữ liệu: Prisma ORM</div>
                      <div className="text-[11px] text-slate-500">Hỗ trợ SQLite (Local) & Supabase PostgreSQL (Production)</div>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                      Sẵn sàng
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                  <Sparkles size={15} className="text-purple-600" />
                  <span>Kênh giao tiếp Storefront</span>
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-slate-800">Shopify App Proxy Router</div>
                      <div className="text-[11px] text-slate-500 font-mono">/apps/customizer/save-design</div>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold text-[10px]">
                      HMAC SHA256
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "products" && <AdminProductsPage />}
        {activeTab === "orders" && <AdminOrdersPage />}
      </div>
    </div>
  );
}
