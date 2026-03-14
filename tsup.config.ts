import { defineConfig } from "tsup";
import { readFile } from "node:fs/promises";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/index": "src/cli/index.ts",
  },
  format: ["esm"],
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  esbuildPlugins: [
    {
      name: "strip-entry-shebang",
      setup(build) {
        build.onLoad({ filter: /src[\\/](index|cli[\\/]index)\.ts$/ }, async (args) => {
          const contents = await readFile(args.path, "utf8");
          return {
            contents: contents.replace(/^#![^\n]*\r?\n/, ""),
            loader: "ts",
          };
        });
      },
    },
  ],
});
