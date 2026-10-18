/**
 * Copies the Moonshine WASM binding into public/ so the browser can import the
 * Emscripten module natively.
 *
 * Turbopack cannot bundle @moonshine-ai/moonshine-wasm: it resolves the Node-only
 * `import("module")` / `import("worker_threads")` branches in Emscripten's output
 * (and then stalls on the 13 MB .wasm). Serving the package's dist folder as
 * static assets keeps the binding out of the module graph while preserving the
 * same-origin URLs its pthread workers and .wasm lookup rely on.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/@moonshine-ai/moonshine-wasm/dist");
const target = resolve(root, "public/moonshine-wasm");

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`[moonshine] copied ${source} -> ${target}`);
