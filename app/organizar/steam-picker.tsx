"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../../lib/frontend-paths";
import { type SteamGame } from "../../lib/steam-games";
import styles from "./organizar.module.css";

type SteamPickerProps = {
  games: SteamGame[];
  onChange: (games: SteamGame[]) => void;
  disabled: boolean;
};

export function SteamPicker({ games, onChange, disabled }: SteamPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SteamGame[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

  async function search() {
    const term = query.trim();
    if (term.length < 2 || disabled || searching || games.length >= 3) return;
    const controller = new AbortController();
    pending.current = controller;
    setSearching(true);
    setResults(null);
    setError("");
    try {
      const response = await fetch(apiUrl(`/api/steam-games?q=${encodeURIComponent(term)}`), { signal: controller.signal });
      const data = await response.json().catch(() => null) as { games?: SteamGame[]; error?: string } | null;
      if (!response.ok || !Array.isArray(data?.games)) {
        throw new Error(data?.error || "Não foi possível buscar jogos da Steam.");
      }
      setResults(data.games.slice(0, 8));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível buscar jogos da Steam.");
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  const full = games.length >= 3;

  return (
    <fieldset className={styles.steamPicker} disabled={disabled}>
      <legend>Jogos desejados na Steam</legend>
      <p className={styles.calendarHint}>Até três jogos · {games.length} de 3 selecionados.</p>
      {games.length > 0 && (
        <ul className={styles.games}>
          {games.map((game) => (
            <li key={game.id}>
              <img src={game.cover} alt="" width={66} height={31} loading="lazy" />
              <span>{game.name}</span>
              <button className={styles.remove} type="button" onClick={() => onChange(games.filter(({ id }) => id !== game.id))} aria-label={`Remover ${game.name}`}>Remover</button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <>
          <label htmlFor="organizer-game-search">Buscar jogo</label>
          <div className={styles.gameSearch}>
            <input id="organizer-game-search" type="search" value={query} maxLength={80} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }} placeholder="Nome do jogo" />
            <button className={styles.secondary} type="button" onClick={() => void search()} disabled={searching || query.trim().length < 2}>{searching ? "Buscando…" : "Buscar"}</button>
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {results?.length === 0 && <p className={styles.calendarHint} role="status">Nenhum jogo encontrado.</p>}
          {Boolean(results?.length) && (
            <ul className={styles.games} aria-label="Resultados da busca">
              {results?.map((game) => {
                const selected = games.some(({ id }) => id === game.id);
                return (
                  <li key={game.id}>
                    <img src={game.cover} alt="" width={66} height={31} loading="lazy" />
                    <span>{game.name}</span>
                    <button className={styles.textButton} type="button" onClick={() => onChange([...games, game])} disabled={selected} aria-label={`Adicionar ${game.name}`}>{selected ? "Selecionado" : "Adicionar"}</button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </fieldset>
  );
}
