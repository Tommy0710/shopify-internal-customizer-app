"use client";

import { useCallback, useState } from "react";
import { Banner, BlockStack, DropZone, InlineStack, List, Spinner, Text, Thumbnail } from "@shopify/polaris";
import { AdminApiError, adminFetch } from "@/lib/admin-ui/adminFetch";
import type { AdminUploadKind, AssetDto } from "@/lib/admin/assets";
import type { ValidationReport } from "@/svg-engine";

/**
 * Upload đi qua `POST /api/admin/assets` — multipart, KHÔNG qua
 * `useAdminMutation` (hook đó luôn `JSON.stringify` body; ở đây body phải là
 * `FormData` để giữ header `multipart/form-data` đúng boundary do `fetch` tự
 * dựng). Vẫn đi qua `adminFetch` — một parser lỗi duy nhất, per Global
 * Constraints — không tự `res.json()` ở đây.
 *
 * Hai hình lỗi 422 khác hẳn nhau tuỳ `kind` (đọc `src/lib/admin/assets.ts`):
 *  - `SVG_MOCKUP`: `svg_contract` kèm `validation` (ValidationReport đầy đủ,
 *    từng check một id), `embedded_resource` kèm `embeddedRefs`,
 *    `external_reference` kèm `externalRefs`. Cả ba đọc từ `AdminApiError
 *    .details` — `fieldErrors` (từ Task 1) chỉ có `{field,code,message}`,
 *    không đủ chỗ chứa `validation.checks`.
 *  - `TEXTURE`/`DISPLAY`: chỉ `invalid_image`, không có `validation`/
 *    `sanitization` — banner chỉ hiện `message` chung, KHÔNG render UI báo
 *    cáo SVG dù `details` tình cờ có field nào đó tên giống.
 */

interface UploadSuccessBody {
  asset: AssetDto;
  created: boolean;
  validation?: ValidationReport;
}

function svgValidationFromDetails(details: Record<string, unknown> | null): ValidationReport | null {
  const validation = details?.validation;
  if (!validation || typeof validation !== "object") return null;
  return validation as ValidationReport;
}

function embeddedRefsFromDetails(details: Record<string, unknown> | null): string[] | null {
  const refs = details?.embeddedRefs;
  return Array.isArray(refs) ? (refs as string[]) : null;
}

function externalRefsFromDetails(details: Record<string, unknown> | null): string[] | null {
  const refs = details?.externalRefs;
  return Array.isArray(refs) ? (refs as string[]) : null;
}

function SvgValidationChecks({ validation }: { validation: ValidationReport }) {
  return (
    <BlockStack gap="100">
      <Text as="p" fontWeight="semibold">
        Kiểm hợp đồng SVG ({validation.contractVersion})
      </Text>
      <List type="bullet">
        {validation.checks.map((check) => (
          <List.Item key={check.id}>
            {check.id}: {check.status}
            {check.hint ? ` — ${check.hint}` : ""}
          </List.Item>
        ))}
      </List>
    </BlockStack>
  );
}

function RefsList({ title, refs }: { title: string; refs: string[] }) {
  return (
    <BlockStack gap="100">
      <Text as="p" fontWeight="semibold">
        {title}
      </Text>
      <List type="bullet">
        {refs.map((ref) => (
          <List.Item key={ref}>{ref}</List.Item>
        ))}
      </List>
    </BlockStack>
  );
}

export interface AssetUploadFieldProps {
  kind: AdminUploadKind;
  value: AssetDto | null;
  onChange: (asset: AssetDto) => void;
  label?: string;
  disabled?: boolean;
}

export function AssetUploadField({ kind, value, onChange, label, disabled }: AssetUploadFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<AdminApiError | null>(null);

  const handleDrop = useCallback(
    async (_files: File[], acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setUploading(true);
      setError(null);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", kind);

      try {
        const result = await adminFetch<UploadSuccessBody>("/api/admin/assets", {
          method: "POST",
          body: formData,
        });
        onChange(result.asset);
      } catch (err) {
        setError(
          err instanceof AdminApiError ? err : new AdminApiError(0, null, null, err instanceof Error ? err.message : String(err)),
        );
      } finally {
        setUploading(false);
      }
    },
    [kind, onChange],
  );

  const isSvgKind = kind === "SVG_MOCKUP";
  const details = error?.details ?? null;
  const validation = isSvgKind ? svgValidationFromDetails(details) : null;
  const embeddedRefs = isSvgKind ? embeddedRefsFromDetails(details) : null;
  const externalRefs = isSvgKind ? externalRefsFromDetails(details) : null;
  const errorMessage = error ? (error.fieldErrors?.[0]?.message ?? error.message) : null;

  return (
    <BlockStack gap="200">
      <DropZone label={label ?? "Tệp"} onDrop={handleDrop} disabled={disabled || uploading} allowMultiple={false}>
        {value ? (
          <InlineStack gap="200" blockAlign="center">
            <Thumbnail source={value.publicUrl} alt={value.originalFilename} />
            <Text as="span" variant="bodySm">
              {value.originalFilename}
            </Text>
          </InlineStack>
        ) : uploading ? (
          <InlineStack gap="200" blockAlign="center">
            <Spinner size="small" accessibilityLabel="Đang tải lên" />
            <Text as="span" variant="bodySm">
              Đang tải lên…
            </Text>
          </InlineStack>
        ) : (
          <DropZone.FileUpload />
        )}
      </DropZone>

      {errorMessage && (
        <Banner tone="critical" title="Tải lên thất bại">
          <BlockStack gap="200">
            <Text as="p">{errorMessage}</Text>
            {validation && <SvgValidationChecks validation={validation} />}
            {embeddedRefs && embeddedRefs.length > 0 && (
              <RefsList title="Tài nguyên data: URI bị từ chối" refs={embeddedRefs} />
            )}
            {externalRefs && externalRefs.length > 0 && (
              <RefsList title="Tài nguyên ngoài bị từ chối" refs={externalRefs} />
            )}
          </BlockStack>
        </Banner>
      )}
    </BlockStack>
  );
}
