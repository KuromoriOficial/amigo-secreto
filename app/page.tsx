"use client";

import { ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, Download, FlaskConical, Gift, KeyRound, LockKeyhole, LogOut, Sparkles, UserRound, UsersRound, Volume2, VolumeX } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, assetUrl, pageUrl } from "../lib/frontend-paths";
import type { SteamGame } from "../lib/steam-games";
import ParticipantProfile, { GameTiles, SteamDirectory, type Participant, type ParticipantDraft, type SteamFriend } from "./participant-profile";
import { playAdvancementAudio, playRollingAudio, prepareRevealAudio, ProfilePhoto, profilePhotoUrl, REDUCED_MOTION, RevealConfetti, Roulette, rouletteFrames, type Profile, type RevealAudio } from "./reveal-effects";
import MemberProfiles from "./member-profiles";
import GroupChat from "./group-chat";
import ThemeToggle from "./theme-toggle";

const YEAR = 2026;
const MONTHS = [
  { index: 10, name: "Novembro" },
  { index: 11, name: "Dezembro" },
] as const;
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DEMO_CODE = "482731";
const DEMO_AVAILABILITY = `amigo-secreto-${YEAR}-demo-days`;
const BROWSER_SESSION = `amigo-secreto-${YEAR}-participant-session`;
const PORTFOLIO_URL = "https://kuromorioficial.github.io/KuromoriOficial/";
const DATE_LABEL = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" });

type Mode = "demo" | "live";
type DrawStatus = "draft" | "test" | "definitive" | "cancelled";
type Round = { drawStatus?: DrawStatus; drawId?: string };
type PublicEvent = Round & { mode: Mode };
type SessionAuth = { sessionToken: string } | { accessCode: typeof DEMO_CODE };
type StoredSession = { token: string } | { demo: true; profile?: ParticipantDraft; opened?: boolean };
type ParticipantResponse = PublicEvent & {
  participant: Participant;
  profileComplete: boolean;
  sessionToken?: string;
  result?: RevealResult;
};
type ParticipantSession = Pick<ParticipantResponse, "participant" | "mode" | "profileComplete"> & { auth: SessionAuth };
type RevealResult = PublicEvent & { person: Profile & { games?: SteamGame[] }; candidates?: Profile[]; steamFriends?: SteamFriend[]; canSave: boolean; days: string[]; availabilitySaved?: boolean };
type RevealAttempt = RevealResult & { auth: SessionAuth; code?: string; restored?: boolean };
type RevealReel = { attempt: RevealAttempt; frames: Profile[] };
type SavedCalendar = { days: readonly string[]; download: "ready" | "loading" | "failed" };

class RequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function readStoredSession(): StoredSession | null {
  try {
    const session = JSON.parse(localStorage.getItem(BROWSER_SESSION) ?? "null") as StoredSession | null;
    if (session && typeof session === "object" && ("token" in session ? typeof session.token === "string" && session.token.length > 0 : session.demo === true)) return session;
  } catch {
    // Browser storage can be unavailable.
  }
  return null;
}

function writeStoredSession(session: StoredSession | null) {
  try {
    if (session) localStorage.setItem(BROWSER_SESSION, JSON.stringify(session));
    else localStorage.removeItem(BROWSER_SESSION);
  } catch {
    // The current tab still works without browser storage.
  }
}

function sessionKey(session: StoredSession | null) {
  return session && ("token" in session ? session.token : "demo");
}
async function post<T>(endpoint: string, payload: object, signal?: AbortSignal, keepalive = false): Promise<T> {
  const response = await fetch(apiUrl(endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
    keepalive,
  });
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !data) {
    throw new RequestError(response.status, typeof data?.error === "string" ? data.error : "Não foi possível concluir. Tente de novo em instantes.");
  }
  return data;
}

async function readPublicEvent(signal: AbortSignal): Promise<PublicEvent | null> {
  try {
    const response = await fetch(apiUrl("/api/event"), { signal, cache: "no-store" });
    const event = response.ok ? await response.json() as PublicEvent : null;
    return event?.mode === "demo" || event?.mode === "live" ? event : null;
  } catch {
    return null;
  }
}

function roundChanged(attempt: RevealAttempt, event: PublicEvent) {
  if (attempt.mode === "demo") return event.mode !== "demo";
  if (!event.drawStatus) return false;
  return (event.drawStatus !== "test" && event.drawStatus !== "definitive") ||
    (attempt.drawStatus !== undefined && event.drawStatus !== attempt.drawStatus) ||
    (attempt.drawId !== undefined && event.drawId !== attempt.drawId);
}

function demoDays(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(DEMO_AVAILABILITY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((value): value is string => (
      typeof value === "string" && /^2026-(11|12)-(0[1-9]|[12][0-9]|3[01])$/.test(value)
    )) : [];
  } catch {
    return [];
  }
}

function hasDemoCalendar() {
  try {
    return localStorage.getItem(DEMO_AVAILABILITY) !== null;
  } catch {
    return false;
  }
}

function MemeFigure({ person }: { person: Profile }) {
  const [failed, setFailed] = useState(false);
  if (!person.photo || failed) return null;

  return (
    <figure className="as-meme">
      <img src={profilePhotoUrl(person.photo)} alt={`Meme de ${person.name}`} onError={() => setFailed(true)} />
    </figure>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>();
  const [drawStatus, setDrawStatus] = useState<DrawStatus>();
  const [roundNotice, setRoundNotice] = useState("");
  const [accessInput, setAccessInput] = useState("");
  const [account, setAccount] = useState<ParticipantSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);
  const [code, setCode] = useState("");
  const [revealed, setRevealed] = useState<RevealAttempt | null>(null);
  const [reel, setReel] = useState<RevealReel | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [month, setMonth] = useState(0);
  const [loadingReveal, setLoadingReveal] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revealError, setRevealError] = useState("");
  const [seenError, setSeenError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [savedCalendar, setSavedCalendar] = useState<SavedCalendar | null>(null);
  const accessField = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const revealOutput = useRef<HTMLDivElement>(null);
  const loginRequest = useRef<AbortController | null>(null);
  const browserSession = useRef<StoredSession | null>(null);
  const revealRequest = useRef<AbortController | null>(null);
  const seenRequest = useRef<AbortController | null>(null);
  const saveRequest = useRef<AbortController | null>(null);
  const downloadRequest = useRef<AbortController | null>(null);
  const revealAudio = useRef<RevealAudio | null>(null);
  const roundRevision = useRef(0);
  const checkOpenRound = useRef<(() => void) | null>(null);
  const openAttempt = useRef<RevealAttempt | null>(null);

  const stopRevealAudio = useCallback(() => {
    const audio = revealAudio.current;
    revealAudio.current = null;
    if (audio && audio.context.state !== "closed") void audio.context.close().catch(() => {});
  }, []);

  const rememberDrawStatus = useCallback((status?: DrawStatus) => {
    if (status) {
      roundRevision.current += 1;
      setDrawStatus(status);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const revision = roundRevision.current;
    void readPublicEvent(controller.signal).then((event) => {
      if (!event || controller.signal.aborted || revision !== roundRevision.current) return;
      setMode(event.mode);
      rememberDrawStatus(event.drawStatus);
    });
    window.addEventListener("pagehide", stopRevealAudio);
    return () => {
      controller.abort();
      loginRequest.current?.abort();
      revealRequest.current?.abort();
      seenRequest.current?.abort();
      saveRequest.current?.abort();
      downloadRequest.current?.abort();
      window.removeEventListener("pagehide", stopRevealAudio);
      stopRevealAudio();
    };
  }, [rememberDrawStatus, stopRevealAudio]);

  const registerSeen = useCallback(async (attempt: RevealAttempt) => {
    if (!attempt.canSave || attempt.restored || !attempt.code || openAttempt.current !== attempt || seenRequest.current) return;
    if (attempt.mode === "demo") {
      const stored = browserSession.current;
      if (stored && "demo" in stored && !stored.opened) {
        browserSession.current = { ...stored, opened: true };
        writeStoredSession(browserSession.current);
      }
      return;
    }
    const request = new AbortController();
    seenRequest.current = request;
    setSeenError("");
    try {
      await post<{ ok: true }>("/api/participant", { action: "seen", ...attempt.auth, code: attempt.code, drawId: attempt.drawId }, request.signal);
    } catch {
      if (!request.signal.aborted) setSeenError("Não foi possível confirmar a visualização. Seu resultado continua disponível.");
    } finally {
      if (seenRequest.current === request) seenRequest.current = null;
    }
  }, []);

  useEffect(() => {
    if (!revealed || revealed.restored) return;
    revealOutput.current?.focus({ preventScroll: true });
    if (!revealed.canSave) return;
    const timer = window.setTimeout(() => void registerSeen(revealed), 0);
    return () => window.clearTimeout(timer);
  }, [revealed, registerSeen]);

  const clearSavedCalendar = useCallback(() => {
    downloadRequest.current?.abort();
    downloadRequest.current = null;
    setSavedCalendar(null);
  }, []);

  const resetReveal = useCallback(() => {
    openAttempt.current = null;
    stopRevealAudio();
    seenRequest.current?.abort();
    seenRequest.current = null;
    saveRequest.current?.abort();
    saveRequest.current = null;
    setSaving(false);
    setSeenError("");
    setRevealed(null);
    setReel(null);
    setCode("");
    setRevealError("");
    setSelected([]);
    clearSavedCalendar();
    setSaveError("");
    setRoundNotice("");
    setMonth(0);
    requestAnimationFrame(() => codeInput.current?.focus());
  }, [clearSavedCalendar, stopRevealAudio]);

  const clearChangedRound = useCallback((event: PublicEvent) => {
    const attempt = openAttempt.current;
    if (!attempt?.canSave || !roundChanged(attempt, event)) return;
    resetReveal();
    if (event.drawStatus !== "cancelled") setRoundNotice("O sorteio mudou. Confira o código da rodada com o organizador.");
  }, [resetReveal]);

  const openSavedResult = useCallback((result: RevealResult, auth: SessionAuth) => {
    const attempt: RevealAttempt = { ...result, auth, restored: true };
    openAttempt.current = attempt;
    const days = result.mode === "demo" ? demoDays() : result.days;
    setSelected(days);
    setRevealed(attempt);
    const saved = result.mode === "demo" ? hasDemoCalendar() : result.availabilitySaved;
    setSavedCalendar(saved ? { days, download: "ready" } : null);
  }, []);

  const applySession = useCallback((response: ParticipantResponse, auth: SessionAuth) => {
    const { drawStatus, mode, participant, profileComplete, result } = response;
    if (drawStatus) setMode(drawStatus === "draft" ? "demo" : "live");
    rememberDrawStatus(drawStatus);
    setAccount({ participant, mode, profileComplete, auth });
    if (profileComplete && result?.canSave) openSavedResult(result, auth);
  }, [openSavedResult, rememberDrawStatus]);

  const clearAccount = useCallback(() => {
    loginRequest.current?.abort();
    loginRequest.current = null;
    revealRequest.current?.abort();
    revealRequest.current = null;
    setLoggingIn(false);
    setRestoring(false);
    setRestoreFailed(false);
    setLoadingReveal(false);
    setLoginError("");
    setAccount(null);
    setAccessInput("");
    setEditingProfile(false);
    resetReveal();
  }, [resetReveal]);

  const expireBrowserSession = useCallback((token: string) => {
    if (sessionKey(browserSession.current) !== token) return false;
    if (sessionKey(readStoredSession()) === token) writeStoredSession(null);
    browserSession.current = null;
    clearAccount();
    setLoginError("Sua sessão expirou. Entre de novo com o código de acesso.");
    requestAnimationFrame(() => accessField.current?.focus());
    return true;
  }, [clearAccount]);

  const restoreSession = useCallback(async (stored: StoredSession | null) => {
    browserSession.current = stored;
    if (!stored) {
      setRestoring(false);
      return;
    }
    const request = new AbortController();
    loginRequest.current?.abort();
    loginRequest.current = request;
    setRestoring(true);
    setRestoreFailed(false);
    setLoginError("");
    try {
      if ("token" in stored) {
        const auth = { sessionToken: stored.token };
        const result = await post<ParticipantResponse>("/api/participant", { action: "resume", ...auth }, request.signal);
        if (!request.signal.aborted) applySession(result, auth);
      } else {
        const auth = { accessCode: DEMO_CODE } as const;
        const profile = stored.profile;
        const result = await post<ParticipantResponse>("/api/participant", profile
          ? { action: "profile", ...auth, steamCode: profile.steamCode, games: profile.games, photo: profile.photo }
          : { action: "login", ...auth }, request.signal);
        if (stored.opened && result.profileComplete) {
          result.result = await post<RevealResult>("/api/reveal", { ...auth, code: DEMO_CODE }, request.signal);
        }
        if (!request.signal.aborted) applySession(result, auth);
      }
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof RequestError && (error.status === 401 || error.status === 403 || ("demo" in stored && error.status < 500))) {
        if (sessionKey(readStoredSession()) === sessionKey(stored)) writeStoredSession(null);
        browserSession.current = null;
        if ("token" in stored) setLoginError("Sua sessão expirou. Entre de novo com o código de acesso.");
      } else {
        setRestoreFailed(true);
        setLoginError("Não foi possível recuperar sua sessão. Tente novamente.");
      }
    } finally {
      if (loginRequest.current === request) loginRequest.current = null;
      if (!request.signal.aborted) setRestoring(false);
    }
  }, [applySession]);

  useEffect(() => {
    function syncBrowserSession(event?: StorageEvent) {
      if (event && event.key !== BROWSER_SESSION && event.key !== null) return;
      const stored = readStoredSession();
      if (sessionKey(stored) === sessionKey(browserSession.current)) return;
      clearAccount();
      void restoreSession(stored);
    }

    function syncAfterBackNavigation(event: PageTransitionEvent) {
      if (event.persisted) {
        syncBrowserSession();
        checkOpenRound.current?.();
      }
    }

    const timer = window.setTimeout(() => void restoreSession(readStoredSession()), 0);
    window.addEventListener("storage", syncBrowserSession);
    window.addEventListener("pageshow", syncAfterBackNavigation);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("storage", syncBrowserSession);
      window.removeEventListener("pageshow", syncAfterBackNavigation);
    };
  }, [clearAccount, restoreSession]);

  const activeAttempt = revealed?.canSave ? revealed : reel?.attempt;
  const accountAuth = account?.auth;
  useEffect(() => {
    const attempt = activeAttempt;
    if (!accountAuth) return;
    const demoAccount = "accessCode" in accountAuth;
    const controller = new AbortController();
    let checking = false;

    function check() {
      if (checking || document.hidden) return;
      checking = true;
      const revision = roundRevision.current;
      void readPublicEvent(controller.signal).then((event) => {
        checking = false;
        if (!event || controller.signal.aborted || revision !== roundRevision.current || (attempt && openAttempt.current !== attempt)) return;
        setMode(event.mode);
        rememberDrawStatus(event.drawStatus);
        if (demoAccount && event.mode !== "demo") {
          if (sessionKey(readStoredSession()) === "demo") writeStoredSession(null);
          browserSession.current = null;
          clearAccount();
          return;
        }
        clearChangedRound(event);
      });
    }

    checkOpenRound.current = check;
    const interval = window.setInterval(check, 25_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      checkOpenRound.current = null;
    };
  }, [accountAuth, activeAttempt, clearAccount, clearChangedRound, rememberDrawStatus]);

  const completeReveal = useCallback((attempt: RevealAttempt) => {
    if (openAttempt.current !== attempt) return;
    if (attempt.canSave) playAdvancementAudio(revealAudio.current);
    else stopRevealAudio();
    setSelected(attempt.mode === "demo" && attempt.canSave && attempt.code === DEMO_CODE ? demoDays() : attempt.days);
    setRevealed(attempt);
    setReel(null);
    clearSavedCalendar();
    setSaveError("");
  }, [clearSavedCalendar, stopRevealAudio]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginRequest.current) return;
    const request = new AbortController();
    loginRequest.current = request;
    setLoginError("");
    setLoggingIn(true);
    try {
      const result = await post<ParticipantResponse>("/api/participant", { action: "login", accessCode: accessInput, remember: true }, request.signal);
      if (request.signal.aborted) return;
      if (result.mode === "demo") {
        browserSession.current = { demo: true };
        applySession(result, { accessCode: DEMO_CODE });
      } else if (result.sessionToken) {
        browserSession.current = { token: result.sessionToken };
        applySession(result, { sessionToken: result.sessionToken });
      } else {
        throw new Error("A sessão não pôde ser criada. Atualize a página e tente novamente.");
      }
      writeStoredSession(browserSession.current);
      setAccessInput("");
      setRestoreFailed(false);
      requestAnimationFrame(() => document.getElementById(result.profileComplete ? "as-reveal-heading" : "as-profile-heading")?.focus());
    } catch (error) {
      if (!request.signal.aborted) setLoginError(error instanceof Error ? error.message : "Não foi possível acessar sua conta.");
    } finally {
      if (loginRequest.current === request) loginRequest.current = null;
      if (!request.signal.aborted) setLoggingIn(false);
    }
  }

  async function saveProfile(profile: ParticipantDraft, signal: AbortSignal) {
    if (!account) return;
    const { auth } = account;
    let result: ParticipantResponse;
    try {
      result = await post<ParticipantResponse>("/api/participant", { action: "profile", ...auth, ...profile }, signal);
    } catch (error) {
      if (!signal.aborted) handleExpiredSession(error, auth);
      throw error;
    }
    if (signal.aborted) return;
    rememberDrawStatus(result.drawStatus);
    clearChangedRound(result);
    const { result: savedResult, participant, mode, profileComplete } = result;
    setAccount((current) => current?.auth === auth ? { participant, mode, profileComplete, auth } : current);
    if (savedResult?.canSave && !openAttempt.current?.canSave) openSavedResult(savedResult, auth);
    const stored = browserSession.current;
    if (result.mode === "demo" && stored && "demo" in stored) {
      browserSession.current = {
        ...stored,
        profile: { ...profile, photo: profile.photo ?? stored.profile?.photo },
      };
      writeStoredSession(browserSession.current);
    }
    setEditingProfile(false);
    requestAnimationFrame(() => document.getElementById("as-reveal-heading")?.focus());
  }

  async function reveal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account?.profileComplete || drawStatus === "cancelled" || revealRequest.current) return;
    const request = new AbortController();
    revealRequest.current = request;
    setRevealError("");
    setRoundNotice("");
    setLoadingReveal(true);

    if (soundOn) revealAudio.current = prepareRevealAudio();

    try {
      const result = await post<RevealResult>("/api/reveal", { ...account.auth, code }, request.signal);
      if (request.signal.aborted) return;
      rememberDrawStatus(result.drawStatus);
      const attempt = { ...result, code, auth: account.auth };
      openAttempt.current = attempt;
      const frames = result.canSave && !window.matchMedia(REDUCED_MOTION).matches ? rouletteFrames(result) : [];

      if (frames.length) {
        for (const photo of new Set(frames.map((person) => person.photo))) {
          if (photo) new Image().src = profilePhotoUrl(photo);
        }
        playRollingAudio(revealAudio.current);
        setReel({ attempt, frames });
      } else {
        completeReveal(attempt);
      }
    } catch (error) {
      if (!request.signal.aborted && !handleExpiredSession(error, account.auth)) {
        stopRevealAudio();
        setRevealError(error instanceof Error ? error.message : "Não conseguimos abrir a revelação. Tente novamente.");
        const revision = roundRevision.current;
        const event = await readPublicEvent(request.signal);
        if (event && !request.signal.aborted && revision === roundRevision.current) {
          setMode(event.mode);
          rememberDrawStatus(event.drawStatus);
        }
      }
    } finally {
      if (!request.signal.aborted) setLoadingReveal(false);
      if (revealRequest.current === request) revealRequest.current = null;
    }
  }

  function signOut() {
    const stored = browserSession.current;
    browserSession.current = null;
    writeStoredSession(null);
    clearAccount();
    if (stored && "token" in stored) {
      void post("/api/participant", { action: "logout", sessionToken: stored.token }, undefined, true).catch(() => {});
    }
    requestAnimationFrame(() => accessField.current?.focus());
  }

  function handleExpiredSession(error: unknown, auth: SessionAuth) {
    return error instanceof RequestError && error.status === 401 && "sessionToken" in auth &&
      expireBrowserSession(auth.sessionToken);
  }

  function toggleSound() {
    if (soundOn) stopRevealAudio();
    setSoundOn(!soundOn);
  }

  function toggleDay(date: string) {
    setSelected((previous) => previous.includes(date) ? previous.filter((value) => value !== date) : [...previous, date]);
    clearSavedCalendar();
    setSaveError("");
  }

  async function saveAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!revealed?.canSave || drawStatus === "cancelled" || saveRequest.current) return;
    const request = new AbortController();
    saveRequest.current = request;
    setSaving(true);
    clearSavedCalendar();
    setSaveError("");

    try {
      const days = [...selected].sort();
      if (revealed.mode === "demo") {
        localStorage.setItem(DEMO_AVAILABILITY, JSON.stringify(days));
      } else {
        await post<{ ok: true }>("/api/availability", { ...revealed.auth, code: revealed.code, drawId: revealed.drawId, days }, request.signal);
      }
      if (!request.signal.aborted) setSavedCalendar({ days, download: "ready" });
    } catch (error) {
      if (!request.signal.aborted && !handleExpiredSession(error, revealed.auth)) {
        setSaveError(revealed.mode === "demo"
          ? "Este navegador não permitiu salvar a demonstração."
          : error instanceof Error ? error.message : "Não conseguimos salvar. Tente novamente.");
        checkOpenRound.current?.();
      }
    } finally {
      if (saveRequest.current === request) saveRequest.current = null;
      if (!request.signal.aborted) setSaving(false);
    }
  }

  async function downloadCalendar() {
    if (!savedCalendar || downloadRequest.current) return;
    const { days } = savedCalendar;
    const request = new AbortController();
    downloadRequest.current = request;
    setSavedCalendar({ days, download: "loading" });

    try {
      const { createAvailabilityPdf } = await import("../lib/availability-pdf");
      if (request.signal.aborted) return;
      const bytes = await createAvailabilityPdf(days);
      if (request.signal.aborted) return;

      const link = document.createElement("a");
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      link.href = url;
      link.download = "disponibilidade-amigo-secreto.pdf";
      link.hidden = true;
      try {
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      setSavedCalendar({ days, download: "ready" });
    } catch {
      if (!request.signal.aborted) setSavedCalendar({ days, download: "failed" });
    } finally {
      if (downloadRequest.current === request) downloadRequest.current = null;
    }
  }

  const { index, name } = MONTHS[month];
  const firstWeekday = new Date(YEAR, index, 1).getDay();
  const dayCount = new Date(YEAR, index + 1, 0).getDate();
  const calendarEditable = revealed?.canSave === true && drawStatus !== "cancelled";
  const showProfile = account && (!account.profileComplete || editingProfile);
  const startHeading = !account ? "as-access-heading" : showProfile ? "as-profile-heading" : "as-reveal-heading";
  const testResult = revealed?.drawStatus === "test" || (revealed?.drawStatus === undefined && drawStatus === "test");

  return (
    <div className="as-site">
      <header className="as-shell as-header">
        <a className="as-brand" href={pageUrl("/")} aria-label="Amigo Secreto, página inicial">
          <span className="as-brand-icon"><Gift size={23} strokeWidth={1.7} aria-hidden="true" /></span>
          <span>Amigo Secreto<small>EDIÇÃO {YEAR}</small></span>
        </a>
        <div className="as-header-actions">
          <ThemeToggle />
          <a className="as-organizer" href={pageUrl("/organizar")}>
            <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />
            <span><span className="as-organizer-prefix">Área do </span>organizador</span>
            <ArrowUpRight className="as-organizer-arrow" size={14} aria-hidden="true" />
          </a>
        </div>
      </header>

      <main className="as-shell">
        {!account && !restoring && <section className="as-hero" aria-labelledby="as-title">
          <div className="as-hero-copy">
            <p className="as-hero-label"><Sparkles size={14} aria-hidden="true" /> A TRADIÇÃO CONTINUA</p>
            <h1 id="as-title">O segredo<br /><em>começa aqui.</em></h1>
            <p className="as-hero-description">Descubra quem você tirou e ajude a encontrar uma data em que todo mundo possa participar.</p>
          </div>
          <img className="as-gifts" src={assetUrl("/presentes.svg")} alt="" aria-hidden="true" width={520} height={365} />
        </section>}

        {drawStatus === "test" && (
          <div className="as-round-banner as-round-test" role="status">
            <FlaskConical size={20} aria-hidden="true" />
            <div><strong>Sorteio de teste</strong><p>Os resultados desta rodada servem para conferir o fluxo. O organizador vai liberar o sorteio definitivo separadamente.</p></div>
          </div>
        )}
        {drawStatus === "cancelled" && (
          <div className="as-round-banner as-round-cancelled" role="status">
            <LockKeyhole size={20} aria-hidden="true" />
            <div><strong>Sorteio cancelado</strong><p>Aguarde as instruções do organizador para a próxima rodada.</p></div>
          </div>
        )}

        {!account && !restoring && <section className="as-guide" aria-labelledby="as-guide-heading">
          <div className="as-guide-header">
            <h2 id="as-guide-heading">Como participar</h2>
            <a href={`#${startHeading}`}>Começar <ArrowRight size={16} aria-hidden="true" /></a>
          </div>
          <ol role="list">
            <li>
              <span className="as-guide-icon"><KeyRound size={20} aria-hidden="true" /></span>
              <div><h3>Entre na sua conta</h3><p>Use o código de acesso individual que você recebeu do organizador.</p></div>
            </li>
            <li>
              <span className="as-guide-icon"><Gift size={20} aria-hidden="true" /></span>
              <div><h3>Prepare o perfil e revele</h3><p>Cadastre foto, código Steam e três jogos. Use o código do sorteio e guarde o resultado em segredo.</p></div>
            </li>
            <li>
              <span className="as-guide-icon"><CalendarDays size={20} aria-hidden="true" /></span>
              <div><h3>Marque e salve suas datas</h3><p>Em novembro e dezembro, marque os dias em que você não pode participar. Salve as datas e baixe o PDF.</p></div>
            </li>
          </ol>
        </section>}

        {restoring ? (
          <section className="as-card as-access-card" aria-label="Sessão do participante">
            <p className="as-card-description" role="status"><LockKeyhole size={17} aria-hidden="true" /> Recuperando sua sessão…</p>
          </section>
        ) : !account ? (
          <section className="as-card as-access-card" aria-labelledby="as-access-heading">
            <div>
              <div className="as-step"><span>01</span> ACESSO DO PARTICIPANTE</div>
              <h2 id="as-access-heading" tabIndex={-1}>Entre na sua conta</h2>
              <p className="as-card-description">Entre com seu código de acesso. O navegador guarda sua sessão para você voltar ao resultado.</p>
            </div>
            <form className="as-access-form as-reveal-form" onSubmit={login}>
              <label htmlFor="as-access-code">Seu código de acesso</label>
              <div className="as-input-frame">
                <KeyRound size={19} strokeWidth={1.7} aria-hidden="true" />
                <input id="as-access-code" ref={accessField} inputMode="numeric" pattern="[0-9]+" maxLength={32} autoComplete="off"
                  required value={accessInput} disabled={loggingIn} aria-invalid={Boolean(loginError)} placeholder="Digite os números"
                  onChange={(event) => { setAccessInput(event.target.value.replace(/[^0-9]/g, "")); setLoginError(""); }} />
              </div>
              <button className="as-primary" type="submit" disabled={loggingIn}>
                {loggingIn ? "Entrando…" : "Entrar na minha conta"} <ArrowRight size={17} aria-hidden="true" />
              </button>
              {loginError && <p className="as-error" role="alert">{loginError}</p>}
              {restoreFailed && <button className="as-text-button" type="button" disabled={loggingIn} onClick={() => void restoreSession(browserSession.current)}>Tentar recuperar sessão</button>}
              {mode === "demo" && <p className="as-demo-note">Modo demonstração <span aria-hidden="true">·</span>{" "}<button type="button" disabled={loggingIn} onClick={() => { setAccessInput(DEMO_CODE); setLoginError(""); accessField.current?.focus(); }}>Usar código {DEMO_CODE}</button></p>}
            </form>
          </section>
        ) : (
          <>
            <div className="as-account-bar">
              <div className="as-account-name">
                <span className="as-account-icon"><UserRound size={19} aria-hidden="true" /></span>
                <div><span>{account.mode === "demo" ? "Conta de demonstração" : "Sua conta"}</span><strong>{account.participant.name}{account.participant.nickname ? ` · ${account.participant.nickname}` : ""}</strong></div>
              </div>
              <div className="as-account-actions">
                {"sessionToken" in account.auth && (
                  <a className="as-account-button" href="#as-members"><UsersRound size={15} aria-hidden="true" /> Perfis do grupo</a>
                )}
                {account.profileComplete && !showProfile && (
                  <button type="button" className="as-account-button" disabled={saving || loadingReveal || Boolean(reel)} onClick={() => {
                    setEditingProfile(true);
                    requestAnimationFrame(() => document.getElementById("as-profile-heading")?.focus());
                  }}>Editar perfil</button>
                )}
                <button type="button" className="as-account-button" onClick={signOut}><LogOut size={15} aria-hidden="true" /> Sair da conta</button>
              </div>
            </div>

            {showProfile ? (
              <ParticipantProfile
                key={account.participant.id}
                participant={account.participant}
                demo={account.mode === "demo"}
                onSave={saveProfile}
                onCancel={account.profileComplete ? () => {
                  setEditingProfile(false);
                  requestAnimationFrame(() => document.getElementById("as-reveal-heading")?.focus());
                } : undefined}
              />
            ) : (
              <>
                <div className="as-workflow">
                  <section className="as-card as-reveal-card" aria-labelledby="as-reveal-heading">
                    <div className="as-reveal-top">
                      <div className="as-step"><span>03</span> A REVELAÇÃO</div>
                      <button className="as-sound-toggle" type="button" aria-label="Som da revelação" aria-pressed={soundOn} onClick={toggleSound}>
                        {soundOn ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
                        {soundOn ? "Som ligado" : "Som desligado"}
                      </button>
                    </div>
                    <h2 id="as-reveal-heading" tabIndex={-1}>Quem você tirou?</h2>
                    {roundNotice && <p className="as-round-hint" role="status">{roundNotice}</p>}
                    {drawStatus === "cancelled" ? <p className="as-card-description">A revelação está suspensa até a próxima rodada.</p> : revealed ? (
                      <div className="as-reveal-result">
                        <div
                          className={revealed.canSave
                            ? `as-person as-person-found${revealed.restored ? " as-person-restored" : ""}`
                            : "as-person as-person-incorrect"}
                          ref={revealOutput}
                          role="group"
                          tabIndex={-1}
                          aria-labelledby="as-result-label as-result-name"
                        >
                          {revealed.canSave && !revealed.restored && <RevealConfetti />}
                          {revealed.canSave && <ProfilePhoto person={revealed.person} />}
                          <div>
                            <p id="as-result-label">{revealed.canSave && <Sparkles size={14} aria-hidden="true" />}{revealed.canSave ? (testResult ? "Resultado do sorteio de teste" : "Seu amigo secreto é") : "Código incorreto"}</p>
                            <h3 id="as-result-name">{revealed.person.name}</h3>
                            {revealed.person.nickname && <span className="as-person-nickname">“{revealed.person.nickname}”</span>}
                          </div>
                          {!revealed.canSave && <MemeFigure person={revealed.person} />}
                        </div>
                        <p className="as-reveal-hint">{revealed.canSave
                          ? (testResult ? "Este é um resultado de teste. Aguarde o sorteio definitivo do organizador." : "Guarde o segredo e marque no calendário os dias em que você não pode participar.")
                          : "Confira o código recebido do organizador e tente de novo."}</p>
                        {revealed.canSave && (
                          <section className="as-recipient-games" aria-labelledby="as-recipient-games-heading">
                            <h3 id="as-recipient-games-heading">Jogos que a pessoa quer ganhar</h3>
                            {revealed.person.games?.length ? <GameTiles games={revealed.person.games} />
                              : <p className="as-card-description">A pessoa sorteada ainda não cadastrou os jogos.</p>}
                          </section>
                        )}
                        {seenError && <div className="as-seen-retry"><p className="as-error" role="alert">{seenError}</p><button className="as-text-button" type="button" onClick={() => void registerSeen(revealed)}>Tentar registrar novamente</button></div>}
                        {calendarEditable && <a className="as-calendar-shortcut" href="#as-calendar-heading">Marcar meus dias <ArrowRight size={16} aria-hidden="true" /></a>}
                        <button className="as-text-button" type="button" disabled={saving} onClick={resetReveal}>Usar outro código</button>
                      </div>
                    ) : reel ? (
                      <Roulette reel={reel} onFinish={completeReveal} />
                    ) : (
                      <>
                        <p className="as-card-description">{drawStatus === "test" ? "Digite o código desta rodada para abrir a revelação de teste." : "Digite seu código do sorteio para revelar a pessoa que você tirou."}</p>
                        <form className="as-reveal-form" onSubmit={reveal}>
                          <label htmlFor="as-code">Seu código do sorteio</label>
                          <div className="as-input-frame">
                            <KeyRound size={19} strokeWidth={1.7} aria-hidden="true" />
                            <input
                              id="as-code"
                              ref={codeInput}
                              name="code"
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]+"
                              autoComplete="off"
                              maxLength={32}
                              required
                              value={code}
                              disabled={loadingReveal}
                              placeholder="Digite os números"
                              onChange={(event) => {
                                setCode(event.target.value.replace(/[^0-9]/g, ""));
                                setRevealError("");
                              }}
                            />
                          </div>
                          <button className="as-primary as-reveal-button" type="submit" disabled={loadingReveal}>
                            <span><Gift size={18} aria-hidden="true" /> {loadingReveal ? "Abrindo…" : "Revelar meu amigo secreto"}</span>
                            <ArrowRight size={17} aria-hidden="true" />
                          </button>
                          {revealError && <p className="as-error" role="alert">{revealError}</p>}
                        </form>
                        <div className="as-code-note"><LockKeyhole size={15} strokeWidth={1.7} aria-hidden="true" /> O código é individual. Guarde-o com você.</div>
                        {account.mode === "demo" && <p className="as-demo-note">Modo demonstração <span aria-hidden="true">·</span>{" "}<button type="button" onClick={() => { setCode(DEMO_CODE); setRevealError(""); codeInput.current?.focus(); }} disabled={loadingReveal}>Usar código {DEMO_CODE}</button></p>}
                      </>
                    )}
                  </section>

                  <section className="as-card as-calendar-card" aria-labelledby="as-calendar-heading">
                    <div className="as-step as-step-green"><span>04</span> A DATA DO ENCONTRO</div>
                    <h2 id="as-calendar-heading">Quando você não pode?</h2>
                    <p className="as-card-description">Selecione os dias em que você não pode participar. Se todos funcionarem, salve sem marcar nenhum.</p>

                    <form className="as-calendar-form" onSubmit={saveAvailability}>
                      <div className="as-calendar">
                        <div className="as-calendar-bar">
                          <div className="as-calendar-month" aria-live="polite"><CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" /> <h3>{name} {YEAR}</h3></div>
                          <div className="as-calendar-controls">
                            <button type="button" aria-label="Mês anterior" disabled={month === 0} onClick={() => setMonth(0)}><ChevronLeft size={18} aria-hidden="true" /></button>
                            <button type="button" aria-label="Próximo mês" disabled={month === MONTHS.length - 1} onClick={() => setMonth(1)}><ChevronRight size={18} aria-hidden="true" /></button>
                          </div>
                        </div>
                        <div className="as-calendar-grid">
                          {WEEKDAYS.map((weekday) => <span key={weekday} className="as-weekday" aria-hidden="true">{weekday}</span>)}
                          {Array.from({ length: firstWeekday }, (_, offset) => <span key={`blank-${offset}`} aria-hidden="true" />)}
                          {Array.from({ length: dayCount }, (_, offset) => {
                            const day = offset + 1;
                            const date = `${YEAR}-${String(index + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                            return (
                              <button
                                className="as-day"
                                key={date}
                                type="button"
                                aria-label={DATE_LABEL.format(new Date(YEAR, index, day))}
                                aria-pressed={selected.includes(date)}
                                disabled={!calendarEditable || saving}
                                onClick={() => toggleDay(date)}
                              >{day}</button>
                            );
                          })}
                        </div>
                      </div>

                      {calendarEditable ? (
                        <>
                          <div className="as-calendar-actions">
                            <p className="as-day-count"><span aria-hidden="true" />{selected.length === 1 ? "1 dia indisponível" : `${selected.length} dias indisponíveis`}</p>
                            <button className="as-primary as-save-button" type="submit" disabled={saving}><Check size={17} aria-hidden="true" /> {saving ? "Salvando…" : "Salvar minhas datas"}</button>
                          </div>
                          {savedCalendar && (
                            <div className="as-calendar-receipt">
                              <p className="as-success" role="status"><Check size={17} aria-hidden="true" /> {revealed.mode === "demo" ? "Demonstração salva neste navegador." : testResult ? "Suas datas de teste foram salvas." : "Suas datas foram salvas."}</p>
                              <button className="as-pdf-button" type="button" disabled={savedCalendar.download === "loading"} onClick={downloadCalendar}>
                                <Download size={16} aria-hidden="true" /> {savedCalendar.download === "loading" ? "Gerando PDF…" : "Baixar calendário em PDF"}
                              </button>
                              {savedCalendar.download === "failed" && <p className="as-error" role="alert">Não foi possível gerar o PDF. Tente novamente.</p>}
                            </div>
                          )}
                          {saveError && <p className="as-error" role="alert">{saveError}</p>}
                        </>
                      ) : (
                        <p className="as-calendar-locked"><LockKeyhole size={15} strokeWidth={1.8} aria-hidden="true" /> Revele seu amigo secreto para liberar o calendário.</p>
                      )}
                    </form>
                  </section>
                </div>
                {calendarEditable && <SteamDirectory friends={revealed.steamFriends ?? []} test={testResult} />}
              </>
            )}
            {"sessionToken" in account.auth && (
              <MemberProfiles key={account.auth.sessionToken} sessionToken={account.auth.sessionToken} onExpired={expireBrowserSession} />
            )}
          </>
        )}
      </main>

      <footer className="as-shell as-footer">
        <span className="as-footer-event"><Gift size={16} strokeWidth={1.7} aria-hidden="true" /> <span>Amigo Secreto {YEAR}</span> <span aria-hidden="true">·</span> <span>Novembro e dezembro</span></span>
        <a className="as-footer-portfolio" href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">Portfólio do André Toshiro <ArrowUpRight size={15} aria-hidden="true" /></a>
      </footer>
      {account && "sessionToken" in account.auth && (
        <GroupChat
          key={account.auth.sessionToken}
          sessionToken={account.auth.sessionToken}
          viewerId={account.participant.id}
          onExpired={expireBrowserSession}
        />
      )}
    </div>
  );
}
