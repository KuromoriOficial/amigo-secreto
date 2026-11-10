"use client";

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, assetUrl, isStaticFrontend, pageUrl } from "../../lib/frontend-paths";
import { createOfflineDraw, type OfflineDraw } from "../../lib/offline-crypto";
import { isSteamFriendCode, type SteamGame } from "../../lib/steam-games";
import ThemeToggle from "../theme-toggle";
import { PresencePanel, type EffectRequest, type PresenceMember } from "./presence-panel";
import { SteamPicker } from "./steam-picker";
import styles from "./organizar.module.css";

type Profile = { name: string; nickname?: string; photo: string; steamCode?: string; games?: SteamGame[] };
type Participant = Profile & {
  id: string;
  code?: string;
  accessCode?: string;
  accessedAt?: string;
  revealedAt?: string;
  responded: boolean;
};
type ProfileTracking = { accessCode?: string; accessed?: boolean; revealed?: boolean };
type Day = { date: string; available: number; unavailable: number };
type DrawKind = "test" | "definitive";
type DrawStatus = "draft" | DrawKind | "cancelled";
type Event = { phase: "draft" | "drawn"; drawStatus?: DrawStatus; drawMethod?: "offline" | "online"; participants: Participant[]; responseCount: number; dates: Day[] };
type PhotoDraft = Profile & ProfileTracking & { id?: string };
type OrganizerAction =
  | { action: "save"; participants: (Profile & { id?: string })[] }
  | { action: "credentials" }
  | { action: "edit-profile"; participantId: string } & Profile & ProfileTracking
  | { action: "import"; draw: OfflineDraw; drawCodes: string[]; kind: DrawKind }
  | { action: "register-codes"; drawCodes: string[] }
  | { action: "cancel-draw" }
  | { action: "reset-draw" };
type DrawIntent = { action: "generate" | "import"; kind: DrawKind } | { action: "cancel-draw" } | { action: "reset-draw" };
type AuditAction = { action: "audit"; confirmation: "REVELAR" };
type AnnouncementAction = { action: "announce"; text: string; requestId: string };
type PresenceAction = { action: "prank-presence" } | { action: "prank" } & EffectRequest;
type AuditPerson = { id: string; name: string; nickname?: string };
type AuditPair = { giver: AuditPerson; recipient: AuditPerson };
type IconName = "gift" | "arrow" | "lock" | "calendar" | "copy" | "people" | "check" | "megaphone";

const announcementLimit = 500;
const emptyDraft: PhotoDraft = { name: "", photo: "" };
const participantPage = pageUrl("/");
const months = { "11": "Novembro", "12": "Dezembro" };
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" });
const trackingFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const saoPauloDate = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Sao_Paulo" });
const updateMessages: Record<OrganizerAction["action"], string> = {
  save: "Lista salva.",
  credentials: "Códigos de acesso gerados.",
  "edit-profile": "Perfil atualizado.",
  import: "Sorteio definitivo ativado. Envie os dois códigos de cada pessoa em particular.",
  "register-codes": "Códigos de sorteio registrados.",
  "cancel-draw": "Sorteio cancelado. Volte à preparação quando estiver pronto para começar de novo.",
  "reset-draw": "Painel voltou à preparação. Perfis e códigos de acesso foram mantidos.",
};
const phaseLabels: Record<DrawStatus, string> = {
  draft: "Em preparação",
  test: "Sorteio de teste ativo",
  definitive: "Sorteio definitivo ativo",
  cancelled: "Sorteio cancelado",
};
const drawConfirmations = {
  test: {
    title: "Ativar um sorteio de teste?",
    detail: "Os códigos de teste funcionarão até você resetar o sorteio. O reset apaga os resultados, as revelações e as respostas do calendário deste teste.",
    button: "Confirmar sorteio de teste",
  },
  definitive: {
    title: "Ativar o sorteio definitivo?",
    detail: "Os participantes poderão consultar os resultados com seus códigos. Para fazer outro sorteio, primeiro cancele este e volte à preparação.",
    button: "Confirmar sorteio definitivo",
  },
  "cancel-draw": {
    title: "Cancelar o sorteio definitivo?",
    detail: "Os códigos deste sorteio deixarão de funcionar. O painel ficará cancelado até você voltar à preparação.",
    button: "Confirmar cancelamento",
  },
  "reset-draw": {
    title: "Resetar o sorteio e voltar à preparação?",
    detail: "Os códigos de sorteio, os registros de revelação e as respostas do calendário serão apagados. Os perfis e os códigos de acesso serão mantidos.",
    button: "Confirmar reset do sorteio",
  },
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    gift: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v8h14v-8M12 8v12M12 8c-5 0-6.4-2-5.4-3.5C8 2.5 11 4.1 12 8Zm0 0c5 0 6.4-2 5.4-3.5C16 2.5 13 4.1 12 8Z" /></>,
    arrow: <path d="m12 19-7-7 7-7M5 12h14" />,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 1 1 8 0v4m-4 4v2" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4m8-4v4m-8 8h2m4 0h2" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    people: <><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2m2-16a3 3 0 0 1 0 6m4 10v-2a5 5 0 0 0-3-4.6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    megaphone: <><path d="m3 11 16-6v14L3 14v-3Zm5 5 2 4h3l-2-3m8-6h2m-2 4h2" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

async function organizerFetch(key: string, action?: OrganizerAction | AuditAction | AnnouncementAction | PresenceAction, signal?: AbortSignal) {
  const response = await fetch(apiUrl("/api/organizer"), {
    method: action ? "POST" : "GET",
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(action ? { "Content-Type": "application/json" } : {}) },
    body: action ? JSON.stringify(action) : undefined,
    cache: "no-store",
    credentials: isStaticFrontend ? "omit" : "same-origin",
    signal,
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !data || typeof data !== "object") {
    throw new Error(typeof data?.error === "string" ? data.error : "Não foi possível acessar o painel. Tente novamente.");
  }
  return data;
}

async function organizerRequest(key: string, action?: OrganizerAction, signal?: AbortSignal) {
  const data = await organizerFetch(key, action, signal);
  if (data.phase !== "draft" && data.phase !== "drawn") throw new Error("Não foi possível atualizar o painel.");
  return data as Event;
}

function AnnouncementComposer({ organizerKey }: { organizerKey: string }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const attempt = useRef<{ text: string; id: string } | null>(null);
  const length = [...text].length;
  const overLimit = length > announcementLimit;

  useEffect(() => () => pending.current?.abort(), []);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = text.trim();
    if (!message || overLimit || pending.current) return;

    const controller = new AbortController();
    pending.current = controller;
    setSending(true);
    setFeedback(null);
    try {
      if (attempt.current?.text !== message) attempt.current = { text: message, id: crypto.randomUUID() };
      const response = await organizerFetch(organizerKey, { action: "announce", text: message, requestId: attempt.current.id }, controller.signal);
      const published = response.message;
      if (!published || typeof published !== "object" || !("kind" in published) || published.kind !== "announcement") {
        throw new Error("Não foi possível confirmar o envio do comunicado.");
      }
      if (controller.signal.aborted) return;
      attempt.current = null;
      setText("");
      setFeedback({ kind: "success", message: "Comunicado publicado no chat geral." });
    } catch (cause) {
      if (controller.signal.aborted) return;
      const detail = cause instanceof Error && !(cause instanceof TypeError) ? cause.message : "Não foi possível enviar o comunicado. Tente novamente.";
      setFeedback({ kind: "error", message: detail });
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setSending(false);
    }
  }

  return (
    <section className={`${styles.card} ${styles.announcementCard}`} aria-labelledby="announcement-title">
      <div className={styles.sectionHeading}>
        <span className={`${styles.sectionIcon} ${styles.announcementIcon}`}><Icon name="megaphone" /></span>
        <div>
          <h2 id="announcement-title">Comunicado importante</h2>
          <p id="announcement-description">Publique um aviso em destaque no chat geral. Ele aparece como <strong>ThyrdDicks</strong> para o grupo.</p>
        </div>
      </div>
      <form className={styles.announcementForm} onSubmit={publish} aria-busy={sending}>
        <label htmlFor="announcement-text">Mensagem do comunicado</label>
        <textarea
          id="announcement-text"
          aria-describedby="announcement-description announcement-count"
          aria-invalid={overLimit}
          rows={3}
          maxLength={announcementLimit * 2}
          placeholder="Escreva o aviso para o grupo"
          value={text}
          onChange={(event) => { setText(event.target.value); setFeedback(null); }}
          disabled={sending}
          required
        />
        <div className={styles.announcementActions}>
          <span id="announcement-count" className={overLimit ? styles.announcementOverLimit : undefined}>{length} / {announcementLimit} caracteres</span>
          <button className={styles.primary} type="submit" disabled={sending || overLimit || !text.trim()}>{sending ? "Publicando…" : "Publicar comunicado"}</button>
        </div>
        {feedback && <p className={feedback.kind === "success" ? styles.success : styles.error} role={feedback.kind === "success" ? "status" : "alert"}>{feedback.message}</p>}
      </form>
    </section>
  );
}

function parseOfflineDraw(text: string, participants: Participant[]): OfflineDraw {
  const file = JSON.parse(text.trim()) as Partial<OfflineDraw> | null;
  if (file?.version !== 1 || !Array.isArray(file.assignments)) {
    throw new Error("Selecione o arquivo de resultado protegido gerado pela ferramenta offline.");
  }
  if (file.assignments.length !== participants.length) {
    throw new Error("O arquivo é de outra lista. Baixe a lista salva e gere um novo resultado.");
  }
  const expectedIds = new Set(participants.map(({ id }) => id));
  const usedLookups = new Set<string>();
  const assignments = file.assignments.map((assignment) => {
    if (!assignment || typeof assignment !== "object") {
      throw new Error("O resultado protegido tem um registro inválido.");
    }
    const { participantId, lookup, iv, ciphertext } = assignment;
    if (typeof participantId !== "string" || !expectedIds.delete(participantId)) {
      throw new Error("O arquivo é de outra lista. Baixe a lista salva e gere um novo resultado.");
    }
    if (typeof lookup !== "string" || !/^[0-9a-f]{64}$/.test(lookup) || usedLookups.has(lookup)
      || typeof iv !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(iv)
      || typeof ciphertext !== "string" || !/^[A-Za-z0-9_-]{70}$/.test(ciphertext)) {
      throw new Error("O resultado protegido tem um registro inválido.");
    }
    usedLookups.add(lookup);
    return { participantId, lookup, iv, ciphertext };
  });
  return { version: 1, assignments };
}

function parseDrawCodes(text: string, count: number) {
  const codes = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^\d{30}$/.test(line));
  if (codes.length !== count || new Set(codes).size !== count) {
    throw new Error("Selecione o arquivo de códigos gerado para esta lista. Ele deve conter um código de sorteio único por pessoa.");
  }
  return codes;
}

function TrackingBadge({ label, empty, date }: { label: string; empty: string; date?: string }) {
  const time = date ? new Date(date) : null;
  if (!date || !time || Number.isNaN(time.getTime())) return <span className={styles.badge}>{empty}</span>;
  return <span className={`${styles.badge} ${styles.badgeDone}`}>{label} <time dateTime={date}>{trackingFormatter.format(time)}</time></span>;
}

function CopyCode({ label, name, value, copy }: { label: string; name: string; value?: string; copy: (value: string, message: string) => void }) {
  return (
    <div className={styles.credential}>
      <span>{label}</span>
      {value ? (
        <button className={styles.code} type="button" onClick={() => copy(value, `${label} de ${name} copiado.`)} aria-label={`Copiar ${label.toLowerCase()} de ${name}`}>
          <span>{value}</span><Icon name="copy" size={16} />
        </button>
      ) : <small>Pendente</small>}
    </div>
  );
}

function downloadRoster(participants: Participant[]) {
  const roster = participants.map(({ id, name, nickname }) => ({ id, name, nickname: nickname || undefined }));
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, participants: roster }, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "lista-amigo-secreto-2026.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function compressPhoto(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15_000_000) {
    throw new Error("Escolha uma foto JPG, PNG ou WebP de até 15 MB.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a foto.");
    const square = Math.min(bitmap.width, bitmap.height);
    for (const size of [224, 160, 112]) {
      canvas.width = size;
      canvas.height = size;
      context.fillStyle = "#f8f4eb";
      context.fillRect(0, 0, size, size);
      context.drawImage(bitmap, (bitmap.width - square) / 2, (bitmap.height - square) / 2, square, square, 0, 0, size, size);
      const photo = canvas.toDataURL("image/jpeg", 0.76);
      if (photo.length < 95_000) return photo;
    }
    throw new Error("Escolha uma foto menor.");
  } finally {
    bitmap.close();
  }
}

function todayInSaoPaulo() {
  const parts = Object.fromEntries(saoPauloDate.formatToParts().map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default function OrganizerPage() {
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(!isStaticFrontend);
  const [event, setEvent] = useState<Event | null>(null);
  const [roster, setRoster] = useState<Participant[]>([]);
  const [draft, setDraft] = useState<PhotoDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");
  const [changed, setChanged] = useState(false);
  const [pendingDraw, setPendingDraw] = useState<{ filename: string; data: OfflineDraw } | null>(null);
  const [pendingCodes, setPendingCodes] = useState<{ filename: string; data: string[] } | null>(null);
  const [readingDraw, setReadingDraw] = useState(false);
  const [drawError, setDrawError] = useState("");
  const [drawIntent, setDrawIntent] = useState<DrawIntent | null>(null);
  const [auditStep, setAuditStep] = useState<0 | 1 | 2>(0);
  const [auditConfirmation, setAuditConfirmation] = useState("");
  const [auditPairs, setAuditPairs] = useState<AuditPair[] | null>(null);
  const [auditError, setAuditError] = useState("");
  const [month, setMonth] = useState<"all" | "11" | "12">("all");
  const [showAll, setShowAll] = useState(false);
  const participantName = useRef<HTMLInputElement>(null);
  const auditInput = useRef<HTMLInputElement>(null);
  const drawConfirmation = useRef<HTMLDivElement>(null);

  const loadPresence = useCallback(async (signal: AbortSignal) => {
    const { online } = await organizerFetch(key, { action: "prank-presence" }, signal);
    if (!Array.isArray(online)) throw new Error("Não foi possível atualizar quem está online.");
    return online as PresenceMember[];
  }, [key]);

  const sendEffect = useCallback(async (effect: EffectRequest, signal: AbortSignal) => {
    const { ok, target } = await organizerFetch(key, { action: "prank", ...effect }, signal);
    if (ok !== true || !target || typeof target !== "object" || !("name" in target) || typeof target.name !== "string") {
      throw new Error("Não foi possível confirmar o envio do efeito.");
    }
    return target.name;
  }, [key]);

  useEffect(() => {
    if (isStaticFrontend) return;
    const controller = new AbortController();
    organizerRequest("", undefined, controller.signal).then((initialEvent) => {
      setEvent(initialEvent);
      setRoster(initialEvent.participants);
    }).catch(() => {
      // The key form remains available when Sites identity is absent.
    }).finally(() => {
      if (!controller.signal.aborted) setChecking(false);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (draft.id) participantName.current?.focus();
  }, [draft.id]);

  useEffect(() => {
    if (auditStep === 2) auditInput.current?.focus();
  }, [auditStep]);

  useEffect(() => {
    if (drawIntent) drawConfirmation.current?.focus();
  }, [drawIntent]);

  function clearPendingDraw() {
    setPendingDraw(null);
    setPendingCodes(null);
    setDrawError("");
  }

  function closeAudit() {
    setAuditStep(0);
    setAuditConfirmation("");
    setAuditPairs(null);
    setAuditError("");
  }

  function applyEvent(nextEvent: Event) {
    setEvent(nextEvent);
    setRoster(nextEvent.participants);
    setDraft(emptyDraft);
    setChanged(false);
    clearPendingDraw();
    setDrawIntent(null);
    closeAudit();
  }

  async function enter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      applyEvent(await organizerRequest(key.trim()));
      setKey(key.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao abrir o painel.");
    } finally {
      setBusy(false);
    }
  }

  async function update(action?: OrganizerAction | (() => Promise<OrganizerAction>)) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    setDrawError("");
    let payload: OrganizerAction | undefined;
    try {
      payload = typeof action === "function" ? await action() : action;
      const nextEvent = await organizerRequest(key, payload);
      if (payload) applyEvent(nextEvent);
      else {
        setEvent(nextEvent);
        setRoster(nextEvent.participants);
      }
      setMessage(payload?.action === "import" && payload.kind === "test"
        ? "Sorteio de teste ativado."
        : payload ? updateMessages[payload.action] : "Respostas e acessos atualizados.");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Falha ao atualizar o painel.";
      if (typeof action === "function" || payload?.action === "import" || payload?.action === "register-codes"
        || payload?.action === "cancel-draw" || payload?.action === "reset-draw") setDrawError(detail);
      else if (payload?.action === "edit-profile") setFormError(detail);
      else setError(detail);
    } finally {
      setBusy(false);
    }
  }

  function reviewDraw(intent: DrawIntent) {
    setDrawError("");
    setDrawIntent(intent);
  }

  function confirmDraw() {
    if (!drawIntent || !canConfirmDraw) return;
    if (drawIntent.action === "generate" && savedRoster) {
      const roster = savedRoster.map(({ id, name, nickname }) => ({ id, name, nickname: nickname || undefined }));
      const kind = drawIntent.kind;
      void update(async () => {
        const { draw, distribution } = await createOfflineDraw(roster);
        return { action: "import", draw, drawCodes: distribution.map(({ code }) => code), kind };
      });
    } else if (drawIntent.action === "import" && pendingDraw && pendingCodes) {
      void update({ action: "import", draw: pendingDraw.data, drawCodes: pendingCodes.data, kind: drawIntent.kind });
    } else if (drawIntent.action === "cancel-draw" || drawIntent.action === "reset-draw") {
      void update(drawIntent);
    }
  }

  function saveDraft() {
    if (!canSaveDraft) return;
    const savedIds = new Set(savedRoster?.map(({ id }) => id));
    const participants = roster.map(({ id, name, nickname, photo, steamCode, games }) => ({
      id: savedIds.has(id) ? id : undefined,
      name, nickname, photo, steamCode, games,
    }));
    void update({ action: "save", participants });
  }

  async function revealAudit() {
    if (!drawn || busy || auditStep !== 2 || auditConfirmation.trim().toUpperCase() !== "REVELAR") return;
    setBusy(true);
    setAuditError("");
    try {
      const data = await organizerFetch(key, { action: "audit", confirmation: "REVELAR" });
      if (!Array.isArray(data.pairs)) throw new Error("Não foi possível carregar os pares.");
      setAuditPairs(data.pairs as AuditPair[]);
      setAuditStep(0);
      setAuditConfirmation("");
    } catch (cause) {
      setAuditError(cause instanceof Error ? cause.message : "Não foi possível carregar os pares.");
    } finally {
      setBusy(false);
    }
  }

  async function stageDraw(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !readyForDraw || !savedRoster) return;
    setDrawIntent(null);
    setPendingDraw(null);
    setDrawError("");
    if (file.size > 16_384) {
      setDrawError("Selecione o resultado protegido da ferramenta offline. O arquivo deve ter até 16 KB.");
      return;
    }
    setReadingDraw(true);
    try {
      const data = parseOfflineDraw(await file.text(), savedRoster);
      setPendingDraw({ filename: file.name, data });
    } catch (cause) {
      setDrawError(cause instanceof Error && !(cause instanceof SyntaxError) ? cause.message : "Não foi possível ler o resultado protegido. Selecione o arquivo JSON gerado pela ferramenta offline.");
    } finally {
      setReadingDraw(false);
    }
  }

  async function stageCodes(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || (!readyForDraw && !canRegisterCodes)) return;
    setDrawIntent(null);
    setPendingCodes(null);
    setDrawError("");
    if (file.size > 16_384) {
      setDrawError("Selecione o arquivo de códigos da ferramenta offline. O arquivo deve ter até 16 KB.");
      return;
    }
    setReadingDraw(true);
    try {
      const data = parseDrawCodes(await file.text(), roster.length);
      setPendingCodes({ filename: file.name, data });
    } catch (cause) {
      setDrawError(cause instanceof Error ? cause.message : "Não foi possível ler o arquivo de códigos.");
    } finally {
      setReadingDraw(false);
    }
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setPhotoBusy(true);
    setFormError("");
    try {
      const photo = await compressPhoto(file);
      setDraft((current) => ({ ...current, photo }));
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Não foi possível abrir a foto.");
    } finally {
      setPhotoBusy(false);
    }
  }

  function editParticipant(person: Participant) {
    setDraft({ ...person, accessed: Boolean(person.accessedAt), revealed: Boolean(person.revealedAt) });
    setFormError("");
  }

  function saveParticipant(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const name = draft.name.trim();
    if (!name || !draft.photo) {
      setFormError("Preencha o nome e selecione uma foto.");
      return;
    }
    if (roster.length >= 32 && !draft.id) {
      setFormError("A lista pode ter até 32 participantes.");
      return;
    }
    const steamCode = draft.steamCode?.trim() ?? "";
    if (steamCode && !isSteamFriendCode(steamCode)) {
      setFormError("Informe um código de amigo da Steam válido.");
      return;
    }
    setFormError("");
    const profile = { name, nickname: draft.nickname?.trim() ?? "", photo: draft.photo, steamCode, games: draft.games ?? [] };
    const previous = roster.find(({ id }) => id === draft.id);
    if (locked) {
      if (!previous) return;
      const accessCode = draft.accessCode ?? "";
      if (accessCode && !/^\d{20}$/.test(accessCode)) {
        setFormError("O código de acesso deve ter 20 dígitos.");
        return;
      }
      void update({
        action: "edit-profile",
        participantId: previous.id,
        ...profile,
        accessCode: accessCode !== (previous.accessCode ?? "") ? accessCode : undefined,
        accessed: draft.accessed !== Boolean(previous.accessedAt) ? draft.accessed : undefined,
        revealed: draft.revealed !== Boolean(previous.revealedAt) ? draft.revealed : undefined,
      });
      return;
    }
    const participant = {
      ...previous,
      id: draft.id ?? crypto.randomUUID(),
      ...profile,
      responded: previous?.responded ?? false,
    };
    setRoster((current) => draft.id ? current.map((entry) => entry.id === draft.id ? participant : entry) : [...current, participant]);
    setChanged(true);
    clearPendingDraw();
    setDraft(emptyDraft);
  }

  async function copy(value: string, copiedMessage: string) {
    setError("");
    try {
      await navigator.clipboard.writeText(value);
      setMessage(copiedMessage);
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione e copie o texto manualmente.");
    }
  }

  function leave() {
    setEvent(null);
    setKey("");
    setRoster([]);
    setDraft(emptyDraft);
    setError("");
    setFormError("");
    setMessage("");
    clearPendingDraw();
    setDrawIntent(null);
    closeAudit();
    setChanged(false);
  }

  const drawStatus = event?.drawStatus ?? (event?.phase === "drawn" ? "definitive" : "draft");
  const locked = drawStatus !== "draft";
  const drawn = drawStatus === "test" || drawStatus === "definitive";
  const offline = drawn && event?.drawMethod === "offline";
  const missingAccessCodes = roster.some(({ accessCode }) => !accessCode);
  const missingDrawCodes = offline && roster.some(({ code }) => !code);
  const responseCount = event?.responseCount ?? 0;
  const pending = roster.length - responseCount;
  const today = todayInSaoPaulo();
  const commonDays = event?.dates.filter((day) => day.date >= today && day.unavailable === 0 && pending === 0).length ?? 0;
  const rankedDates = (event?.dates ?? [])
    .filter((day) => month === "all" || day.date.slice(5, 7) === month)
    .sort((first, second) => Number(first.date < today) - Number(second.date < today) || first.unavailable - second.unavailable || first.date.localeCompare(second.date));
  const draftInProgress = Boolean(draft.id || draft.name || draft.nickname || draft.photo || draft.steamCode || draft.games?.length);
  const savedRoster = event && !locked ? event.participants : null;
  const editing = changed || draftInProgress || photoBusy;
  const canSaveDraft = changed && !draftInProgress && !photoBusy && !busy && !readingDraw;
  const readyForDraw = Boolean(savedRoster && savedRoster.length >= 2 && !editing && !busy && !readingDraw);
  const canRegisterCodes = missingDrawCodes && !editing && !busy && !readingDraw;
  const canConfirmDraw = drawIntent?.action === "generate" ? readyForDraw
    : drawIntent?.action === "import" ? readyForDraw && Boolean(pendingDraw && pendingCodes)
      : !busy && !editing && !readingDraw && (drawIntent?.action === "cancel-draw"
        ? drawStatus === "definitive"
        : drawIntent?.action === "reset-draw" && (drawStatus === "test" || drawStatus === "cancelled"));
  const canRefresh = Boolean(event && !editing && !busy && !readingDraw && !pendingDraw && !pendingCodes && !drawIntent && auditStep === 0 && !auditPairs);

  useEffect(() => {
    if (!canRefresh) return;
    let pending: AbortController | null = null;

    async function refresh() {
      if (document.visibilityState !== "visible" || pending) return;
      const controller = new AbortController();
      pending = controller;
      try {
        const nextEvent = await organizerRequest(key, undefined, controller.signal);
        if (!controller.signal.aborted) {
          setEvent(nextEvent);
          setRoster(nextEvent.participants);
        }
      } catch {
        // Background failures leave the current view in place.
      } finally {
        if (pending === controller) pending = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void refresh();
      else pending?.abort();
    }

    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      pending?.abort();
    };
  }, [canRefresh, key]);

  const confirmation = drawIntent && drawConfirmations["kind" in drawIntent ? drawIntent.kind : drawIntent.action];
  const confirmationPanel = confirmation && (
    <div className={styles.warning} ref={drawConfirmation} tabIndex={-1} role="group" aria-labelledby="draw-confirmation-title">
      <strong id="draw-confirmation-title">{confirmation.title}</strong>
      <p>{confirmation.detail}</p>
      <div className={styles.formActions}>
        <button className={styles.primary} type="button" onClick={confirmDraw} disabled={!canConfirmDraw}>{busy ? "Processando…" : confirmation.button}</button>
        <button className={styles.textButton} type="button" onClick={() => { setDrawIntent(null); setDrawError(""); }} disabled={busy}>Voltar</button>
      </div>
    </div>
  );

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <a className={styles.brand} href={participantPage}>
          <span className={styles.brandIcon}><Icon name="gift" /></span>
          <span>Amigo Secreto <small>2026</small></span>
        </a>
        <div className={styles.topbarActions}>
          {event && key && <button type="button" className={styles.textButton} onClick={leave} disabled={busy || readingDraw}>Sair do painel</button>}
          <ThemeToggle />
        </div>
      </header>

      {!event ? (
        <main className={styles.gate}>
          <a className={styles.back} href={participantPage}><Icon name="arrow" size={16} /> Voltar à página do participante</a>
          <div className={styles.gateCard}>
            <div className={styles.gateIcon}><Icon name="lock" size={25} /></div>
            <p className={styles.eyebrow}>Área restrita</p>
            <h1>Painel da organização</h1>
            <p>Cadastre o grupo, faça o sorteio e acompanhe os dias em que todos podem participar.</p>
            {checking ? (
              <p className={styles.calendarHint} role="status">Verificando acesso…</p>
            ) : (
              <>
                {!isStaticFrontend && <a className={styles.signIn} href="/signin-with-chatgpt?return_to=%2Forganizar" target="_top">Entrar com ChatGPT</a>}
                <form className={styles.form} onSubmit={enter}>
                  <label htmlFor="organizer-key">Chave do organizador</label>
                  <input id="organizer-key" type="password" autoComplete="current-password" value={key} onChange={(event) => setKey(event.target.value)} required />
                  {error && <p className={styles.error} role="alert">{error}</p>}
                  <button type="submit" className={isStaticFrontend ? styles.primary : styles.secondary} disabled={busy}>{busy ? "Abrindo…" : "Acessar com chave"}</button>
                </form>
              </>
            )}
          </div>
        </main>
      ) : (
        <main className={styles.dashboard}>
          <a className={styles.back} href={participantPage}><Icon name="arrow" size={16} /> Página do participante</a>
          <div className={styles.hero}>
            <div>
              <p className={styles.eyebrow}>Amigo secreto · Novembro e dezembro de 2026</p>
              <h1>Painel da organização</h1>
              <p>{drawn ? "Compartilhe os códigos, acompanhe os acessos e confira as respostas do grupo." : locked ? "Gerencie os perfis ou volte à preparação para um novo sorteio." : "Prepare os perfis, gere os acessos e escolha o tipo de sorteio."}</p>
            </div>
            <span className={`${styles.phase} ${drawStatus === "test" ? styles.phaseTest : drawStatus === "cancelled" ? styles.phaseCancelled : ""}`}>{phaseLabels[drawStatus]}</span>
          </div>

          {error && <p className={styles.error} role="alert">{error}</p>}
          {message && <p className={styles.success} role="status"><Icon name="check" size={17} /> {message}</p>}

          {drawn && (
            <section className={styles.stats} aria-label="Resumo do grupo">
              <div><span>Participantes</span><strong>{roster.length}</strong></div>
              <div><span>Respostas recebidas</span><strong>{responseCount}<small> / {roster.length}</small></strong></div>
              <div><span>Datas futuras livres para todos</span><strong>{pending === 0 ? commonDays : "—"}</strong></div>
            </section>
          )}

          <AnnouncementComposer organizerKey={key} />
          <PresencePanel loadPresence={loadPresence} sendEffect={sendEffect} />

          <div className={styles.grid}>
            <section className={styles.card} aria-labelledby="participants-title">
              <div className={styles.sectionHeading}>
                <span className={styles.sectionIcon}><Icon name="people" /></span>
                <div>
                  <h2 id="participants-title">Participantes</h2>
                  <p>{drawn ? "Envie os dois códigos de cada pessoa em particular." : `${roster.length} de 32 · Perfis e códigos de acesso`}</p>
                </div>
              </div>

              {roster.length > 0 && missingAccessCodes && (
                <div className={styles.accessTools}>
                  <button className={styles.secondary} type="button" onClick={() => update({ action: "credentials" })} disabled={editing || busy || readingDraw || Boolean(drawIntent)}>Gerar códigos de acesso faltantes</button>
                  <p className={styles.calendarHint}>{changed ? "Salve a lista para gerar os códigos." : "Os códigos já gerados continuam válidos."}</p>
                </div>
              )}

              {roster.length === 0 ? (
                <p className={styles.empty}>Adicione pelo menos duas pessoas para começar.</p>
              ) : (
                <ul className={styles.roster}>
                  {roster.map((person) => (
                    <li key={person.id}>
                      <div className={styles.personRow}>
                        <img className={styles.avatar} src={person.photo} alt="" width={44} height={44} />
                        <div className={styles.person}>
                          <strong>{person.name}</strong>
                          {person.nickname && <small>Discord · {person.nickname}</small>}
                          {person.steamCode && <small>Steam · {person.steamCode}</small>}
                        </div>
                        <div className={styles.rowActions}>
                          <button className={styles.textButton} type="button" aria-label={`Editar ${person.name}`} disabled={busy || photoBusy || Boolean(draft.id && draft.id !== person.id)} onClick={() => editParticipant(person)}>Editar</button>
                          {!locked && <button className={styles.remove} type="button" aria-label={`Remover ${person.name}`} disabled={busy || photoBusy} onClick={() => {
                            setRoster((current) => current.filter((entry) => entry.id !== person.id));
                            if (draft.id === person.id) setDraft(emptyDraft);
                            setChanged(true);
                            clearPendingDraw();
                          }}>Remover</button>}
                        </div>
                      </div>
                      {(locked || person.accessCode) && (
                        <div className={styles.credentialGrid}>
                          <CopyCode label="Código de acesso" name={person.name} value={person.accessCode} copy={copy} />
                          {drawn && <CopyCode label="Código do sorteio" name={person.name} value={person.code} copy={copy} />}
                        </div>
                      )}
                      {(locked || person.accessCode) && (
                        <div className={styles.badges} aria-label={`Acompanhamento de ${person.name}`}>
                          <TrackingBadge label="Acessou" empty="Acesso pendente" date={person.accessedAt} />
                          <TrackingBadge label="Viu o sorteio" empty="Revelação pendente" date={person.revealedAt} />
                          {locked && <span className={`${styles.badge} ${person.responded ? styles.badgeDone : ""}`}>{person.responded ? "Disponibilidade enviada" : "Disponibilidade pendente"}</span>}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {missingDrawCodes && (
                <div className={styles.confirm}>
                  <strong>Registre os códigos do sorteio offline</strong>
                  <p>Use <b>codigos-amigo-secreto-2026.txt</b> da ferramenta offline para exibir os códigos no painel e habilitar a consulta dos pares.</p>
                  <div className={styles.drawFile}>
                    <label htmlFor="active-draw-codes">Arquivo de códigos do sorteio</label>
                    <input id="active-draw-codes" type="file" accept=".txt,text/plain" onChange={stageCodes} disabled={!canRegisterCodes} />
                  </div>
                  {readingDraw && <p role="status">Verificando o arquivo…</p>}
                  {drawError && <p className={styles.error} role="alert">{drawError}</p>}
                  {pendingCodes && (
                    <>
                      <p className={styles.filename} role="status"><b>{pendingCodes.filename}</b></p>
                      <div className={styles.formActions}>
                        <button className={styles.primary} type="button" onClick={() => { if (canRegisterCodes) update({ action: "register-codes", drawCodes: pendingCodes.data }); }} disabled={!canRegisterCodes}>Registrar códigos</button>
                        <button className={styles.textButton} type="button" onClick={clearPendingDraw} disabled={busy}>Remover arquivo</button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {drawn && (
                <div className={styles.share}>
                  <button type="button" className={styles.secondary} onClick={() => copy(new URL(participantPage, window.location.origin).href, "Link do participante copiado.")}><Icon name="copy" size={16} /> Copiar link do participante</button>
                  <a href={participantPage}>Abrir página do participante</a>
                </div>
              )}
              {(!locked || draft.id) && (
                <form className={styles.participantForm} onSubmit={saveParticipant}>
                  <h3>{draft.id ? "Editar participante" : "Adicionar participante"}</h3>
                  <label htmlFor="participant-name">Nome</label>
                  <input id="participant-name" ref={participantName} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ex. Mariana" maxLength={70} required disabled={busy} />
                  <label htmlFor="participant-nickname">Nick no Discord (opcional)</label>
                  <input id="participant-nickname" value={draft.nickname ?? ""} onChange={(event) => setDraft((current) => ({ ...current, nickname: event.target.value }))} maxLength={70} autoCapitalize="none" spellCheck={false} disabled={busy} />
                  <label htmlFor="participant-photo">Foto</label>
                  <div className={styles.photoUpload}>
                    {draft.photo && <img className={styles.avatar} src={draft.photo} alt="Prévia da foto" width={44} height={44} />}
                    <input id="participant-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPhoto} disabled={busy || photoBusy} />
                  </div>
                  <label htmlFor="participant-steam-code">Código de amigo da Steam (opcional)</label>
                  <input id="participant-steam-code" value={draft.steamCode ?? ""} onChange={(event) => setDraft((current) => ({ ...current, steamCode: event.target.value.replace(/\D/g, "").slice(0, 10) }))} inputMode="numeric" disabled={busy} />
                  <SteamPicker key={draft.id ?? "new"} games={draft.games ?? []} onChange={(games) => setDraft((current) => ({ ...current, games }))} disabled={busy} />
                  {locked && (
                    <fieldset className={styles.trackingEditor} disabled={busy}>
                      <legend>Acesso e revelação</legend>
                      <label htmlFor="participant-access-code">Código de acesso</label>
                      <input id="participant-access-code" value={draft.accessCode ?? ""} onChange={(event) => setDraft((current) => ({ ...current, accessCode: event.target.value.replace(/\D/g, "").slice(0, 20) }))} inputMode="numeric" />
                      <label className={styles.checkbox}><input type="checkbox" checked={draft.accessed ?? false} onChange={(event) => setDraft((current) => ({ ...current, accessed: event.target.checked }))} /> Acessou com o código</label>
                      <label className={styles.checkbox}><input type="checkbox" checked={draft.revealed ?? false} onChange={(event) => setDraft((current) => ({ ...current, revealed: event.target.checked }))} /> Viu o próprio resultado</label>
                    </fieldset>
                  )}
                  {formError && <p className={styles.error} role="alert">{formError}</p>}
                  <div className={styles.formActions}>
                    <button className={styles.primary} type="submit" disabled={busy || photoBusy}>{photoBusy ? "Preparando foto…" : locked ? "Salvar perfil" : draft.id ? "Aplicar edição" : "Adicionar à lista"}</button>
                    {draftInProgress && <button className={styles.textButton} type="button" onClick={() => { setDraft(emptyDraft); setFormError(""); }} disabled={busy || photoBusy}>Cancelar</button>}
                  </div>
                </form>
              )}
            </section>

            {locked ? (
              <div className={styles.column}>
                <section className={styles.card} aria-labelledby="draw-lifecycle-title">
                  <div className={styles.sectionHeading}>
                    <span className={styles.sectionIcon}><Icon name="gift" /></span>
                    <div>
                      <h2 id="draw-lifecycle-title">{phaseLabels[drawStatus]}</h2>
                      <p>{drawStatus === "test" ? "Este sorteio serve para testar o fluxo antes do evento definitivo." : drawStatus === "cancelled" ? "Volte à preparação para liberar um novo sorteio." : "Os códigos podem ser distribuídos individualmente aos participantes."}</p>
                    </div>
                  </div>
                  {drawIntent ? confirmationPanel : (
                    <div className={styles.formActions}>
                      {drawStatus === "definitive" ? (
                        <button className={styles.secondary} type="button" onClick={() => reviewDraw({ action: "cancel-draw" })} disabled={busy || editing || readingDraw}>Cancelar sorteio definitivo</button>
                      ) : (
                        <button className={styles.secondary} type="button" onClick={() => reviewDraw({ action: "reset-draw" })} disabled={busy || editing || readingDraw}>Resetar sorteio</button>
                      )}
                    </div>
                  )}
                  {drawIntent && drawError && <p className={styles.error} role="alert">{drawError}</p>}
                </section>
                {drawn && (
                  <>
                  <section className={styles.card} aria-labelledby="dates-title">
                    <div className={styles.sectionHeading}>
                      <span className={styles.sectionIcon}><Icon name="calendar" /></span>
                      <div>
                        <h2 id="dates-title">Melhores datas</h2>
                        <p>{pending ? `${pending} ${pending === 1 ? "pessoa ainda não respondeu" : "pessoas ainda não responderam"}.` : "Todas as pessoas responderam."}</p>
                      </div>
                    </div>
                    <div className={styles.calendarActions}>
                      <label htmlFor="month-filter" className={styles.srOnly}>Filtrar por mês</label>
                      <select id="month-filter" value={month} onChange={(event) => { setMonth(event.target.value as typeof month); setShowAll(false); }}>
                        <option value="all">Novembro e dezembro</option>
                        <option value="11">{months["11"]}</option>
                        <option value="12">{months["12"]}</option>
                      </select>
                      <button type="button" className={styles.secondary} onClick={() => update()} disabled={busy || editing || readingDraw || Boolean(pendingCodes || drawIntent)}>{busy ? "Atualizando…" : "Atualizar painel"}</button>
                    </div>
                    <p className={styles.calendarHint}>As próximas datas com menos impedimentos aparecem primeiro.</p>
                    <div className={styles.tableWrap}>
                      <table className={styles.dateTable}>
                        <thead><tr><th scope="col">Dia</th><th scope="col">Livres</th><th scope="col">Impedidos</th><th scope="col">Pendentes</th></tr></thead>
                        <tbody>
                          {rankedDates.slice(0, showAll ? rankedDates.length : 8).map((day) => {
                            const past = day.date < today;
                            const allFree = !past && pending === 0 && day.unavailable === 0;
                            return (
                              <tr key={day.date}>
                                <th scope="row">
                                  {dateFormatter.format(new Date(`${day.date}T12:00:00Z`))}
                                  {allFree && <small className={styles.free}><Icon name="check" size={12} /> Todos livres</small>}
                                  {past && <small>Data passada</small>}
                                </th>
                                <td>{day.available}</td>
                                <td>{day.unavailable}</td>
                                <td>{pending}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {rankedDates.length > 8 && <button type="button" className={styles.textButton} onClick={() => setShowAll((value) => !value)}>{showAll ? "Mostrar menos datas" : `Ver todas as ${rankedDates.length} datas`}</button>}
                  </section>
                  <section className={styles.card} aria-labelledby="audit-title">
                    <div className={styles.sectionHeading}>
                      <span className={styles.sectionIcon}><Icon name="lock" /></span>
                      <div>
                        <h2 id="audit-title">Consulta reservada</h2>
                        <p>Abra a lista completa de pares quando precisar conferir o sorteio.</p>
                      </div>
                    </div>
                    {auditError && <p className={styles.error} role="alert">{auditError}</p>}
                    {auditPairs && (
                      <>
                        <ul className={styles.pairs} aria-label="Pares do sorteio">
                          {auditPairs.map(({ giver, recipient }) => (
                            <li key={giver.id}>
                              <span><b>{giver.name}</b>{giver.nickname && <small>{giver.nickname}</small>}</span>
                              <span className={styles.pairAction}>tirou</span>
                              <span><b>{recipient.name}</b>{recipient.nickname && <small>{recipient.nickname}</small>}</span>
                            </li>
                          ))}
                        </ul>
                        <div className={styles.formActions}>
                          <button className={styles.secondary} type="button" onClick={closeAudit}>Ocultar os pares</button>
                        </div>
                      </>
                    )}
                    {!auditPairs && auditStep === 0 && (
                      <div className={styles.formActions}>
                        <button className={styles.secondary} type="button" onClick={() => setAuditStep(1)} disabled={busy || missingDrawCodes}>Ver quem tirou quem</button>
                        {missingDrawCodes && <p className={styles.calendarHint}>Registre os códigos do sorteio para liberar a consulta.</p>}
                      </div>
                    )}
                    {auditStep === 1 && (
                      <div className={styles.warning}>
                        <strong>Primeiro aviso · Surpresa do grupo</strong>
                        <p>Ao continuar, você poderá ver todas as combinações, inclusive quem tirou você.</p>
                        <div className={styles.formActions}>
                          <button className={styles.secondary} type="button" onClick={() => setAuditStep(2)}>Continuar para confirmação</button>
                          <button className={styles.textButton} type="button" onClick={closeAudit}>Cancelar</button>
                        </div>
                      </div>
                    )}
                    {auditStep === 2 && (
                      <form className={styles.warning} onSubmit={(event) => { event.preventDefault(); void revealAudit(); }}>
                        <strong>Segundo aviso · Exibição dos nomes</strong>
                        <p>As combinações ficarão visíveis nesta tela até você ocultá-las. Confirme em um local privado.</p>
                        <div className={styles.auditField}>
                          <label htmlFor="audit-confirmation">Digite REVELAR para confirmar</label>
                          <input id="audit-confirmation" ref={auditInput} value={auditConfirmation} onChange={(event) => setAuditConfirmation(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy} />
                        </div>
                        <div className={styles.formActions}>
                          <button className={styles.primary} type="submit" disabled={busy || auditConfirmation.trim().toUpperCase() !== "REVELAR"}>{busy ? "Revelando…" : "Confirmar e revelar os pares"}</button>
                          <button className={styles.textButton} type="button" onClick={closeAudit} disabled={busy}>Cancelar</button>
                        </div>
                      </form>
                    )}
                  </section>
                  </>
                )}
              </div>
            ) : (
              <section className={styles.card} aria-labelledby="draw-title">
                <div className={styles.sectionHeading}>
                  <span className={styles.sectionIcon}><Icon name="gift" /></span>
                  <div>
                    <h2 id="draw-title">Preparar sorteio</h2>
                    <p>Salve uma lista com pelo menos duas pessoas para gerar o sorteio neste navegador.</p>
                  </div>
                </div>
                <div className={styles.formActions}>
                  <button className={styles.secondary} type="button" onClick={saveDraft} disabled={!canSaveDraft}>Salvar rascunho</button>
                  <button className={styles.secondary} type="button" onClick={() => reviewDraw({ action: "generate", kind: "test" })} disabled={!readyForDraw || Boolean(drawIntent)}>Fazer sorteio de teste</button>
                  <button className={styles.primary} type="button" onClick={() => reviewDraw({ action: "generate", kind: "definitive" })} disabled={!readyForDraw || Boolean(drawIntent)}>Fazer sorteio definitivo</button>
                </div>
                {draftInProgress && <p className={styles.calendarHint}>Conclua ou cancele a edição do participante antes de continuar.</p>}
                {changed && !draftInProgress && <p className={styles.calendarHint}>Salve o rascunho para usar a versão atual da lista.</p>}
                {drawIntent?.action !== "import" && confirmationPanel}
                {drawError && <p className={styles.error} role="alert">{drawError}</p>}
                <details className={styles.offlinePanel}>
                  <summary>Importar sorteio feito na ferramenta offline</summary>
                  <ol className={styles.steps}>
                    <li>
                      <span>1</span>
                      <div>
                        <strong>Baixe a lista salva</strong>
                        <p>Cadastre pelo menos duas pessoas. Se a lista mudar depois de baixar, salve e gere um novo resultado.</p>
                        <div className={styles.formActions}>
                          <button className={styles.secondary} type="button" onClick={() => { if (readyForDraw && savedRoster) downloadRoster(savedRoster); }} disabled={!readyForDraw}>Baixar lista salva</button>
                        </div>
                      </div>
                    </li>
                    <li>
                      <span>2</span>
                      <div>
                        <strong>Faça o sorteio no seu dispositivo</strong>
                        <p>Abra a ferramenta baixada, importe a lista salva e baixe os dois arquivos gerados.</p>
                        <div className={styles.formActions}>
                          <a className={styles.secondary} href={assetUrl("/sorteio-offline.html")} download="sorteio-offline.html">Baixar ferramenta offline</a>
                        </div>
                      </div>
                    </li>
                    <li>
                      <span>3</span>
                      <div>
                        <strong>Envie o resultado e os códigos</strong>
                        <p>Selecione <b>sorteio-criptografado-2026.json</b> e <b>codigos-amigo-secreto-2026.txt</b> para revisar e ativar.</p>
                        <div className={styles.drawFile}>
                          <label htmlFor="protected-draw">Arquivo de resultado protegido</label>
                          <input id="protected-draw" type="file" accept=".json,application/json" onChange={stageDraw} disabled={!readyForDraw} />
                        </div>
                        <div className={styles.drawFile}>
                          <label htmlFor="draw-codes">Arquivo de códigos do sorteio</label>
                          <input id="draw-codes" type="file" accept=".txt,text/plain" onChange={stageCodes} disabled={!readyForDraw} />
                        </div>
                      </div>
                    </li>
                  </ol>
                  {readingDraw && <p className={styles.calendarHint} role="status">Verificando o arquivo…</p>}
                  {(pendingDraw || pendingCodes) && (
                    <div className={styles.confirm}>
                      <strong>{pendingDraw && pendingCodes ? "Resultado pronto para ativar" : "Selecione os dois arquivos"}</strong>
                      <div className={styles.filename} role="status">
                        {pendingDraw && <p>Resultado · <b>{pendingDraw.filename}</b></p>}
                        {pendingCodes && <p>Códigos · <b>{pendingCodes.filename}</b></p>}
                      </div>
                      <p>Escolha se os arquivos devem ativar um sorteio de teste ou o definitivo.</p>
                      <div className={styles.formActions}>
                        <button className={styles.secondary} type="button" onClick={() => reviewDraw({ action: "import", kind: "test" })} disabled={!readyForDraw || !pendingDraw || !pendingCodes || Boolean(drawIntent)}>Importar como teste</button>
                        <button className={styles.primary} type="button" onClick={() => reviewDraw({ action: "import", kind: "definitive" })} disabled={!readyForDraw || !pendingDraw || !pendingCodes || Boolean(drawIntent)}>Importar como definitivo</button>
                        <button className={styles.textButton} type="button" onClick={() => { clearPendingDraw(); setDrawIntent(null); }} disabled={busy || readingDraw}>Limpar seleção</button>
                      </div>
                    </div>
                  )}
                  {drawIntent?.action === "import" && confirmationPanel}
                </details>
              </section>
            )}
          </div>
        </main>
      )}
      <footer className={styles.footer}>Amigo Secreto <span>·</span> 2026</footer>
    </div>
  );
}
