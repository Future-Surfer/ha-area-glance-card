import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

export default {
  input: "src/area-glance-card.ts",
  output: {
    file: "area-glance-card.js",
    format: "es",
    sourcemap: true,
  },
  plugins: [resolve(), typescript(), terser()],
};
