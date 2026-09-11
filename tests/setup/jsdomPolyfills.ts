/**
 * jsdom thiếu vài API trình duyệt mà Polaris dùng ngay lúc mount (`matchMedia`
 * cho breakpoint, `ResizeObserver` cho Popover/Tabs). File này chỉ polyfill
 * khi `window` tồn tại — vô hại với test chạy ở environment "node" mặc định
 * của repo (`vitest.config.ts` không đổi `environment` toàn cục, mỗi file
 * jsdom tự khai bằng docblock `@vitest-environment jsdom`).
 */
if (typeof window !== "undefined" && typeof window.ResizeObserver !== "function") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver;
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
