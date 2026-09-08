import { describe, expect, it } from "vitest";
import { validateSvgContract } from "@/svg-engine/validate";
import { parseSvg } from "../helpers/svgDom";

function build(options: {
  rootId?: string;
  omit?: string[];
  duplicate?: string;
  bodyArtworkAs?: string;
  stitchesFill?: string;
  viewBox?: string;
} = {}): string {
  const omit = new Set(options.omit ?? []);
  const bodyArtworkTag = options.bodyArtworkAs ?? "image";
  const parts: string[] = [];

  if (!omit.has("wallet-body-shape")) parts.push(`<path id="wallet-body-shape" d="M0 0h10v10H0z"/>`);
  if (!omit.has("animal-shape")) parts.push(`<path id="animal-shape" d="M2 2h4v4H2z"/>`);
  if (!omit.has("wallet-body-clip")) parts.push(`<clipPath id="wallet-body-clip"><use href="#wallet-body-shape"/></clipPath>`);
  if (!omit.has("animal-clip")) parts.push(`<clipPath id="animal-clip"><use href="#animal-shape"/></clipPath>`);
  if (!omit.has("body-artwork")) parts.push(`<${bodyArtworkTag} id="body-artwork" clip-path="url(#wallet-body-clip)"/>`);
  if (!omit.has("animal-artwork")) parts.push(`<image id="animal-artwork" clip-path="url(#animal-clip)"/>`);
  if (!omit.has("stitches")) parts.push(`<g id="stitches" fill="${options.stitchesFill ?? "var(--wallet-stitches)"}"></g>`);
  if (options.duplicate) parts.push(`<g id="${options.duplicate}"></g>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" id="${options.rootId ?? "wallet-preview"}" viewBox="${options.viewBox ?? "0 0 1427 1102"}">${parts.join("")}</svg>`;
}

function statusOf(report: ReturnType<typeof validateSvgContract>, id: string) {
  return report.checks.find((check) => check.id === id)?.status;
}

describe("validateSvgContract", () => {
  it("accepts a document that satisfies every required element", () => {
    const report = validateSvgContract(parseSvg(build()));
    expect(report.valid).toBe(true);
    expect(report.contractVersion).toBe("animal-v1");
    expect(report.viewBox).toBe("0 0 1427 1102");
    expect(report.checks.every((check) => check.status === "ok")).toBe(true);
  });

  it("rejects a null root without throwing", () => {
    const report = validateSvgContract(null);
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("missing");
  });

  it("rejects a root whose id is not wallet-preview", () => {
    const report = validateSvgContract(parseSvg(build({ rootId: "something-else" })));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("missing");
  });

  it("reports each missing required id separately", () => {
    const report = validateSvgContract(parseSvg(build({ omit: ["animal-artwork", "stitches"] })));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "animal-artwork")).toBe("missing");
    expect(statusOf(report, "stitches")).toBe("missing");
    expect(statusOf(report, "body-artwork")).toBe("ok");
  });

  it("rejects a duplicated id", () => {
    const report = validateSvgContract(parseSvg(build({ duplicate: "animal-shape" })));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "animal-shape")).toBe("duplicate");
  });

  it("rejects an artwork target that is not an <image>", () => {
    const report = validateSvgContract(parseSvg(build({ bodyArtworkAs: "rect" })));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "body-artwork")).toBe("wrong-element");
    expect(report.checks.find((check) => check.id === "body-artwork")?.element).toBe("rect");
  });

  it("warns but stays valid when #stitches does not use the colour variable", () => {
    const report = validateSvgContract(parseSvg(build({ stitchesFill: "#E7C337" })));
    expect(statusOf(report, "stitches")).toBe("warning");
    expect(report.valid).toBe(true);
  });

  it("hints at the animal-* migration when it finds legacy fish-* ids", () => {
    const legacy = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">
      <path id="wallet-body-shape" d="M0 0h1v1H0z"/>
      <path id="fish-shape" d="M0 0h1v1H0z"/>
      <clipPath id="wallet-body-clip"><use href="#wallet-body-shape"/></clipPath>
      <clipPath id="fish-clip"><use href="#fish-shape"/></clipPath>
      <image id="body-artwork"/>
      <image id="fish-artwork"/>
      <g id="stitches" fill="var(--wallet-stitches)"></g>
    </svg>`;
    const report = validateSvgContract(parseSvg(legacy));
    expect(report.valid).toBe(false);
    for (const id of ["animal-shape", "animal-clip", "animal-artwork"]) {
      const check = report.checks.find((entry) => entry.id === id);
      expect(check?.status).toBe("missing");
      expect(check?.hint).toMatch(/fish-/);
    }
  });

  it("rejects a root that is not in the SVG namespace (explicit XHTML)", () => {
    const html = `<svg id="wallet-preview" xmlns="http://www.w3.org/1999/xhtml"><g id="stitches" fill="var(--wallet-stitches)"></g></svg>`;
    const report = validateSvgContract(parseSvg(html));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("wrong-element");
  });

  it("rejects a root with no xmlns attribute", () => {
    const svg = `<svg id="wallet-preview"><g id="stitches" fill="var(--wallet-stitches)"></g></svg>`;
    const report = validateSvgContract(parseSvg(svg));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("wrong-element");
  });

  it("rejects a root with a non-XHTML wrong namespace", () => {
    const svg = `<svg id="wallet-preview" xmlns="http://example.com/custom"><g id="stitches" fill="var(--wallet-stitches)"></g></svg>`;
    const report = validateSvgContract(parseSvg(svg));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("wrong-element");
  });

  it("accepts a correctly namespaced SVG even when other elements are missing", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"><g id="stitches" fill="var(--wallet-stitches)"></g></svg>`;
    const report = validateSvgContract(parseSvg(svg));
    expect(report.valid).toBe(false);
    // Namespace check should pass
    expect(statusOf(report, "wallet-preview")).toBe("ok");
    // But other required elements should be missing
    expect(statusOf(report, "body-artwork")).toBe("missing");
  });

  it("returns a null viewBox rather than throwing when the attribute is absent", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"><g id="stitches" fill="var(--wallet-stitches)"></g></svg>`;
    expect(validateSvgContract(parseSvg(svg)).viewBox).toBeNull();
  });
});
