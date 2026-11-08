import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const projectDir = fileURLToPath(new URL("./", import.meta.url));
const pagesDir = fileURLToPath(new URL("./frontend-pages/", import.meta.url));
const publicDir = fileURLToPath(new URL("./public/", import.meta.url));
const outDir = fileURLToPath(new URL("./dist-pages/", import.meta.url));

function pagesBase(value: string): string {
  const segments = value.split("/").filter(Boolean);
  for (const segment of segments) {
    if (!/^[a-zA-Z0-9._-]+$/.test(segment) || segment === "." || segment === "..") {
      throw new Error("PAGES_BASE_PATH deve ser o caminho do site, como /amigo-secreto/.");
    }
  }
  return segments.length ? `/${segments.join("/")}/` : "/";
}

function apiOrigin(value: string | undefined): string {
  const url = URL.parse(value ?? "");
  if (!url || !["https:", "http:"].includes(url.protocol) || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Defina VITE_API_ORIGIN com a origem da API, sem caminho (ex.: https://api.exemplo.com).");
  }
  return url.origin;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectDir, ["VITE_API_ORIGIN", "PAGES_BASE_PATH"]);
  const base = pagesBase(env.PAGES_BASE_PATH ?? "/");

  return {
    base,
    root: pagesDir,
    publicDir,
    define: {
      __PAGES_BASE_PATH__: JSON.stringify(base),
      __PAGES_API_ORIGIN__: JSON.stringify(apiOrigin(env.VITE_API_ORIGIN)),
    },
    plugins: [react()],
    build: {
      emptyOutDir: true,
      outDir,
      rolldownOptions: {
        input: [
          fileURLToPath(new URL("./frontend-pages/index.html", import.meta.url)),
          fileURLToPath(new URL("./frontend-pages/organizar/index.html", import.meta.url)),
        ],
      },
    },
  };
});
