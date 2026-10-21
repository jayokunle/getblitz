import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  // The @getblitz packages export TypeScript source with extensionless
  // imports, which plain Node can't load. Bundle them together with all
  // third-party deps so dist/index.js runs on its own.
  deps: {
    alwaysBundle: [/.*/],
    onlyBundle: false,
  },
  platform: "node",
  target: "node22",
  // Keep the dist/index.js name the Dockerfile runs
  fixedExtension: false,
  clean: true,
  dts: false,
});
