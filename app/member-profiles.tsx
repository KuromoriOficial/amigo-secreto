"use client";

import { ArrowUpRight, UsersRound, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { apiUrl } from "../lib/frontend-paths";
import type { SteamGame } from "../lib/steam-games";
import { GameTiles } from "./participant-profile";
import { profilePhotoUrl } from "./reveal-effects";
import styles from "./member-profiles.module.css";

type Member = { id: string; name: string; nickname?: string; photo: string; games: SteamGame[] };
type ExpiredHandler = (sessionToken: string) => void;

class MemberRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function requestMembers<T>(sessionToken: string, payload: object, signal: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl("/api/members"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, sessionToken }),
    signal,
  });
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !data) {
    throw new MemberRequestError(data?.error || "Não foi possível acessar os perfis.", response.status);
  }
  return data;
}

function requestError(error: unknown, sessionToken: string, onExpired: ExpiredHandler | undefined, fallback: string) {
  if (error instanceof MemberRequestError) {
    if (error.status === 401) onExpired?.(sessionToken);
    return error.message;
  }
  return fallback;
}

function MemberAvatar({ member }: { member: Member }) {
  const [failedPhoto, setFailedPhoto] = useState("");
  const initials = member.name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("");
  const photo = member.photo && profilePhotoUrl(member.photo);

  return (
    <span className={styles.avatar} aria-hidden="true">
      <span>{initials}</span>
      {photo && photo !== failedPhoto && <img src={photo} alt="" loading="lazy" onError={() => setFailedPhoto(photo)} />}
    </span>
  );
}

function MemberTile({ member, onOpen }: { member: Member; onOpen: () => void }) {
  return (
    <li>
      <button className={styles.tile} type="button" onClick={onOpen} aria-label={`Ver perfil de ${member.name}${member.nickname ? `, ${member.nickname}` : ""}`}>
        <span className={styles.tileIdentity}>
          <MemberAvatar member={member} />
          <span>
            <span className={styles.memberName}>{member.name}</span>
            {member.nickname && <span className={styles.nickname}>“{member.nickname}”</span>}
          </span>
        </span>
        {member.games.length ? (
          <span className={styles.coverStrip} aria-hidden="true">
            {member.games.map((game) => <img key={game.id} src={game.cover} alt="" loading="lazy" />)}
          </span>
        ) : <span className={styles.emptyGames}>Jogos ainda não cadastrados</span>}
        <span className={styles.tileAction}>Ver perfil <ArrowUpRight size={15} aria-hidden="true" /></span>
      </button>
    </li>
  );
}

function MemberDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog className={styles.dialog} ref={dialog} aria-labelledby={headingId} onClose={onClose}>
      <div className={styles.dialogContent}>
        <header className={styles.dialogHeader}>
          <div className={styles.dialogIdentity}>
            <MemberAvatar member={member} />
            <div>
              <h2 id={headingId}>{member.name}</h2>
              {member.nickname && <p className={styles.nickname}>“{member.nickname}”</p>}
            </div>
          </div>
          <button className={styles.close} type="button" aria-label="Fechar perfil" autoFocus onClick={() => dialog.current?.close()}>
            <X size={21} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.gameSection}>
          <h3>Jogos escolhidos</h3>
          {member.games.length ? <GameTiles games={member.games} /> : <p className={styles.status}>Este perfil ainda não escolheu os jogos.</p>}
        </div>

      </div>
    </dialog>
  );
}

export default function MemberProfiles({ sessionToken, onExpired }: { sessionToken: string; onExpired?: ExpiredHandler }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [selected, setSelected] = useState<Member | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const listRequest = useRef<AbortController | null>(null);
  const headingId = useId();

  useEffect(() => () => listRequest.current?.abort(), []);

  async function loadMembers() {
    if (listRequest.current) return;
    const request = new AbortController();
    listRequest.current = request;
    setLoading(true);
    setError("");

    try {
      const result = await requestMembers<{ members: Member[] }>(sessionToken, { action: "list" }, request.signal);
      if (!request.signal.aborted) {
        setMembers([...result.members].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")));
      }
    } catch (failure) {
      if (!request.signal.aborted) setError(requestError(failure, sessionToken, onExpired, "Não foi possível carregar os perfis do grupo."));
    } finally {
      if (listRequest.current === request) listRequest.current = null;
      if (!request.signal.aborted) setLoading(false);
    }
  }

  return (
    <section id="as-members" className={`as-card ${styles.gallery}`} aria-labelledby={headingId}>
      <div className={styles.galleryHeader}>
        <div>
          <p className={styles.kicker}><UsersRound size={15} aria-hidden="true" /> A TURMA DO AMIGO SECRETO</p>
          <h2 id={headingId}>Perfis do grupo</h2>
          <p className={styles.description}>Veja os jogos escolhidos pelos participantes.</p>
        </div>
        <button className={styles.secondary} type="button" aria-disabled={loading} onClick={() => void loadMembers()}>
          {error ? "Tentar novamente" : members ? "Atualizar perfis" : "Carregar perfis"} <ArrowUpRight size={15} aria-hidden="true" />
        </button>
      </div>
      {loading && <p className={styles.status} role="status">Carregando perfis…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {members && (members.length ? (
        <ul className={styles.grid} role="list">
          {members.map((member) => <MemberTile key={member.id} member={member} onOpen={() => setSelected(member)} />)}
        </ul>
      ) : <p className={styles.status}>Ainda não há perfis cadastrados no grupo.</p>)}
      {selected && <MemberDialog key={selected.id} member={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}
