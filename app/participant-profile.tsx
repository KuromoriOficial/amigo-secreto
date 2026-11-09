"use client";

import { ArrowRight, Camera, Check, Copy, Gamepad2, KeyRound, Search, UsersRound, X } from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { apiUrl, assetUrl } from "../lib/frontend-paths";
import { isSteamFriendCode, steamGameCover, type SteamGame } from "../lib/steam-games";

export type Participant = {
  id: string;
  name: string;
  nickname?: string;
  photo: string;
  steamCode?: string;
  games: SteamGame[];
};

export type ParticipantDraft = {
  steamCode: string;
  games: SteamGame[];
} & ({ acceptPhoto: true; photo?: never } | { photo: string; acceptPhoto?: never });

export type SteamFriend = Pick<Participant, "id" | "name" | "nickname" | "steamCode">;

type PhotoChoice = { existing: true } | { existing: false; photo: string };
type SearchResult = { query: string; games: SteamGame[]; error?: string };

const DEMO_GAMES: SteamGame[] = [
  { id: 730, name: "Counter-Strike 2", cover: steamGameCover(730) },
  { id: 570, name: "Dota 2", cover: steamGameCover(570) },
  { id: 440, name: "Team Fortress 2", cover: steamGameCover(440) },
];

function photoUrl(photo: string) {
  return photo.startsWith("/api/") ? apiUrl(photo) : assetUrl(photo);
}

async function preparePhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15_000_000) {
    throw new Error("Escolha uma foto JPG, PNG ou WebP de até 15 MB.");
  }

  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("O navegador não conseguiu preparar a foto.");
    const edge = Math.min(image.width, image.height);
    for (const size of [320, 240, 160, 128]) {
      canvas.width = size;
      canvas.height = size;
      context.fillStyle = "#f8f4eb";
      context.fillRect(0, 0, size, size);
      context.drawImage(image, (image.width - edge) / 2, (image.height - edge) / 2, edge, edge, 0, 0, size, size);
      const photo = canvas.toDataURL("image/jpeg", .76);
      if (photo.length <= 100_000) return photo;
    }
    throw new Error("A foto ficou muito grande. Escolha outra imagem.");
  } finally {
    image.close();
  }
}

export function GameTiles({ games, onRemove }: { games: SteamGame[]; onRemove?: (id: number) => void }) {
  return (
    <ul className="as-game-tiles" role="list">
      {games.map((game) => (
        <li className="as-game-tile" key={game.id}>
          <img src={game.cover} alt="" loading="lazy" />
          <span>{game.name}</span>
          {onRemove && (
            <button type="button" className="as-game-remove" aria-label={`Remover ${game.name}`} onClick={() => onRemove(game.id)}>
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SteamDirectory({ friends }: { friends: SteamFriend[] }) {
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const members = [...friends].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

  async function copyCode(friend: SteamFriend) {
    if (!friend.steamCode) return;
    try {
      await navigator.clipboard.writeText(friend.steamCode);
      setNotice({ text: `Código de ${friend.name} copiado.`, failed: false });
    } catch {
      setNotice({ text: "Não foi possível copiar. Selecione o código na lista para copiá-lo.", failed: true });
    }
  }

  return (
    <section className="as-card as-steam-directory" aria-labelledby="as-steam-directory-heading">
      <div className="as-step as-step-green"><span><UsersRound size={15} aria-hidden="true" /></span> O GRUPO NA STEAM</div>
      <h2 id="as-steam-directory-heading">Códigos de amizade</h2>
      <p className="as-card-description">Adicione todos os participantes na Steam para manter o sorteio em segredo.</p>
      {members.length ? (
        <ul className="as-steam-members" role="list">
          {members.map((friend) => (
            <li key={friend.id}>
              <div>
                <strong>{friend.name}</strong>
                {friend.nickname && <span className="as-person-nickname">“{friend.nickname}”</span>}
                {friend.steamCode ? <code>{friend.steamCode}</code> : <span className="as-steam-missing">Código ainda não cadastrado</span>}
              </div>
              {friend.steamCode && (
                <button className="as-steam-copy" type="button" aria-label={`Copiar código de ${friend.name}`} onClick={() => void copyCode(friend)}>
                  <Copy size={15} aria-hidden="true" /> Copiar
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="as-card-description">Nenhum outro participante cadastrado.</p>}
      {notice && <p className={notice.failed ? "as-error" : "as-steam-copy-status"} role={notice.failed ? "alert" : "status"}>{notice.text}</p>}
    </section>
  );
}

export default function ParticipantProfile({
  participant,
  profileComplete,
  demo,
  onSave,
  onCancel,
}: {
  participant: Participant;
  profileComplete: boolean;
  demo: boolean;
  onSave: (profile: ParticipantDraft, signal: AbortSignal) => Promise<void>;
  onCancel?: () => void;
}) {
  const [steamCode, setSteamCode] = useState(participant.steamCode ?? "");
  const [games, setGames] = useState(participant.games);
  const [photoChoice, setPhotoChoice] = useState<PhotoChoice | null>(profileComplete ? { existing: true } : null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const saveRequest = useRef<AbortController | null>(null);
  const cleanQuery = query.trim();
  const result = search?.query === cleanQuery ? search : null;
  const currentPhoto = photoChoice?.existing === false ? photoChoice.photo : participant.photo;
  const ready = photoChoice !== null && isSteamFriendCode(steamCode) && games.length === 3;

  useEffect(() => () => saveRequest.current?.abort(), []);

  useEffect(() => {
    if (cleanQuery.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(apiUrl(`/api/steam-games?q=${encodeURIComponent(cleanQuery)}`), { signal: controller.signal });
        const data = await response.json() as { games?: SteamGame[]; error?: string };
        if (!response.ok || !Array.isArray(data.games)) throw new Error(data.error || "Não foi possível consultar a Steam.");
        if (!controller.signal.aborted) setSearch({ query: cleanQuery, games: data.games });
      } catch (error) {
        if (!controller.signal.aborted) {
          setSearch({ query: cleanQuery, games: [], error: error instanceof Error ? error.message : "Não foi possível consultar a Steam." });
        }
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cleanQuery, searchAttempt]);

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || photoBusy) return;
    setPhotoBusy(true);
    setPhotoError("");

    try {
      setPhotoChoice({ existing: false, photo: await preparePhoto(file) });
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Não foi possível abrir a foto.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !photoChoice || photoBusy || saveRequest.current) return;
    const request = new AbortController();
    saveRequest.current = request;
    setSaving(true);
    setSaveError("");

    try {
      const draft = { steamCode, games };
      await onSave(photoChoice.existing ? { ...draft, acceptPhoto: true } : { ...draft, photo: photoChoice.photo }, request.signal);
    } catch (error) {
      if (!request.signal.aborted) setSaveError(error instanceof Error ? error.message : "Não foi possível salvar o perfil.");
    } finally {
      if (saveRequest.current === request) saveRequest.current = null;
      if (!request.signal.aborted) setSaving(false);
    }
  }

  function useDemoProfile() {
    setSteamCode("123456789");
    setGames(DEMO_GAMES);
    setPhotoChoice({ existing: true });
    setPhotoError("");
    setSaveError("");
  }

  return (
    <section className="as-card as-profile-card" aria-labelledby="as-profile-heading">
      <div className="as-step as-step-green"><span>02</span> PERFIL E LISTA DE DESEJOS</div>
      <h2 id="as-profile-heading" tabIndex={-1}>Prepare seu perfil</h2>
      <p className="as-card-description">Confirme sua foto, informe seu código de amizade da Steam e escolha três jogos que você gostaria de ganhar.</p>
      {demo && <button className="as-text-button as-demo-profile" type="button" disabled={saving || photoBusy} onClick={useDemoProfile}>Preencher perfil de exemplo</button>}

      <form className="as-profile-form" onSubmit={saveProfile}>
        <div className="as-profile-grid">
          <div className="as-profile-column">
            <fieldset className="as-profile-box" disabled={saving || photoBusy}>
              <legend><Camera size={17} aria-hidden="true" /> Sua foto</legend>
              <div className="as-profile-photo-row">
                <span className="as-profile-photo">
                  {currentPhoto ? <img src={photoUrl(currentPhoto)} alt="Prévia da sua foto de perfil" /> : <Camera size={28} aria-hidden="true" />}
                </span>
                <div>
                  {photoChoice ? <p className="as-profile-confirmed"><Check size={15} aria-hidden="true" /> Foto confirmada</p> : <p>Envie sua foto ou confirme a imagem que já está no perfil.</p>}
                  {participant.photo && (!photoChoice || !photoChoice.existing) && (
                    <button className="as-text-button" type="button" onClick={() => { setPhotoChoice({ existing: true }); setPhotoError(""); }}>Usar a foto cadastrada</button>
                  )}
                </div>
              </div>
              <label className="as-profile-label" htmlFor="as-photo-file">Enviar outra foto</label>
              <input id="as-photo-file" className="as-photo-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPhoto} />
              {photoBusy && <p role="status">Preparando a foto…</p>}
              {photoError && <p className="as-error" role="alert">{photoError}</p>}
            </fieldset>

            <fieldset className="as-profile-box" disabled={saving}>
              <legend><KeyRound size={17} aria-hidden="true" /> Steam</legend>
              <label className="as-profile-label" htmlFor="as-steam-code">Seu código de amizade</label>
              <div className="as-input-frame">
                <input id="as-steam-code" inputMode="numeric" pattern="[0-9]+" maxLength={10} autoComplete="off" required value={steamCode}
                  aria-describedby="as-steam-code-hint" aria-invalid={steamCode.length > 0 && !isSteamFriendCode(steamCode)}
                  onChange={(event) => setSteamCode(event.target.value.replace(/[^0-9]/g, ""))} placeholder="Somente números" />
              </div>
              <p id="as-steam-code-hint">Seu código ficará na lista de amizade do grupo depois da revelação.</p>
            </fieldset>
          </div>

          <fieldset className="as-profile-box as-game-search-box" disabled={saving}>
            <legend><Gamepad2 size={18} aria-hidden="true" /> Seus três jogos</legend>
            <p className="as-game-count" aria-live="polite">{games.length} de 3 escolhidos</p>
            <GameTiles games={games} onRemove={(id) => setGames((current) => current.filter((game) => game.id !== id))} />
            <label className="as-profile-label" htmlFor="as-game-query">Buscar jogos na Steam</label>
            <div className="as-input-frame">
              <Search size={17} aria-hidden="true" />
              <input id="as-game-query" type="search" autoComplete="off" maxLength={80} value={query} placeholder="Digite o nome de um jogo"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
            </div>
            {cleanQuery.length < 2 ? <p>Digite pelo menos duas letras para buscar.</p>
              : !result ? <p role="status">Buscando jogos…</p>
                : result.error ? (
                  <div>
                    <p className="as-error" role="alert">{result.error}</p>
                    <button className="as-text-button" type="button" onClick={() => { setSearch(null); setSearchAttempt((attempt) => attempt + 1); }}>Tentar novamente</button>
                  </div>
                ) : result.games.length === 0 ? <p role="status">Nenhum jogo encontrado para essa busca.</p>
                  : (
                    <ul className="as-game-results" role="list">
                      {result.games.map((game) => {
                        const picked = games.some(({ id }) => id === game.id);
                        return (
                          <li key={game.id}>
                            <img src={game.cover} alt="" loading="lazy" />
                            <span>{game.name}</span>
                            <button type="button" aria-label={`Escolher ${game.name}`} disabled={picked || games.length >= 3}
                              onClick={() => setGames((current) => current.length < 3 && !current.some(({ id }) => id === game.id) ? [...current, game] : current)}>
                              {picked ? "Escolhido" : "Escolher"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
          </fieldset>
        </div>

        <div className="as-profile-actions">
          <button className="as-primary" type="submit" disabled={!ready || saving || photoBusy}>
            {saving ? "Salvando perfil…" : "Salvar perfil"} <ArrowRight size={17} aria-hidden="true" />
          </button>
          {onCancel && <button className="as-text-button" type="button" onClick={onCancel} disabled={saving}>Cancelar edição</button>}
        </div>
        {saveError && <p className="as-error" role="alert">{saveError}</p>}
      </form>
    </section>
  );
}
