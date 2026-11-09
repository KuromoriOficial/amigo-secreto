"use client";

import { ArrowUpRight, MessageCircle, Send, UsersRound, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { apiUrl } from "../lib/frontend-paths";
import type { SteamGame } from "../lib/steam-games";
import { GameTiles } from "./participant-profile";
import { profilePhotoUrl } from "./reveal-effects";
import styles from "./member-profiles.module.css";

type Member = { id: string; name: string; nickname?: string; photo: string; games: SteamGame[] };
type MemberComment = {
  id: string;
  authorName: string;
  authorNickname?: string;
  text: string;
  createdAt: string;
};
type MemberDetail = { member: Member; comments: MemberComment[] };
type ExpiredHandler = (sessionToken: string) => void;

const COMMENT_LIMIT = 240;
const COMMENT_DATE = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

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

function CommentItem({ comment }: { comment: MemberComment }) {
  const date = new Date(comment.createdAt);
  const hasDate = Number.isFinite(date.getTime());
  return (
    <li className={styles.comment}>
      <div className={styles.commentMeta}>
        <strong>{comment.authorName}{comment.authorNickname ? ` · ${comment.authorNickname}` : ""}</strong>
        {hasDate && <time dateTime={comment.createdAt}>{COMMENT_DATE.format(date)}</time>}
      </div>
      <p className={styles.commentText}>{comment.text}</p>
    </li>
  );
}

function MemberDialog({
  selected, sessionToken, onExpired, onClose,
}: {
  selected: Member;
  sessionToken: string;
  onExpired?: ExpiredHandler;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const commentRequest = useRef<AbortController | null>(null);
  const headingId = useId();
  const commentHeadingId = useId();
  const commentInputId = useId();
  const commentCountId = useId();
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sent, setSent] = useState(false);
  const member = detail?.member ?? selected;
  const count = Array.from(text).length;
  const cleanedText = text.trim();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => commentRequest.current?.abort();
  }, []);

  useEffect(() => {
    const request = new AbortController();
    void requestMembers<MemberDetail>(sessionToken, { action: "profile", participantId: selected.id }, request.signal)
      .then((result) => {
        if (!request.signal.aborted) setDetail(result);
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) setDetailError(requestError(error, sessionToken, onExpired, "Não foi possível carregar os recados."));
      });
    return () => request.abort();
  }, [loadVersion, onExpired, selected.id, sessionToken]);

  async function sendComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !cleanedText || count > COMMENT_LIMIT || commentRequest.current) return;
    const request = new AbortController();
    commentRequest.current = request;
    setSending(true);
    setSendError("");
    setSent(false);
    try {
      const { comment } = await requestMembers<{ comment: MemberComment }>(sessionToken, {
        action: "comment",
        participantId: selected.id,
        text: cleanedText,
      }, request.signal);
      if (request.signal.aborted) return;
      setDetail((current) => current ? { ...current, comments: [comment, ...current.comments] } : current);
      setText("");
      setSent(true);
      requestAnimationFrame(() => commentInput.current?.focus());
    } catch (error) {
      if (!request.signal.aborted) setSendError(requestError(error, sessionToken, onExpired, "Não foi possível enviar o recado. Tente novamente."));
    } finally {
      if (commentRequest.current === request) commentRequest.current = null;
      if (!request.signal.aborted) setSending(false);
    }
  }

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

        <section className={styles.comments} aria-labelledby={commentHeadingId}>
          <h3 id={commentHeadingId}><MessageCircle size={18} aria-hidden="true" /> Recados no perfil</h3>
          {detailError ? (
            <div>
              <p className={styles.error} role="alert">{detailError}</p>
              <button className={styles.secondary} type="button" onClick={() => { setDetailError(""); setLoadVersion((value) => value + 1); }}>
                Tentar novamente
              </button>
            </div>
          ) : !detail ? <p className={styles.status} role="status">Carregando recados…</p> : (
            <>
              <form className={styles.compose} onSubmit={sendComment}>
                <label htmlFor={commentInputId}>Deixe um recado</label>
                <textarea id={commentInputId} ref={commentInput} rows={3} maxLength={COMMENT_LIMIT * 2} required
                  value={text} disabled={sending} aria-describedby={commentCountId} aria-invalid={count > COMMENT_LIMIT}
                  onChange={(event) => { setText(event.target.value); setSendError(""); setSent(false); }} />
                <div className={styles.composeActions}>
                  <p id={commentCountId} className={count > COMMENT_LIMIT ? styles.error : styles.status}>{count} de {COMMENT_LIMIT} caracteres</p>
                  <button className={styles.primary} type="submit" disabled={sending || !cleanedText || count > COMMENT_LIMIT}>
                    <Send size={15} aria-hidden="true" /> {sending ? "Enviando…" : "Publicar recado"}
                  </button>
                </div>
                {sendError && <p className={styles.error} role="alert">{sendError}</p>}
                {sent && <p className={styles.success} role="status">Recado publicado.</p>}
              </form>
              {detail.comments.length ? (
                <ul className={styles.commentList} role="list">
                  {detail.comments.map((comment) => <CommentItem key={comment.id} comment={comment} />)}
                </ul>
              ) : <p className={styles.status}>Ainda não há recados neste perfil.</p>}
            </>
          )}
        </section>
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
          <p className={styles.description}>Veja os jogos escolhidos pelos participantes e deixe um recado no perfil.</p>
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
      {selected && <MemberDialog key={selected.id} selected={selected} sessionToken={sessionToken} onExpired={onExpired} onClose={() => setSelected(null)} />}
    </section>
  );
}
