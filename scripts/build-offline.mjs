import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = new URL("../frontend-offline/sorteio-offline.html", import.meta.url);
const target = new URL("../public/sorteio-offline.html", import.meta.url);
const placeholder = "/* OFFLINE_APPLICATION */";

const bundle = await build({
  configFile: false,
  root,
  publicDir: false,
  logLevel: "warn",
  build: {
    target: "es2022",
    write: false,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("../frontend-offline/offline-tool.ts", import.meta.url)),
      formats: ["iife"],
      name: "SorteioOffline",
    },
  },
});

const chunks = (Array.isArray(bundle) ? bundle : [bundle]).flatMap((item) => item.output);
const script = chunks[0];
const html = await readFile(source, "utf8");
if (chunks.length !== 1 || script?.type !== "chunk" || script.imports.length ||
    script.dynamicImports.length || !html.includes(placeholder)) {
  throw new Error("O sorteador precisa ser um único arquivo sem dependências externas.");
}
await writeFile(target, html.replace(placeholder, () => script.code.replace(/<\/script/gi, "<\\/script")));
