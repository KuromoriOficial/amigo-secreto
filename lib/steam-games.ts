export type SteamGame = { id: number; name: string; cover: string };

export function isSteamFriendCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,10}$/.test(value) &&
    Number(value) > 0 && Number(value) <= 0xffff_ffff;
}

export function parseSteamGame(value: unknown): SteamGame | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, name, cover } = value as Partial<SteamGame>;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || id > 0xffff_ffff ||
    typeof name !== "string" || !name.trim() || [...name].length > 180 || /[\x00-\x1f\x7f]/.test(name) ||
    typeof cover !== "string" || cover.length > 600) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(cover);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !/(^|\.)steamstatic\.com$/.test(url.hostname) ||
    url.username || url.password || url.port || url.hash ||
    !url.pathname.includes(`/steam/apps/${id}/`) || !/\.(jpg|png|webp)$/i.test(url.pathname)) {
    return null;
  }
  return { id, name: name.trim(), cover: url.href };
}

export function parseSteamGames(value: unknown): SteamGame[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const games: SteamGame[] = [];
  for (const entry of value) {
    const game = parseSteamGame(entry);
    if (!game || games.some(({ id }) => id === game.id)) return null;
    games.push(game);
  }
  return games;
}

export function steamGameCover(id: number) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
}
