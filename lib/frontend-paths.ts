declare const __PAGES_BASE_PATH__: string | undefined;
declare const __PAGES_API_ORIGIN__: string | undefined;

const basePath = typeof __PAGES_BASE_PATH__ === "string" ? __PAGES_BASE_PATH__ : "";
const apiOrigin = typeof __PAGES_API_ORIGIN__ === "string" ? __PAGES_API_ORIGIN__ : "";

export const isStaticFrontend = basePath !== "";

export function apiUrl(path: string): string {
  return `${apiOrigin}${path}`;
}

export function assetUrl(path: string): string {
  if (isStaticFrontend && path.startsWith("/") && !path.startsWith("//")) {
    return `${basePath}${path.slice(1)}`;
  }
  return path;
}

export function pageUrl(path: string): string {
  if (!isStaticFrontend || path === "/") return assetUrl(path);
  return assetUrl(path.endsWith("/") ? path : `${path}/`);
}
