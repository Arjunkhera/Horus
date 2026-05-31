import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  // @forge/core (and its deps) compile to CommonJS and use require(). When we
  // bundle them into this ESM CLI, esbuild leaves those as dynamic requires,
  // which throw "Dynamic require of X is not supported" at runtime. Injecting a
  // real `require` via createRequire makes the bundled CJS interop work.
  banner: {
    js: "import { createRequire as __horusCreateRequire } from 'module'; const require = __horusCreateRequire(import.meta.url);",
  },
});
