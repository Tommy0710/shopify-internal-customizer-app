import { describe, expect, it } from "vitest";
import {
  createDesignRequestSchema,
  createDesignResponseSchema,
  designErrorCodeSchema,
  DESIGN_ERROR_CODES,
} from "@/shared/designRequest";

function validRequest() {
  return {
    productId: "7891234567890",
    styleId: "sty_01",
    bodyLeatherId: "lth_01",
    animalId: "ani_01",
    animalLeatherId: "lth_02",
    stitchId: "st_01",
    idempotencyKey: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  };
}

// designId/shareToken hợp lệ theo định dạng của @/shared/ids (Task 4):
// cd_ + 21 ký tự thân, và 22 ký tự cho shareToken.
const VALID_DESIGN_ID = "cd_7hK9mQwErTyUiOpAsDfXY";
const VALID_SHARE_TOKEN = "A".repeat(22);

function validLine(role: "main" | "addon") {
  return {
    variantId: "44928374652",
    quantity: 1,
    properties: { _wk_role: role },
  };
}

function validResponse() {
  return {
    designId: VALID_DESIGN_ID,
    shareToken: VALID_SHARE_TOKEN,
    previewUrl: "https://cdn.example.com/preview/abc.png",
    lines: [validLine("main"), validLine("addon")],
    summary: { bodyPrice: 49, animalPrice: 12, total: 61 },
  };
}

describe("createDesignRequestSchema", () => {
  it("parse thành công request đủ sáu trường + idempotencyKey", () => {
    const result = createDesignRequestSchema.safeParse(validRequest());
    expect(result.success).toBe(true);
  });

  it.each([
    "productId",
    "styleId",
    "bodyLeatherId",
    "animalId",
    "animalLeatherId",
    "stitchId",
    "idempotencyKey",
  ])("thiếu trường %s → fail, path chỉ đúng tên trường đó", (missingField) => {
    const request = validRequest() as Record<string, unknown>;
    delete request[missingField];

    const result = createDesignRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain(missingField);
      // Không lẫn issue về trường khác — mỗi issue path phải là tên trường hợp lệ.
      for (const issue of result.error.issues) {
        expect(issue.path).toEqual([missingField]);
      }
    }
  });

  it("idempotencyKey phải là uuid v4", () => {
    expect(createDesignRequestSchema.safeParse(validRequest()).success).toBe(true);

    const notUuid = { ...validRequest(), idempotencyKey: "not-a-uuid" };
    expect(createDesignRequestSchema.safeParse(notUuid).success).toBe(false);

    // uuid v1 hợp lệ về hình dạng chung nhưng sai version nibble (bắt đầu
    // bằng "1" thay vì "4" ở nhóm thứ ba) → phải bị từ chối.
    const uuidV1 = { ...validRequest(), idempotencyKey: "3fa85f64-5717-1562-b3fc-2c963f66afa6" };
    expect(createDesignRequestSchema.safeParse(uuidV1).success).toBe(false);
  });
});

describe("createDesignResponseSchema", () => {
  it("parse thành công response 201 đúng ví dụ spec §8.2", () => {
    const result = createDesignResponseSchema.safeParse(validResponse());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lines).toHaveLength(2);
      // Type suy ra phải là tuple [Line, Line] — truy cập [1] không cần kiểm undefined.
      expect(result.data.lines[1].properties._wk_role).toBe("addon");
    }
  });

  it("designId parse qua đúng designIdSchema — id sai định dạng bị từ chối", () => {
    const response = { ...validResponse(), designId: "not-a-valid-design-id" };
    expect(createDesignResponseSchema.safeParse(response).success).toBe(false);
  });

  it("shareToken parse qua đúng shareTokenSchema — token sai độ dài bị từ chối", () => {
    const response = { ...validResponse(), shareToken: "too-short" };
    expect(createDesignResponseSchema.safeParse(response).success).toBe(false);
  });

  it("lines một phần tử → fail — mô hình hai dòng cart là bất biến của spec §4.2", () => {
    const response = { ...validResponse(), lines: [validLine("main")] };
    expect(createDesignResponseSchema.safeParse(response).success).toBe(false);
  });

  it("lines ba phần tử → fail — đúng hai, không hơn", () => {
    const response = { ...validResponse(), lines: [validLine("main"), validLine("addon"), validLine("addon")] };
    expect(createDesignResponseSchema.safeParse(response).success).toBe(false);
  });

  it("summary.total phải bằng bodyPrice + animalPrice", () => {
    const mismatched = { ...validResponse(), summary: { bodyPrice: 49, animalPrice: 12, total: 100 } };
    expect(createDesignResponseSchema.safeParse(mismatched).success).toBe(false);
  });

  it("so sánh summary bằng cent nguyên — 0.1 + 0.2 phải khớp dù cộng float trực tiếp sẽ sai (0.30000000000000004)", () => {
    // Đây là trường hợp mà `total === bodyPrice + animalPrice` so sánh float
    // trực tiếp sẽ SAI (0.1 + 0.2 !== 0.3 trong IEEE754), nhưng đúng về mặt
    // tiền tệ. Quy đổi ra cent nguyên trước khi so sánh phải cho kết quả đúng.
    const response = { ...validResponse(), summary: { bodyPrice: 0.1, animalPrice: 0.2, total: 0.3 } };
    expect(createDesignResponseSchema.safeParse(response).success).toBe(true);
  });
});

describe("DESIGN_ERROR_CODES / designErrorCodeSchema", () => {
  it("danh sách mã lỗi khớp đúng bằng sáu mã spec §8.2 liệt kê — không thiếu, không thừa", () => {
    const expected = new Set([
      "NOT_AVAILABLE",
      "NOT_IN_PRODUCT",
      "MISSING_SVG",
      "VARIANT_MISSING",
      "VARIANT_UNAVAILABLE",
      "INVALID_COMBINATION",
    ]);
    expect(new Set(DESIGN_ERROR_CODES)).toEqual(expected);
    expect(DESIGN_ERROR_CODES.length).toBe(6);
  });

  it.each(DESIGN_ERROR_CODES)("mã lỗi %s parse được", (code) => {
    expect(designErrorCodeSchema.safeParse(code).success).toBe(true);
  });

  it("mã lỗi bịa ra không parse được", () => {
    expect(designErrorCodeSchema.safeParse("SOME_MADE_UP_CODE").success).toBe(false);
  });
});
