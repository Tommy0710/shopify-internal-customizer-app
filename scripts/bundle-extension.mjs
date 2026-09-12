import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";

const outDir = path.resolve(process.cwd(), "extensions/product-customizer-block/assets");

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

console.log("📦 Bundling Storefront React Customizer into Theme App Extension...");

try {
  await esbuild.build({
    entryPoints: ["src/storefront-customizer/index.tsx"],
    bundle: true,
    minify: true,
    treeShaking: true,
    sourcemap: false,
    target: ["es2020"],
    outfile: path.join(outDir, "customizer-bundle.js"),
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production"),
    },
    // CustomizerApp is shared with the Next.js storefront-preview page, which needs
    // real React types/runtime — so this esbuild-only bundle aliases react/react-dom
    // to preact/compat (same API, ~8KB vs ~130KB) instead of editing the source imports.
    alias: {
      "react": "preact/compat",
      "react-dom/client": "preact/compat/client",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
      "@": path.resolve(process.cwd(), "src"),
    },
    loader: {
      ".png": "dataurl",
      ".svg": "text",
    },
  });

  console.log("✅ Storefront React bundle successfully built at: extensions/product-customizer-block/assets/customizer-bundle.js");
} catch (error) {
  console.error("❌ Error bundling extension:", error);
  process.exit(1);
}
