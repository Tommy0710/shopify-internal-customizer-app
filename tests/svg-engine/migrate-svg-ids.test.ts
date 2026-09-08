import { describe, expect, it } from "vitest";
import { migrateSvgIds } from "../../scripts/migrate-svg-ids.mjs";

describe("migrateSvgIds", () => {
  it("renames ids, href targets and url() references together", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">
      <path id="fish-shape" d="M0 0h1v1H0z"/>
      <clipPath id="fish-clip"><use href="#fish-shape"/></clipPath>
      <image id="fish-artwork" clip-path="url(#fish-clip)"/>
      <g id="fish-outline"><use href="#fish-shape"/></g>
    </svg>`;

    const { svg, renamed } = migrateSvgIds(source);

    expect(svg).toContain(`id="animal-shape"`);
    expect(svg).toContain(`id="animal-clip"`);
    expect(svg).toContain(`id="animal-artwork"`);
    expect(svg).toContain(`href="#animal-shape"`);
    expect(svg).toContain(`url(#animal-clip)`);
    expect(svg).not.toContain("fish-");
    expect(renamed.sort()).toEqual(["fish-artwork", "fish-clip", "fish-outline", "fish-shape"]);
  });

  it("leaves ids that are not fish-prefixed alone", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">
      <path id="wallet-body-shape" d="M0 0h1v1H0z"/>
      <clipPath id="wallet-body-clip"><use href="#wallet-body-shape"/></clipPath>
      <g id="stitches" fill="var(--wallet-stitches)"></g>
    </svg>`;
    const { svg, renamed } = migrateSvgIds(source);
    expect(svg).toBe(source);
    expect(renamed).toEqual([]);
  });

  it("does not touch the word fish outside id, href and url contexts", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">
      <!-- the fish-shaped applique sits above the body -->
      <g class="fish-layer" data-note="fish-thing"><path id="fish-shape" d="M0 0h1v1H0z"/></g>
    </svg>`;
    const { svg } = migrateSvgIds(source);
    expect(svg).toContain("the fish-shaped applique");
    expect(svg).toContain(`class="fish-layer"`);
    expect(svg).toContain(`data-note="fish-thing"`);
    expect(svg).toContain(`id="animal-shape"`);
  });

  it("is idempotent — running it on migrated output changes nothing", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">
      <path id="fish-shape" d="M0 0h1v1H0z"/>
      <clipPath id="fish-clip"><use href="#fish-shape"/></clipPath>
    </svg>`;
    const once = migrateSvgIds(source);
    const twice = migrateSvgIds(once.svg);
    expect(twice.svg).toBe(once.svg);
    expect(twice.renamed).toEqual([]);
  });
});
