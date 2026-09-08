"use client";

import React, { useState, useEffect } from "react";
import { Package, RefreshCw, CheckCircle, Clock, ExternalLink, Sparkles, Layers } from "lucide-react";
import {
  AdminErrorBanner,
  adminFetchErrorMessage,
  adminNetworkErrorMessage,
} from "@/components/AdminErrorBanner";

interface ProductionJob {
  id: string;
  designId: string;
  shopifyOrderId: string;
  shopifyOrderNumber: string;
  customerEmail?: string;
  shippingAddress?: string;
  status: "NEW" | "IN_PRODUCTION" | "QC" | "SHIPPED";
  notes?: string;
  createdAt: string;
  design: {
    id: string;
    productId: string;
    variantId?: string;
    engravingText?: string;
    engravingFont?: string;
    previewUrl?: string;
    totalExtraPrice: number;
    selections: Array<{
      groupName: string;
      valueName: string;
      extraPrice: number;
    }>;
  };
}

const STATUS_MAP = {
  NEW: { label: "Mới tạo / Chờ duyệt", bg: "bg-blue-100", text: "text-blue-800" },
  IN_PRODUCTION: { label: "Đang chế tác / Khắc da", bg: "bg-amber-100", text: "text-amber-800" },
  QC: { label: "Kiểm tra chất lượng (QC)", bg: "bg-purple-100", text: "text-purple-800" },
  SHIPPED: { label: "Đã xuất xưởng / Đóng gói", bg: "bg-emerald-100", text: "text-emerald-800" },
};

export default function AdminOrdersPage() {
  const [jobs, setJobs] = useState<ProductionJob[]>([]);
  const [draftDesigns, setDraftDesigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<string>("ALL");
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      setError(null);
      const url = selectedFilter === "ALL" ? "/api/admin/orders" : `/api/admin/orders?status=${selectedFilter}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
        setDraftDesigns(data.draftDesigns || []);
      } else {
        // An empty queue must never stand in for an auth failure.
        setError(await adminFetchErrorMessage(res, "Không tải được hàng chờ sản xuất"));
      }
    } catch (err) {
      console.error("Error fetching jobs:", err);
      setError(adminNetworkErrorMessage(err, "Không tải được hàng chờ sản xuất"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [selectedFilter]);

  const updateStatus = async (jobId: string, newStatus: string) => {
    try {
      setError(null);
      const res = await fetch("/api/admin/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, status: newStatus }),
      });
      if (res.ok) {
        setJobs(jobs.map((j) => (j.id === jobId ? { ...j, status: newStatus as any } : j)));
      } else {
        // Otherwise the button appears to do nothing at all.
        setError(await adminFetchErrorMessage(res, "Không đổi được trạng thái đơn"));
      }
    } catch (err) {
      console.error("Error updating status:", err);
      setError(adminNetworkErrorMessage(err, "Không đổi được trạng thái đơn"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Hàng Chờ Sản Xuất Thủ Công (Production Jobs)</h1>
          <p className="text-xs text-slate-500 mt-1">
            Theo dõi chi tiết chất liệu da, kiểu khóa, màu chỉ và nội dung khắc laser cho từng đơn hàng
          </p>
        </div>
        <button
          type="button"
          onClick={fetchJobs}
          className="inline-flex items-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg shadow-sm transition-colors"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          <span>Làm mới danh sách</span>
        </button>
      </div>

      <AdminErrorBanner message={error} />

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-2 text-xs">
        {["ALL", "NEW", "IN_PRODUCTION", "QC", "SHIPPED"].map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setSelectedFilter(st)}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
              selectedFilter === st ? "bg-emerald-600 text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {st === "ALL" ? "Tất cả đơn" : STATUS_MAP[st as keyof typeof STATUS_MAP]?.label || st}
          </button>
        ))}
      </div>

      {/* Jobs List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Đang tải danh sách đơn sản xuất...</div>
        ) : jobs.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <Package size={32} className="mx-auto text-slate-300" />
            <p className="text-xs">Chưa có đơn hàng nào trong mục này.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 text-xs">
            {jobs.map((job) => {
              const statusInfo = STATUS_MAP[job.status] || {
                label: job.status,
                bg: "bg-slate-100",
                text: "text-slate-700",
              };
              return (
                <div key={job.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-6 hover:bg-slate-50">
                  <div className="space-y-3 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-base text-slate-900">
                        Order #{job.shopifyOrderNumber}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${statusInfo.bg} ${statusInfo.text}`}>
                        {statusInfo.label}
                      </span>
                      <span className="text-[11px] text-slate-400">Design ID: {job.designId}</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-600 text-[11px]">
                      <div>
                        <span className="text-slate-400">Email: </span>
                        <span className="font-medium text-slate-800">{job.customerEmail || "N/A"}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Địa chỉ giao: </span>
                        <span>{job.shippingAddress || "Xem chi tiết trong Shopify Order"}</span>
                      </div>
                    </div>

                    {/* Bespoke Selections Box */}
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                      <div className="font-bold text-slate-800 flex items-center gap-1.5">
                        <Sparkles size={13} className="text-emerald-600" />
                        <span>Bản Thiết Kế Da Thủ Công (Bespoke Specs):</span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {job.design.selections.map((sel, idx) => (
                          <div key={idx} className="bg-white p-2 rounded border border-slate-100">
                            <div className="text-[10px] text-slate-400">{sel.groupName}</div>
                            <div className="font-semibold text-slate-800">{sel.valueName}</div>
                          </div>
                        ))}
                      </div>

                      {job.design.engravingText && (
                        <div className="pt-1 text-slate-800">
                          <span className="text-slate-500">Khắc Laser: </span>
                          <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                            &ldquo;{job.design.engravingText}&rdquo; ({job.design.engravingFont || "Standard"})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions & Status Changer */}
                  <div className="flex flex-col gap-2 shrink-0 sm:min-w-[170px] bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <label className="text-[11px] font-semibold text-slate-600">Trạng thái Xưởng:</label>
                    <select
                      value={job.status}
                      onChange={(e) => updateStatus(job.id, e.target.value)}
                      className="text-xs p-2 border border-slate-300 rounded-lg outline-none bg-white font-semibold text-slate-800"
                    >
                      <option value="NEW">Mới tạo (Chờ duyệt)</option>
                      <option value="IN_PRODUCTION">Đang chế tác / Khắc da</option>
                      <option value="QC">Kiểm tra QC</option>
                      <option value="SHIPPED">Đã hoàn tất & Giao</option>
                    </select>

                    <div className="text-[10px] text-slate-400 text-center pt-1">
                      Cập nhật trực tiếp vào hệ thống xưởng
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
