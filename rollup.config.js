import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

export default {
  input: "src/area-glance-card.ts",
  output: {
    file: "area-glance-card.js",
    format: "es",
    // The distributed HACS asset is intentionally self-contained. Keeping a
    // map out of the release avoids a broken source-map request in HA.
    sourcemap: false,
  },
  plugins: [resolve(), typescript(), terser()],
};
