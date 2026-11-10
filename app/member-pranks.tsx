"use client";

import { ArrowRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, assetUrl, pageUrl } from "../lib/frontend-paths";
import MemberPrankEffect from "./member-prank-effect";
import styles from "./member-pranks.module.css";

type Kind = "tomato" | "scare";
type PrankEvent = { id: string; kind: Kind; senderName: string; expiresAt: number };
type Offer = { id: string; kind: Kind; target: { id: string; name: string; nickname?: string }; expiresAt: number };
type Interval = { tabId: string; sequence: number; heartbeat?: AbortController; send?: AbortController };

const heartbeatInterval = 12_000;

class PrankRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function prankRequest<T>(body: object, options: { signal?: AbortSignal; keepalive?: boolean } = {}) {
  const response = await fetch(apiUrl("/api/pranks"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...options,
  });
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !data) {
    throw new PrankRequestError(response.status, data?.error ?? "A brincadeira não pôde ser enviada.");
  }
  return data;
}

function onParticipantPage() {
  return document.visibilityState === "visible" && window.location.pathname === pageUrl("/");
}

export default function MemberPranks({ sessionToken, onExpired }: { sessionToken: string; onExpired: (token: string) => void }) {
  const active = useRef<Interval | null>(null);
  const dismissed = useRef<string | undefined>(undefined);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [effects, setEffects] = useState<PrankEvent[]>([]);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");

  const effect = effects[0];
  const effectId = effect?.id;
  const finishEffect = useCallback(() => {
    setEffects((current) => current[0]?.id === effectId
      ? current.slice(1).filter((pending) => pending.expiresAt > Date.now())
      : current);
  }, [effectId]);

  useEffect(() => {
    async function heartbeat() {
      const interval = active.current;
      if (!interval || interval.heartbeat || !onParticipantPage()) return;
      const controller = new AbortController();
      interval.heartbeat = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const result = await prankRequest<{ events: PrankEvent[]; offer?: Offer }>({
          action: "heartbeat", sessionToken, tabId: interval.tabId, sequence: ++interval.sequence,
        }, { signal: controller.signal });
        if (controller.signal.aborted || active.current !== interval || !onParticipantPage()) return;
        setOffer(result.offer && result.offer.id !== dismissed.current ? result.offer : null);
        if (result.events.length) {
          setEffects((current) => [
            ...current,
            ...result.events.filter((incoming) => !current.some((item) => item.id === incoming.id)),
          ]);
        }
      } catch (error) {
        if (active.current === interval && !controller.signal.aborted && error instanceof PrankRequestError && error.status === 401) onExpired(sessionToken);
      } finally {
        window.clearTimeout(timeout);
        if (interval.heartbeat === controller) interval.heartbeat = undefined;
      }
    }

    function leave() {
      const interval = active.current;
      if (!interval) return;
      active.current = null;
      interval.heartbeat?.abort();
      interval.send?.abort();
      void prankRequest({
        action: "leave", sessionToken, tabId: interval.tabId, sequence: ++interval.sequence,
      }, { keepalive: true }).catch(() => {});
    }

    function visibilityChanged() {
      if (!onParticipantPage()) {
        leave();
        setOffer(null);
        setEffects([]);
        setSending(false);
        setNotice("");
        return;
      }
      if (!active.current) {
        active.current = { tabId: crypto.randomUUID(), sequence: 0 };
        void heartbeat();
      }
    }

    function pageHidden() {
      leave();
      setOffer(null);
      setEffects([]);
      setSending(false);
      setNotice("");
    }

    const start = window.setTimeout(visibilityChanged, 0);
    const timer = window.setInterval(heartbeat, heartbeatInterval);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", pageHidden);
    window.addEventListener("pageshow", visibilityChanged);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", pageHidden);
      window.removeEventListener("pageshow", visibilityChanged);
      leave();
    };
  }, [onExpired, sessionToken]);

  useEffect(() => {
    if (!offer) return;
    const timer = window.setTimeout(() => {
      setOffer((current) => current?.id === offer.id ? null : current);
    }, Math.max(0, offer.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [offer]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function dismissOffer() {
    if (offer) dismissed.current = offer.id;
    setOffer(null);
  }

  async function sendOffer() {
    const interval = active.current;
    if (!offer || !interval || interval.send || !onParticipantPage()) return;
    const request = new AbortController();
    interval.send = request;
    setSending(true);
    const timeout = window.setTimeout(() => request.abort(), 10_000);
    try {
      await prankRequest({
        action: "send", sessionToken, tabId: interval.tabId, offerId: offer.id,
      }, { signal: request.signal });
      if (active.current !== interval || request.signal.aborted) return;
      dismissOffer();
      setNotice(offer.kind === "tomato" ? `Tomate enviado para ${offer.target.name}.` : `Susto enviado para ${offer.target.name}.`);
    } catch (error) {
      if (active.current !== interval) return;
      if (error instanceof PrankRequestError && error.status === 401) onExpired(sessionToken);
      else if (error instanceof PrankRequestError && (error.status === 404 || error.status === 409)) {
        dismissOffer();
        setNotice(error.message);
      } else {
        setNotice(error instanceof PrankRequestError ? error.message : "Não deu para enviar agora. Tente de novo.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (interval.send === request) interval.send = undefined;
      if (active.current === interval) setSending(false);
    }
  }

  return (
    <>
      {offer && (
        <aside className={styles.offer} aria-label="Convite do ThyrdDicks">
          <div className={styles.heading}>
            <img src={assetUrl("/thyrddicks.png")} alt="" width={32} height={32} />
            <div>
              <strong>ThyrdDicks</strong>
              <span>Brincadeira do grupo</span>
            </div>
            <button className={styles.close} type="button" aria-label="Dispensar convite" onClick={dismissOffer} disabled={sending}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <p role="status">
            {offer.kind === "tomato" ? "Que tal jogar um tomate na tela de " : "Quer dar um susto em "}
            <strong>{offer.target.name}</strong>?
          </p>
          <button className={styles.send} type="button" onClick={() => void sendOffer()} disabled={sending}>
            {sending ? "Enviando…" : offer.kind === "tomato" ? "Jogar tomate" : "Dar um susto"}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </aside>
      )}
      {notice && <p className={`${styles.notice}${offer ? ` ${styles.noticeWithOffer}` : ""}`} role="status">{notice}</p>}
      {effect && <MemberPrankEffect key={effect.id} kind={effect.kind} senderName={effect.senderName} onFinish={finishEffect} />}
    </>
  );
}
