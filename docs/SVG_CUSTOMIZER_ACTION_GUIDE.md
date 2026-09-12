# SVG Customizer — Nguyên lý hoạt động và hợp đồng triển khai

## 1. Mục đích

Tài liệu này là nguồn hướng dẫn để developer hoặc coding agent tích hợp một SVG mockup có thể:

- thay artwork riêng cho thân ví;
- thay artwork riêng cho con vật/trang trí, gọi chung là `animal`;
- đổi màu toàn bộ đường chỉ;
- đổi qua lại giữa nhiều mẫu SVG mà vẫn giữ lựa chọn của người dùng.

Nguyên lý cốt lõi:

1. `id` giúp JavaScript tìm đúng layer cần điều khiển.
2. `<image>` chứa artwork do người dùng chọn.
3. `<clipPath>` giới hạn artwork vào đúng hình dạng sản phẩm.
4. CSS custom property đổi màu cả nhóm chỉ trong một lần cập nhật.
5. Thứ tự các node trong SVG quyết định lớp nào nằm trên hoặc dưới.

`id` một mình không thể làm ảnh vừa với thân ví hoặc con vật. Phần cắt theo hình dạng do `clipPath` đảm nhiệm.

## 2. Hợp đồng SVG bắt buộc

Mỗi SVG mockup tương thích phải có đúng một phần tử cho từng ID sau:

| ID | Loại phần tử | Vai trò |
| --- | --- | --- |
| `wallet-preview` | `<svg>` | Root SVG mà app sẽ cập nhật hoặc thay thế |
| `wallet-body-shape` | `<path>` hoặc shape tương đương | Hình học của thân ví |
| `animal-shape` | `<path>` hoặc shape tương đương | Hình học chính của con vật |
| `wallet-body-clip` | `<clipPath>` | Cắt artwork theo thân ví |
| `animal-clip` | `<clipPath>` | Cắt artwork theo con vật |
| `body-artwork` | `<image>` | Đích nhận ảnh cho thân ví |
| `animal-artwork` | `<image>` | Đích nhận ảnh cho con vật |
| `stitches` | `<g>` | Nhóm tất cả đường chỉ đổi màu được |

Tên `animal` là contract kỹ thuật dùng chung cho cá, cá sấu hoặc con vật khác. UI được phép hiển thị tên cụ thể như “Cá” hoặc “Cá sấu” mà không đổi ID kỹ thuật.

Các ID bổ sung như `animal-outline`, `animal-mouth`, `animal-fin`, `wallet-pockets` hoặc từng mũi chỉ được khuyến nghị để dễ bảo trì, nhưng không phải đích mà logic upload bắt buộc phải cập nhật.

> Migration: SVG mẫu cũ đang dùng các ID `fish-shape`, `fish-clip`, `fish-artwork` và `fish-outline`. Khi đưa chúng vào app mới, đổi các ID này sang `animal-shape`, `animal-clip`, `animal-artwork` và `animal-outline`, đồng thời cập nhật mọi `href="#..."` và `url(#...)` liên quan. App mới không duy trì hai bộ ID song song.

## 3. Cấu trúc SVG tối thiểu

```svg
<svg
  id="wallet-preview"
  viewBox="0 0 1427 1102"
  xmlns="http://www.w3.org/2000/svg"
  style="--wallet-stitches: #E7C337"
>
  <defs>
    <path id="wallet-body-shape" d="..." />
    <path id="animal-shape" d="..." />

    <clipPath id="wallet-body-clip">
      <use href="#wallet-body-shape" />
    </clipPath>

    <clipPath id="animal-clip">
      <use href="#animal-shape" />
    </clipPath>
  </defs>

  <use href="#wallet-body-shape" fill="#4E4A35" />

  <image
    id="body-artwork"
    x="0"
    y="0"
    width="1427"
    height="1102"
    clip-path="url(#wallet-body-clip)"
    preserveAspectRatio="xMidYMid slice"
    hidden="hidden"
  />

  <use href="#animal-shape" fill="#F4D20B" />

  <image
    id="animal-artwork"
    x="0"
    y="0"
    width="1427"
    height="1102"
    clip-path="url(#animal-clip)"
    preserveAspectRatio="xMidYMid slice"
    hidden="hidden"
  />

  <g id="animal-outline" pointer-events="none">
    <!-- Viền, mắt, miệng và chi tiết nằm trên artwork -->
  </g>

  <g id="stitches" fill="var(--wallet-stitches)">
    <!-- Các mũi chỉ -->
  </g>
</svg>
```

`preserveAspectRatio="xMidYMid slice"` hoạt động gần giống `object-fit: cover`: giữ tỷ lệ ảnh, căn giữa và cắt phần dư để phủ kín vùng đích. Nếu sản phẩm cần nhìn toàn bộ ảnh và chấp nhận khoảng trống, dùng `xMidYMid meet`.

## 4. Thứ tự layer bắt buộc

SVG vẽ phần tử xuất hiện sau lên trên phần tử xuất hiện trước. Thứ tự đề xuất:

1. Nền/fallback của thân ví.
2. `body-artwork` đã được clip.
3. Texture, highlight và grain của da.
4. Túi ví và artwork được tái sử dụng trong các túi nếu thiết kế cần.
5. Nền/fallback của con vật.
6. `animal-artwork` đã được clip.
7. Viền, mắt, miệng, vây và các chi tiết vector của con vật.
8. Dấu lỗ kim, đường chỉ và hiệu ứng sợi chỉ.

Không đưa viền, mắt hoặc đường chỉ xuống dưới `<image>`, vì artwork sẽ che mất chi tiết nhận dạng của mockup.

## 5. Luồng thay artwork

State tối thiểu:

```ts
type ArtworkTarget = "body" | "animal";

type ArtworkState = Record<ArtworkTarget, {
  previewUrl: string | null;
  fileName: string | null;
  durableUrl?: string | null;
}>;
```

Luồng xử lý:

1. Người dùng chọn file cho `body` hoặc `animal`.
2. Xác nhận file là định dạng ảnh được hỗ trợ.
3. Tạo URL xem trước bằng `URL.createObjectURL(file)`.
4. Tìm đúng `<image>` qua `#body-artwork` hoặc `#animal-artwork`.
5. Gán URL vào thuộc tính `href`.
6. Bỏ `hidden` và đặt `visibility="visible"`.
7. Khi thay hoặc xóa ảnh, gọi `URL.revokeObjectURL()` cho URL cũ.
8. Khi rời trang, giải phóng tất cả Object URL còn lại.

Pseudocode:

```ts
function renderArtwork(target: ArtworkTarget, state: ArtworkState, root: SVGSVGElement) {
  const imageId = target === "body" ? "body-artwork" : "animal-artwork";
  const image = root.querySelector<SVGImageElement>(`#${imageId}`);

  if (!image) throw new Error(`Missing SVG target: ${imageId}`);

  const current = state[target];
  if (current.previewUrl) {
    image.setAttribute("href", current.previewUrl);
    image.removeAttribute("hidden");
    image.setAttribute("visibility", "visible");
  } else {
    image.removeAttribute("href");
    image.setAttribute("hidden", "");
    image.setAttribute("visibility", "hidden");
  }
}
```

Không dùng Object URL làm dữ liệu lưu lâu dài: URL dạng `blob:` chỉ tồn tại trong phiên trình duyệt hiện tại. Khi lưu design hoặc thêm vào giỏ hàng, app phải upload file lên nơi lưu trữ được phép sử dụng và lưu `durableUrl` hoặc asset ID trả về.

Đối với SVG do người dùng upload, phải sanitize trước khi inline vào DOM. Phương án đơn giản và an toàn hơn là chỉ cho PNG, JPEG hoặc WebP làm artwork, hoặc hiển thị SVG upload qua `<image>` sau khi backend đã kiểm tra.

## 6. Luồng đổi màu chỉ

Tất cả phần chỉ cần kế thừa cùng một biến:

```svg
<svg id="wallet-preview" style="--wallet-stitches: #E7C337">
  <g id="stitches" fill="var(--wallet-stitches)">
    ...
  </g>
</svg>
```

JavaScript/TypeScript chỉ cập nhật biến ở root:

```ts
root.style.setProperty("--wallet-stitches", normalizedHex);
```

Chuẩn hóa đầu vào thành mã hex sáu ký tự viết hoa:

- `#abc` thành `#AABBCC`;
- `aabbcc` thành `#AABBCC`;
- giá trị không hợp lệ không được ghi vào SVG;
- reset về màu mặc định của mockup, không bắt buộc mọi mockup dùng cùng một màu.

Các highlight và shadow của sợi chỉ có thể dùng màu cố định với opacity thấp. Chỉ phần màu nền chính của sợi dùng `var(--wallet-stitches)`.

## 7. Hỗ trợ nhiều mockup

Registry tối thiểu:

```ts
interface MockupDefinition {
  id: string;
  name: string;
  sourceUrl: string;
  defaultStitches: string;
}
```

Khi chuyển mockup:

1. Fetch source SVG dưới dạng text.
2. Parse bằng `DOMParser(..., "image/svg+xml")`.
3. Validate contract trước khi gắn vào DOM.
4. Import và thay root SVG hiện tại.
5. Tìm lại reference tới `body-artwork` và `animal-artwork`; reference cũ đã thuộc SVG bị tháo khỏi DOM.
6. Áp lại artwork và màu chỉ đang có.
7. Chỉ kết quả của lần chọn mới nhất được phép cập nhật UI. Kết quả fetch cũ đến trễ phải bị bỏ qua.
8. Nếu tải hoặc validate thất bại, giữ nguyên mockup và state hiện tại.

Nếu người dùng chưa tự chọn màu chỉ, khi đổi mẫu dùng `defaultStitches` của mẫu mới. Nếu họ đã chọn màu riêng, giữ màu đó qua các mẫu.

## 8. Validation trước khi kích hoạt mockup

Không đưa SVG mới vào UI cho tới khi đạt tất cả điều kiện:

- root là phần tử `<svg>` trong namespace `http://www.w3.org/2000/svg`;
- root có `id="wallet-preview"`;
- không có lỗi parse;
- mỗi ID bắt buộc xuất hiện đúng một lần;
- `body-artwork` và `animal-artwork` thực sự là phần tử `<image>`;
- mỗi artwork target tham chiếu đúng `clipPath` tương ứng;
- `#stitches` sử dụng `var(--wallet-stitches)` cho màu chính;
- tất cả `href="#..."` và `url(#...)` trỏ tới ID tồn tại;
- không có script, event handler inline hoặc external resource không được tin cậy.

Ví dụ validation tối thiểu:

```ts
const requiredImageIds = ["body-artwork", "animal-artwork"];

for (const id of requiredImageIds) {
  const matches = svg.querySelectorAll(`#${id}`);
  if (matches.length !== 1 || matches[0].localName !== "image") {
    throw new Error(`Invalid or missing SVG target: ${id}`);
  }
}
```

Trong code production, không nối trực tiếp ID không tin cậy vào CSS selector. Danh sách target phải là allowlist cố định hoặc ID phải được escape bằng `CSS.escape()`.

## 9. Inline SVG và file SVG độc lập

Để JavaScript dùng `querySelector()` và cập nhật trực tiếp các node bên trong, SVG phải nằm inline trong DOM hoặc được fetch rồi parse/import vào DOM.

Nếu chỉ hiển thị bằng:

```html
<img src="wallet.svg" alt="Wallet preview" />
```

JavaScript của trang không thể truy cập `#body-artwork`, `#animal-artwork` hay `#stitches` bên trong file đó. File SVG độc lập vẫn hữu ích làm master asset, nhưng không tự trở thành editor tương tác.

## 10. Tích hợp với app Shopify trong workspace này

Nguồn React cần chỉnh khi triển khai là:

`src/storefront-customizer/CustomizerApp.tsx`

Bundle sau khi build là:

`extensions/product-customizer-block/assets/customizer-bundle.js`

Không sửa bundle sinh ra bằng tay. Chạy script bundle để tạo lại artifact từ source.

Trạng thái hiện tại của app Shopify:

- preview mới đổi `backgroundColor` theo màu da;
- lựa chọn chỉ mới là chuỗi được hiển thị và gửi trong payload;
- `handleImageUpload()` đã đọc file nhưng chưa có input gọi hàm này;
- chưa có inline SVG engine, `clipPath`, `body-artwork` hoặc `animal-artwork` trong component.

Vì vậy, coding agent không được kết luận rằng SVG customizer đã được tích hợp chỉ vì state `selectedStitch` hoặc `uploadedImage` đã tồn tại.

## 11. Trình tự hành động cho coding agent

Khi được yêu cầu tích hợp nguyên lý này vào app, thực hiện theo thứ tự:

1. Đọc tài liệu này và kiểm tra source hiện tại; không sửa file bundle bằng tay.
2. Xác định mockup nào là source of truth và đưa nó vào app theo dạng inline hoặc fetch/parse.
3. Viết validator cho SVG contract.
4. Tạo state riêng cho `body`, `animal` và `stitches`.
5. Kết nối hai input upload với đúng artwork target.
6. Kết nối color picker/select với `--wallet-stitches`.
7. Giữ artwork khi đổi mockup và xử lý request đến trễ.
8. Tách URL preview tạm thời khỏi URL/asset ID dùng để lưu design.
9. Bundle lại theme extension từ source.
10. Chạy kiểm tra tự động, mở storefront preview và xác minh trực quan.

Không tự mở rộng sang chỉnh vị trí, zoom, rotate, crop thủ công hoặc thêm số lượng target động nếu yêu cầu sản phẩm chưa cần các chức năng đó.

## 12. Tiêu chí nghiệm thu

Một implementation chỉ được coi là hoàn thành khi chứng minh được:

- upload ảnh thân ví chỉ thay phần thân ví và không tràn ra ngoài;
- upload ảnh con vật chỉ thay phần con vật và không tràn ra ngoài;
- hai artwork có thể thay/xóa độc lập;
- viền, mắt, miệng và chi tiết vector vẫn hiển thị trên artwork;
- đổi màu chỉ cập nhật toàn bộ mũi chỉ nhưng không đổi artwork hoặc màu da;
- reset trả màu chỉ về mặc định đúng của mockup;
- chuyển mockup vẫn giữ artwork và giữ màu do người dùng tự chọn;
- mockup sai contract bị từ chối mà không phá preview đang hiển thị;
- thay/xóa ảnh và rời trang đều giải phóng Object URL;
- design lưu lâu dài không chứa URL `blob:`;
- bundle Shopify được tạo lại từ source và storefront thực tế hiển thị đúng.

Build hoặc type-check thành công không thay thế cho kiểm tra trực quan clipping và thứ tự layer.

## 13. Những lỗi triển khai thường gặp

- Chỉ gán ID nhưng không dùng `clipPath`, khiến ảnh thành hình chữ nhật phủ toàn canvas.
- Đặt `<image>` sau viền/mắt/chỉ, khiến artwork che các chi tiết vector.
- Dùng một state ảnh cho cả thân ví và con vật.
- Lưu URL `blob:` vào database hoặc cart property.
- Thay root SVG nhưng tiếp tục dùng DOM reference cũ.
- Tải hai mockup liên tiếp và để response cũ đến trễ ghi đè lựa chọn mới.
- Dùng file SVG qua `<img>` rồi cố `querySelector()` vào nội dung bên trong.
- Chấp nhận SVG upload không sanitize.
- Sửa trực tiếp `customizer-bundle.js` thay vì sửa React source và bundle lại.

## 14. Tài liệu tham chiếu cục bộ

Implementation nguyên mẫu đang hoạt động nằm tại workspace bên cạnh:

- `/Users/nguyenvanthien/Desktop/wildandking custom stupid animal/test svg/index.html`
- `/Users/nguyenvanthien/Desktop/wildandking custom stupid animal/test svg/src/app.js`
- `/Users/nguyenvanthien/Desktop/wildandking custom stupid animal/test svg/src/artwork.js`
- `/Users/nguyenvanthien/Desktop/wildandking custom stupid animal/test svg/src/stitches-color.js`

Các file này là reference implementation. Khi tích hợp vào Shopify, phải chuyển nguyên lý sang React state/lifecycle và quy trình lưu asset bền vững của app, không sao chép mù quáng DOM code của bản demo.
