"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CustomizerApp } from "@/storefront-customizer/CustomizerApp";
import { ArrowLeft, Sparkles, Send, ShoppingBag } from "lucide-react";

export default function StorefrontPreviewPage() {
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);

  const handleSimulateWebhook = async () => {
    try {
      setWebhookStatus("Đang gửi giả lập webhook orders/create...");
      const mockOrder = {
        id: 59281928300 + Math.floor(Math.random() * 1000),
        order_number: 1090 + Math.floor(Math.random() * 50),
        email: "khachhang_bespoke_" + Date.now() + "@gmail.com",
        shipping_address: {
          address1: "72 Nguyen Hue, District 1",
          city: "Ho Chi Minh City",
        },
        line_items: [
          {
            id: 88776655,
            title: "Custom Bespoke Watch Strap (Dây Đồng Hồ Thủ Công)",
            quantity: 1,
            properties: [
              { name: "_custom_design_id", value: "dsg_8rf91" },
              { name: "Leather", value: "Burgundy Shell Cordovan" },
              { name: "Buckle", value: "Brushed 316L Silver" },
            ],
          },
        ],
      };

      const res = await fetch("/api/webhooks/orders-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-shopify-shop-domain": "wildandking-demo.myshopify.com",
        },
        body: JSON.stringify(mockOrder),
      });

      if (res.ok) {
        setWebhookStatus(`✅ Đã gửi Webhook thành công cho Đơn #${mockOrder.order_number}! Đơn hàng mới đã xuất hiện trong 'Hàng chờ Sản xuất'.`);
      }
    } catch (err: any) {
      setWebhookStatus(`❌ Lỗi gửi webhook: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Top Banner Notice */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between text-xs shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1 text-slate-300 hover:text-white font-medium">
            <ArrowLeft size={14} />
            <span>Quay lại Bảng Quản Trị Shopify Admin</span>
          </Link>
          <span className="text-slate-600">|</span>
          <span className="flex items-center gap-1 text-emerald-400 font-semibold">
            <Sparkles size={14} /> Giả Lập Storefront Product Detail (Bespoke Mode)
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSimulateWebhook}
            className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
          >
            <Send size={12} />
            <span>Test Webhook Khách Mua Hàng</span>
          </button>
        </div>
      </header>

      {webhookStatus && (
        <div className="bg-emerald-50 text-emerald-900 text-xs px-6 py-2.5 border-b border-emerald-200 text-center font-semibold">
          {webhookStatus}
        </div>
      )}

      {/* Storefront PDP Layout (Shopify Theme Mockup) */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 md:p-10">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden grid grid-cols-1 md:grid-cols-12 gap-8 p-6 md:p-8">
          {/* Left Column: Product Gallery / Mockup */}
          <div className="md:col-span-5 flex flex-col items-center justify-start space-y-4">
            <div className="w-full aspect-square rounded-xl bg-slate-50 border border-slate-200 overflow-hidden flex items-center justify-center relative">
              <img
                src="https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=800&auto=format&fit=crop&q=80"
                alt="Watch Strap"
                className="w-full h-full object-cover"
              />
            </div>
            <p className="text-[11px] text-slate-400 text-center">
              Ảnh sản phẩm phôi gốc từ Shopify Storefront Media
            </p>
          </div>

          {/* Right Column: Product Info & Mount Point của App Block */}
          <div className="md:col-span-7 space-y-5">
            <div>
              <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">
                Wild & King Bespoke Leather
              </span>
              <h1 className="text-2xl font-bold text-slate-900 mt-1">
                Custom Bespoke Watch Strap (Dây Da Thủ Công)
              </h1>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-xl font-extrabold text-slate-900">$65.00</span>
                <span className="text-xs text-slate-500">
                  (Giá gốc chưa bao gồm phụ phí da quý / khóa vàng)
                </span>
              </div>
            </div>

            {/* 🌟 VỊ TRÍ NHÚNG APP BLOCK (THEME APP EXTENSION MOUNT POINT) 🌟 */}
            <div className="pt-2 border-t border-slate-100">
              <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400 bg-slate-50 px-2 py-1 rounded">
                <span>📍 Shopify Theme App Block: <code>blocks/product-customizer.liquid</code></span>
                <span className="text-emerald-600 font-semibold">Native DOM Render (No Iframe)</span>
              </div>

              {/* React Customizer Component */}
              <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-200">
                <CustomizerApp
                  productId="8129384729101"
                  variantId="44910293810231"
                  shopDomain="wildandking-demo.myshopify.com"
                  proxyUrl="/apps/customizer"
                  blockTitle="🎨 Tùy Chỉnh Thiết Kế (Wild & King Bespoke)"
                  btnText="Thêm vào giỏ hàng với thiết kế này"
                  primaryColor="#008060"
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
