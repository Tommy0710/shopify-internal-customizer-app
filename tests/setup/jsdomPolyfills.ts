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

/**
 * `offsetWidth`/`offsetHeight` của jsdom LUÔN là 0 (không có layout engine
 * thật). Vô hại với phần lớn test — nhưng `Tabs` của Polaris đo bề rộng qua
 * `requestAnimationFrame` (`TabMeasurer`), và với `offsetWidth: 0` nó tính ra
 * `containerWidth` ÂM (`0 - 20 - 28`), kết luận KHÔNG tab nào vừa và gập hết
 * vào "More views" — chỉ tab đang chọn còn hiện riêng. Task 1's
 * `AdminShell.test.tsx` "thoát" được vì assert ngay lập tức, trước khi
 * `requestAnimationFrame` kịp chạy (state đo ban đầu là `Infinity` — mọi tab
 * đều vừa). Task 3 trở đi, tab Attributes tự fetch dữ liệu và test phải
 * `await`/`waitFor` cho vòng fetch đó ổn định TRƯỚC khi bấm tab khác — đủ
 * thời gian cho `requestAnimationFrame` chạy và gập tab, khiến
 * `getByRole("tab", {name:"Products"})` không tìm thấy. Set một `offsetWidth`
 * dương đủ lớn ở đây (một lần, cho mọi test jsdom) để `Tabs` luôn đo ra "vừa
 * đủ chỗ", đúng với thực tế trình duyệt.
 */
if (typeof window !== "undefined") {
  Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 1000,
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 1000,
  });
}
