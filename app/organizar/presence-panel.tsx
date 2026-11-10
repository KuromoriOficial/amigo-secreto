"use client";

import { Eye } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import styles from "./organizar.module.css";

export type PresenceMember = { id: string; name: string; nickname?: string };
export type ParticipantEffect = "tomato" | "scare";
export type EffectRequest = { participantId?: string; kind: ParticipantEffect; requestId: string };
type PresencePanelProps = {
  loadPresence: (signal: AbortSignal) => Promise<PresenceMember[]>;
  sendEffect: (request: EffectRequest, signal: AbortSignal) => Promise<string | undefined>;
};

const randomTarget = "random";
const refreshInterval = 12_000;
const effectLabels: Record<ParticipantEffect, string> = { tomato: "Tomate", scare: "Susto" };

function memberLabel(member: PresenceMember) {
  return member.nickname && member.nickname !== member.name ? `${member.name} (${member.nickname})` : member.name;
}

export function PresencePanel({ loadPresence, sendEffect }: PresencePanelProps) {
  const [presence, setPresence] = useState<{ online: PresenceMember[]; readAt: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [presenceError, setPresenceError] = useState("");
  const [target, setTarget] = useState("");
  const [effect, setEffect] = useState<ParticipantEffect>("tomato");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const reading = useRef<AbortController | null>(null);
  const dispatch = useRef<AbortController | null>(null);
  const retry = useRef<EffectRequest | null>(null);

  const refresh = useCallback(async () => {
    if (document.hidden || reading.current) return;
    const controller = new AbortController();
    reading.current = controller;
    setRefreshing(true);
    setPresenceError("");
    try {
      const online = await loadPresence(controller.signal);
      if (controller.signal.aborted) return;
      setPresence({ online, readAt: Date.now() });
    } catch {
      if (controller.signal.aborted) return;
      setPresence(null);
      setPresenceError("Não foi possível atualizar quem está online.");
    } finally {
      if (reading.current === controller) {
        reading.current = null;
        setRefreshing(false);
      }
    }
  }, [loadPresence]);

  useEffect(() => {
    function onVisibilityChange() {
      if (!document.hidden) {
        void refresh();
        return;
      }
      reading.current?.abort();
      reading.current = null;
      setPresence(null);
      setRefreshing(false);
    }

    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, refreshInterval);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reading.current?.abort();
      reading.current = null;
      dispatch.current?.abort();
      dispatch.current = null;
    };
  }, [refresh]);

  const online = presence?.online ?? [];
  const selectedMember = online.find(({ id }) => id === target);
  const validTarget = target === randomTarget ? online.length > 0 : Boolean(selectedMember);
  const canSend = validTarget && !sending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend || dispatch.current || document.hidden) return;
    if (!presence || Date.now() - presence.readAt > refreshInterval * 2) {
      setFeedback({ kind: "error", text: "Atualizando a lista. Selecione o destino e tente novamente." });
      void refresh();
      return;
    }

    const controller = new AbortController();
    dispatch.current = controller;
    setSending(true);
    setFeedback(null);
    try {
      const participantId = target === randomTarget ? undefined : target;
      if (!retry.current || retry.current.participantId !== participantId || retry.current.kind !== effect) {
        retry.current = { participantId, kind: effect, requestId: crypto.randomUUID() };
      }
      const recipient = await sendEffect(retry.current, controller.signal);
      if (controller.signal.aborted) return;
      retry.current = null;
      setFeedback({ kind: "success", text: `${effectLabels[effect]} enviado para ${recipient || selectedMember?.name || "uma pessoa online"}.` });
    } catch (cause) {
      if (controller.signal.aborted) return;
      const text = cause instanceof Error && !(cause instanceof TypeError) ? cause.message : "Não foi possível confirmar o envio do efeito.";
      setFeedback({ kind: "error", text });
    } finally {
      if (dispatch.current === controller) {
        dispatch.current = null;
        setSending(false);
        void refresh();
      }
    }
  }

  return (
    <section className={`${styles.card} ${styles.presencePanel}`} aria-labelledby="presence-title">
      <div>
        <div className={styles.sectionHeading}>
          <span className={styles.sectionIcon}><Eye size={20} aria-hidden="true" /></span>
          <div>
            <h2 id="presence-title">Participantes online</h2>
            <p>Envie um tomate ou um susto como <strong>ThyrdDicks</strong> para quem está com a página inicial visível.</p>
          </div>
        </div>
        <div className={styles.presenceSummary}>
          <strong>{presence ? `${online.length} online agora` : refreshing ? "Buscando presenças…" : "Presença indisponível"}</strong>
          <button className={styles.textButton} type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Atualizando…" : "Atualizar lista"}</button>
        </div>
        {presenceError && <p className={styles.calendarHint} role="status">{presenceError}</p>}
        {online.length > 0 && (
          <ul className={styles.onlineList} aria-label="Pessoas online">
            {online.map((member) => <li key={member.id}>{memberLabel(member)}</li>)}
          </ul>
        )}
      </div>

      <form className={styles.effectForm} onSubmit={submit} aria-busy={sending}>
        <div className={styles.effectChoices}>
          <label htmlFor="effect-target">Destino
            <select id="effect-target" value={validTarget ? target : ""} onChange={(event) => { setTarget(event.target.value); setFeedback(null); }} disabled={sending || !online.length} required>
              <option value="">Selecione o destino</option>
              <option value={randomTarget}>Sortear entre os online</option>
              {online.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}
            </select>
          </label>
          <label htmlFor="effect-type">Efeito
            <select id="effect-type" value={effect} onChange={(event) => { setEffect(event.target.value as ParticipantEffect); setFeedback(null); }} disabled={sending}>
              <option value="tomato">Tomate</option>
              <option value="scare">Susto</option>
            </select>
          </label>
        </div>
        {target && !validTarget && presence && <p className={styles.calendarHint}>{target === randomTarget ? "Ninguém está online agora." : "O destino não está mais online. Escolha outro."}</p>}
        <div className={styles.formActions}>
          <button className={styles.primary} type="submit" disabled={!canSend}>{sending ? "Enviando…" : "Enviar efeito"}</button>
        </div>
        {feedback && <p className={feedback.kind === "error" ? styles.error : styles.success} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.text}</p>}
      </form>
    </section>
  );
}
