"use client";

import React, { useState, useEffect } from "react";
import { Plus, Check, Trash2, Edit3, Image, Type, Palette, DollarSign, Save, Sparkles, Layers } from "lucide-react";
import {
  AdminErrorBanner,
  adminFetchErrorMessage,
  adminNetworkErrorMessage,
} from "@/components/AdminErrorBanner";

interface OptionValue {
  id?: string;
  name: string;
  code: string;
  colorHex?: string;
  extraPrice: number;
}

interface OptionGroup {
  id?: string;
  name: string;
  type: string;
  values: OptionValue[];
}

interface ProductConfig {
  id?: string;
  shopifyProductId: string;
  productTitle: string;
  basePrice: number;
  baseMockupUrl?: string;
  isEnabled: boolean;
  optionGroups?: OptionGroup[];
}

export default function AdminProductsPage() {
  const [configs, setConfigs] = useState<ProductConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [productId, setProductId] = useState("8129384729101");
  const [productTitle, setProductTitle] = useState("Custom Bespoke Watch Strap (Dây Đồng Hồ Thủ Công)");
  const [basePrice, setBasePrice] = useState("65.00");
  const [mockupUrl, setMockupUrl] = useState("https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=800&auto=format&fit=crop&q=80");
  const [isEnabled, setIsEnabled] = useState(true);

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/products");
      if (res.ok) {
        const data = await res.json();
        setConfigs(data.configs || []);
      } else {
        // An empty table must never stand in for an auth failure.
        setError(await adminFetchErrorMessage(res, "Không tải được danh sách cấu hình"));
      }
    } catch (err) {
      console.error("Error fetching configs:", err);
      setError(adminNetworkErrorMessage(err, "Không tải được danh sách cấu hình"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || !productTitle) {
      alert("Vui lòng nhập Shopify Product ID và Tên sản phẩm");
      return;
    }

    try {
      setSaving(true);
      setMessage(null);
      setError(null);
      const payload = {
        shopifyProductId: productId,
        productTitle,
        basePrice: parseFloat(basePrice) || 0,
        baseMockupUrl: mockupUrl || undefined,
        isEnabled,
      };

      const res = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setMessage("✅ Đã lưu cấu hình sản phẩm và quy tắc tùy chỉnh thành công!");
        fetchConfigs();
      } else {
        setError(await adminFetchErrorMessage(res, "Không lưu được cấu hình sản phẩm"));
      }
    } catch (err) {
      console.error("Error saving product config:", err);
      setError(adminNetworkErrorMessage(err, "Không lưu được cấu hình sản phẩm"));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (c: ProductConfig) => {
    setProductId(c.shopifyProductId);
    setProductTitle(c.productTitle);
    setBasePrice(String(c.basePrice || 0));
    setMockupUrl(c.baseMockupUrl || "");
    setIsEnabled(c.isEnabled);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Quản Lý Cấu Hình Sản Phẩm Customizer</h1>
        <p className="text-xs text-slate-500 mt-1">
          Thiết lập các nhóm tùy chọn (Chất liệu da, Kiểu khóa, Size, Khắc laser) và giá gốc cho sản phẩm Shopify
        </p>
      </div>

      <AdminErrorBanner message={error} />

      {message && (
        <div className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded-lg border border-emerald-200 font-medium">
          {message}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSave} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
        <h2 className="text-sm font-bold text-slate-900 pb-3 border-b border-slate-100 flex items-center gap-2">
          <Edit3 size={15} className="text-emerald-600" />
          <span>Thông Tin Sản Phẩm & Quy Tắc Giá</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Shopify Product ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full text-xs p-2.5 border border-slate-300 rounded-lg outline-none focus:border-emerald-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Tên Sản phẩm <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={productTitle}
              onChange={(e) => setProductTitle(e.target.value)}
              className="w-full text-xs p-2.5 border border-slate-300 rounded-lg outline-none focus:border-emerald-600"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Giá Gốc Sản Phẩm ($)
            </label>
            <input
              type="number"
              step="0.01"
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              className="w-full text-xs p-2.5 border border-slate-300 rounded-lg outline-none focus:border-emerald-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              URL Ảnh Phôi Mockup Mẫu
            </label>
            <input
              type="url"
              value={mockupUrl}
              onChange={(e) => setMockupUrl(e.target.value)}
              className="w-full text-xs p-2.5 border border-slate-300 rounded-lg outline-none focus:border-emerald-600"
            />
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="w-4 h-4 text-emerald-600 rounded"
            />
            <span>Kích hoạt Customizer cho sản phẩm này</span>
          </label>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors"
          >
            <Save size={14} />
            <span>{saving ? "Đang lưu..." : "Lưu Cấu Hình"}</span>
          </button>
        </div>
      </form>

      {/* Configured Products List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">Sản phẩm đã cấu hình Customizer ({configs.length})</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Đang tải danh sách...</div>
        ) : configs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Chưa có sản phẩm nào được cấu hình.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 text-xs">
            {configs.map((c) => (
              <div key={c.id || c.shopifyProductId} className="p-4 flex items-center justify-between hover:bg-slate-50">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{c.productTitle}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        c.isEnabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {c.isEnabled ? "Kích hoạt" : "Tạm ẩn"}
                    </span>
                  </div>
                  <div className="text-slate-500 flex gap-4">
                    <span>Product ID: {c.shopifyProductId}</span>
                    <span>Giá gốc: ${c.basePrice}</span>
                    <span>Số nhóm tùy chọn: {c.optionGroups?.length || 0}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleEdit(c)}
                  className="px-3 py-1.5 border border-slate-200 hover:border-emerald-600 hover:text-emerald-600 rounded-md font-medium text-slate-700 transition-colors"
                >
                  Sửa
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
