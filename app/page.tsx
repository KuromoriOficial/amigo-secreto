"use client";

import { ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, Download, Gift, KeyRound, LockKeyhole, Sparkles } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, assetUrl, pageUrl } from "../lib/frontend-paths";

const YEAR = 2026;
const MONTHS = [
  { index: 10, name: "Novembro" },
  { index: 11, name: "Dezembro" },
] as const;
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DEMO_CODE = "482731";
const DEMO_AVAILABILITY = `amigo-secreto-${YEAR}-demo-days`;
const DATE_LABEL = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" });
const REVEAL_DURATION = 2700;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

type Mode = "demo" | "live";
type Profile = { name: string; nickname?: string; photo: string };
type RevealResult = { person: Profile; candidates?: Profile[]; canSave: boolean; days: string[]; mode: Mode };
type RevealAttempt = RevealResult & { code: string };
type RevealReel = { attempt: RevealAttempt; frames: Profile[] };
type SavedCalendar = { days: readonly string[]; download: "ready" | "loading" | "failed" };

async function post<T>(endpoint: string, payload: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !data) {
    throw new Error(typeof data?.error === "string" ? data.error : "Não foi possível concluir. Tente de novo em instantes.");
  }
  return data;
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

function profilePhotoUrl(photo: string) {
  return photo.startsWith("/api/") ? apiUrl(photo) : assetUrl(photo);
}

function ProfilePhoto({ person }: { person: Profile }) {
  const [failed, setFailed] = useState(false);
  const initials = person.name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("");
  const photo = profilePhotoUrl(person.photo);

  return (
    <div className="as-photo">
      <span aria-hidden="true">{initials}</span>
      {photo && !failed && <img src={photo} alt={`Foto de ${person.name}`} onError={() => setFailed(true)} />}
    </div>
  );
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

function rouletteFrames(result: RevealResult): Profile[] {
  const deck = [...(result.candidates ?? [])];
  const winner = deck.findIndex(({ name, nickname, photo }) => (
    name === result.person.name && nickname === result.person.nickname && photo === result.person.photo
  ));
  if (winner !== -1) deck.splice(winner, 1);
  if (!deck.length) return [];

  for (let index = deck.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }

  if (deck.length === 1) deck.push(result.person);
  return Array.from({ length: Math.max(deck.length, 9) }, (_, index) => deck[index % deck.length]);
}

function elapsedForFrame(index: number, count: number) {
  const progress = index / count;
  return REVEAL_DURATION * (0.57 * progress + 0.43 * progress ** 3);
}

function Roulette({ reel, onFinish }: { reel: RevealReel; onFinish: (attempt: RevealAttempt) => void }) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    let index = 0;
    let timer: number;
    const count = reel.frames.length;
    const motionPreference = window.matchMedia(REDUCED_MOTION);

    function finish() {
      window.clearTimeout(timer);
      onFinish(reel.attempt);
    }

    function skipMotion(event: MediaQueryListEvent) {
      if (event.matches) finish();
    }

    function nextFrame() {
      const delay = elapsedForFrame(index + 1, count) - elapsedForFrame(index, count);
      timer = window.setTimeout(() => {
        index += 1;
        if (index === count) {
          finish();
        } else {
          setFrameIndex(index);
          nextFrame();
        }
      }, delay);
    }

    nextFrame();
    motionPreference.addEventListener("change", skipMotion);
    return () => {
      window.clearTimeout(timer);
      motionPreference.removeEventListener("change", skipMotion);
    };
  }, [reel, onFinish]);

  const person = reel.frames[frameIndex];
  return (
    <div className="as-reel">
      <p className="as-reel-label" role="status"><Sparkles size={16} aria-hidden="true" /> Girando a roleta…</p>
      <div className="as-reel-window" aria-hidden="true">
        <div className="as-reel-frame" key={frameIndex}>
          <ProfilePhoto person={person} />
          <div>
            <strong>{person.name}</strong>
            {person.nickname && <span className="as-person-nickname">“{person.nickname}”</span>}
          </div>
        </div>
      </div>
      <div className="as-reel-progress" aria-hidden="true"><span style={{ animationDuration: `${REVEAL_DURATION}ms` }} /></div>
    </div>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>();
  const [code, setCode] = useState("");
  const [revealed, setRevealed] = useState<RevealAttempt | null>(null);
  const [reel, setReel] = useState<RevealReel | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [month, setMonth] = useState(0);
  const [loadingReveal, setLoadingReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revealError, setRevealError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [savedCalendar, setSavedCalendar] = useState<SavedCalendar | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const revealOutput = useRef<HTMLDivElement>(null);
  const revealRequest = useRef<AbortController | null>(null);
  const downloadRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl("/api/event"), { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ mode?: Mode }> : null)
      .then((event) => {
        if (!controller.signal.aborted && (event?.mode === "demo" || event?.mode === "live")) setMode(event.mode);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      revealRequest.current?.abort();
      downloadRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (revealed) revealOutput.current?.focus({ preventScroll: true });
  }, [revealed]);

  const clearSavedCalendar = useCallback(() => {
    downloadRequest.current?.abort();
    downloadRequest.current = null;
    setSavedCalendar(null);
  }, []);

  const completeReveal = useCallback((attempt: RevealAttempt) => {
    setSelected(attempt.mode === "demo" && attempt.canSave && attempt.code === DEMO_CODE ? demoDays() : attempt.days);
    setRevealed(attempt);
    setReel(null);
    clearSavedCalendar();
    setSaveError("");
  }, [clearSavedCalendar]);

  async function reveal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (revealRequest.current) return;
    const request = new AbortController();
    revealRequest.current = request;
    setRevealError("");
    setLoadingReveal(true);

    try {
      const result = await post<RevealResult>("/api/reveal", { code }, request.signal);
      if (request.signal.aborted) return;
      const attempt = { ...result, code };
      setMode(result.mode);
      const frames = result.canSave && !window.matchMedia(REDUCED_MOTION).matches ? rouletteFrames(result) : [];

      if (frames.length) {
        for (const photo of new Set(frames.map((person) => person.photo))) {
          if (photo) new Image().src = profilePhotoUrl(photo);
        }
        setReel({ attempt, frames });
      } else {
        completeReveal(attempt);
      }
    } catch (error) {
      if (!request.signal.aborted) {
        setRevealError(error instanceof Error ? error.message : "Não conseguimos abrir a revelação. Tente novamente.");
      }
    } finally {
      if (!request.signal.aborted) setLoadingReveal(false);
      if (revealRequest.current === request) revealRequest.current = null;
    }
  }

  function resetReveal() {
    setRevealed(null);
    setCode("");
    setSelected([]);
    clearSavedCalendar();
    setSaveError("");
    setMonth(0);
    requestAnimationFrame(() => codeInput.current?.focus());
  }

  function toggleDay(date: string) {
    setSelected((previous) => previous.includes(date) ? previous.filter((value) => value !== date) : [...previous, date]);
    clearSavedCalendar();
    setSaveError("");
  }

  async function saveAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!revealed?.canSave || saving) return;
    setSaving(true);
    clearSavedCalendar();
    setSaveError("");

    try {
      const days = [...selected].sort();
      if (revealed.mode === "demo") {
        localStorage.setItem(DEMO_AVAILABILITY, JSON.stringify(days));
      } else {
        await post<{ ok: true }>("/api/availability", { code: revealed.code, days });
      }
      setSavedCalendar({ days, download: "ready" });
    } catch (error) {
      setSaveError(revealed.mode === "demo"
        ? "Este navegador não permitiu salvar a demonstração."
        : error instanceof Error ? error.message : "Não conseguimos salvar. Tente novamente.");
    } finally {
      setSaving(false);
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
  const calendarEditable = revealed?.canSave === true;

  return (
    <div className="as-site">
      <header className="as-shell as-header">
        <a className="as-brand" href={pageUrl("/")} aria-label="Amigo Secreto, página inicial">
          <span className="as-brand-icon"><Gift size={23} strokeWidth={1.7} aria-hidden="true" /></span>
          <span>Amigo Secreto<small>EDIÇÃO {YEAR}</small></span>
        </a>
        <a className="as-organizer" href={pageUrl("/organizar")}>
          <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />
          <span><span className="as-organizer-prefix">Área do </span>organizador</span>
          <ArrowUpRight className="as-organizer-arrow" size={14} aria-hidden="true" />
        </a>
      </header>

      <main className="as-shell">
        <section className="as-hero" aria-labelledby="as-title">
          <div className="as-hero-copy">
            <p className="as-hero-label"><Sparkles size={14} aria-hidden="true" /> A TRADIÇÃO CONTINUA</p>
            <h1 id="as-title">O segredo<br /><em>começa aqui.</em></h1>
            <p className="as-hero-description">Descubra quem você tirou e ajude a encontrar uma data em que todo mundo possa participar.</p>
          </div>
          <img className="as-gifts" src={assetUrl("/presentes.svg")} alt="" aria-hidden="true" width={520} height={365} />
        </section>

        <div className="as-workflow">
          <section className="as-card as-reveal-card" aria-labelledby="as-reveal-heading">
            <div className="as-step"><span>01</span> A REVELAÇÃO</div>
            <h2 id="as-reveal-heading">Quem você tirou?</h2>
            {revealed ? (
              <div className="as-reveal-result">
                <div
                  className={revealed.canSave ? "as-person as-person-found" : "as-person as-person-incorrect"}
                  ref={revealOutput}
                  role="group"
                  tabIndex={-1}
                  aria-labelledby="as-result-label as-result-name"
                >
                  {revealed.canSave && <ProfilePhoto person={revealed.person} />}
                  <div>
                    <p id="as-result-label">{revealed.canSave ? "Seu amigo secreto é" : "Código incorreto"}</p>
                    <h3 id="as-result-name">{revealed.person.name}</h3>
                    {revealed.person.nickname && <span className="as-person-nickname">“{revealed.person.nickname}”</span>}
                  </div>
                  {!revealed.canSave && <MemeFigure person={revealed.person} />}
                </div>
                <p className="as-reveal-hint">{revealed.canSave
                  ? "Guarde o segredo e marque no calendário os dias em que você não pode participar."
                  : "Confira o código recebido do organizador e tente de novo."}</p>
                {calendarEditable && <a className="as-calendar-shortcut" href="#as-calendar-heading">Marcar meus dias <ArrowRight size={16} aria-hidden="true" /></a>}
                <button className="as-text-button" type="button" disabled={saving} onClick={resetReveal}>Usar outro código</button>
              </div>
            ) : reel ? (
              <Roulette reel={reel} onFinish={completeReveal} />
            ) : (
              <>
                <p className="as-card-description">Digite o código que você recebeu para abrir sua revelação.</p>
                <form className="as-reveal-form" onSubmit={reveal}>
                  <label htmlFor="as-code">Seu código</label>
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
                {mode === "demo" && <p className="as-demo-note">Modo demonstração <span aria-hidden="true">·</span>{" "}<button type="button" onClick={() => { setCode(DEMO_CODE); setRevealError(""); codeInput.current?.focus(); }} disabled={loadingReveal}>Usar código {DEMO_CODE}</button></p>}
              </>
            )}
          </section>

          <section className="as-card as-calendar-card" aria-labelledby="as-calendar-heading">
            <div className="as-step as-step-green"><span>02</span> A DATA DO ENCONTRO</div>
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
                      <p className="as-success" role="status"><Check size={17} aria-hidden="true" /> {revealed.mode === "demo" ? "Demonstração salva neste navegador." : "Suas datas foram salvas."}</p>
                      <button className="as-pdf-button" type="button" disabled={savedCalendar.download === "loading"} onClick={downloadCalendar}>
                        <Download size={16} aria-hidden="true" /> {savedCalendar.download === "loading" ? "Gerando PDF…" : "Baixar calendário em PDF"}
                      </button>
                      {savedCalendar.download === "failed" && <p className="as-error" role="alert">Não foi possível gerar o PDF. Tente novamente.</p>}
                    </div>
                  )}
                  {saveError && <p className="as-error" role="alert">{saveError}</p>}
                </>
              ) : (
                <p className="as-calendar-locked"><LockKeyhole size={15} strokeWidth={1.8} aria-hidden="true" /> Use seu código para liberar o calendário.</p>
              )}
            </form>
          </section>
        </div>
      </main>

      <footer className="as-shell as-footer"><Gift size={16} strokeWidth={1.7} aria-hidden="true" /> <span>Amigo Secreto {YEAR}</span> <span aria-hidden="true">·</span> <span>Novembro e dezembro</span></footer>
    </div>
  );
}
