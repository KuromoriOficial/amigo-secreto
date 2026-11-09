import { parseSteamGame, type SteamGame } from "@/lib/steam-games";
import { ApiError, endpoint } from "@/lib/server/http";

type SearchResult = { items?: { id?: number; name?: string; tiny_image?: string; type?: string }[] };

export function GET(request: Request) {
  return endpoint(async () => {
    const term = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (term.length < 2) return { games: [] };
    if ([...term].length > 80 || /[\x00-\x1f\x7f]/.test(term)) {
      throw new ApiError(400, "Digite até 80 caracteres para buscar um jogo.");
    }

    const url = new URL("https://store.steampowered.com/api/storesearch/");
    url.search = new URLSearchParams({ term, l: "brazilian", cc: "BR" }).toString();
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    if (!response?.ok) throw new ApiError(503, "A busca da Steam está indisponível. Tente novamente.");

    const result = await response.json().catch(() => null) as SearchResult | null;
    if (!result || !Array.isArray(result.items)) {
      throw new ApiError(503, "A Steam não retornou resultados válidos. Tente novamente.");
    }

    const games: SteamGame[] = [];
    for (const item of result.items) {
      if (item?.type !== "app") continue;
      const game = parseSteamGame({ id: item.id, name: item.name, cover: item.tiny_image });
      if (game && !games.some(({ id }) => id === game.id)) games.push(game);
      if (games.length === 10) break;
    }
    return { games };
  });
}
