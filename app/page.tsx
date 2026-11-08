"use client";

import { ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, Gift, KeyRound, LockKeyhole, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
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

type Mode = "demo" | "live";
type Profile = { name: string; photo: string };
type RevealResult = { person: Profile; canSave: boolean; days: string[]; mode: Mode };

async function post<T>(endpoint: string, payload: object): Promise<T> {
  const response = await fetch(apiUrl(endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

function ProfilePhoto({ person }: { person: Profile }) {
  const [failed, setFailed] = useState(false);
  const initials = person.name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("");
  const photo = person.photo.startsWith("/api/") ? apiUrl(person.photo) : assetUrl(person.photo);

  return (
    <div className="as-photo">
      <span aria-hidden="true">{initials}</span>
      {photo && !failed && <img src={photo} alt={`Foto de ${person.name}`} onError={() => setFailed(true)} />}
    </div>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>();
  const [code, setCode] = useState("");
  const [revealed, setRevealed] = useState<RevealResult | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [month, setMonth] = useState(0);
  const [loadingReveal, setLoadingReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revealError, setRevealError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl("/api/event"), { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ mode?: Mode }> : null)
      .then((event) => {
        if (!controller.signal.aborted && (event?.mode === "demo" || event?.mode === "live")) setMode(event.mode);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  async function reveal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loadingReveal) return;
    setRevealError("");
    setLoadingReveal(true);

    try {
      const result = await post<RevealResult>("/api/reveal", { code });
      setMode(result.mode);
      setSelected(result.mode === "demo" && result.canSave && code === DEMO_CODE ? demoDays() : result.days);
      setRevealed(result);
      setSaved(false);
      setSaveError("");
    } catch (error) {
      setRevealError(error instanceof Error ? error.message : "Não conseguimos abrir a revelação. Tente novamente.");
    } finally {
      setLoadingReveal(false);
    }
  }

  function resetReveal() {
    setRevealed(null);
    setCode("");
    setSelected([]);
    setSaved(false);
    setSaveError("");
    setMonth(0);
    requestAnimationFrame(() => codeInput.current?.focus());
  }

  function toggleDay(date: string) {
    setSelected((previous) => previous.includes(date) ? previous.filter((value) => value !== date) : [...previous, date]);
    setSaved(false);
    setSaveError("");
  }

  async function saveAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!revealed?.canSave || saving) return;
    setSaving(true);
    setSaved(false);
    setSaveError("");

    try {
      const days = [...selected].sort();
      if (revealed.mode === "demo") {
        localStorage.setItem(DEMO_AVAILABILITY, JSON.stringify(days));
      } else {
        await post<{ ok: true }>("/api/availability", { code, days });
      }
      setSaved(true);
    } catch (error) {
      setSaveError(revealed.mode === "demo"
        ? "Este navegador não permitiu salvar a demonstração."
        : error instanceof Error ? error.message : "Não conseguimos salvar. Tente novamente.");
    } finally {
      setSaving(false);
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
                <div className="as-person" role="status">
                  <ProfilePhoto person={revealed.person} />
                  <div>
                    <p>{revealed.canSave ? "Seu amigo secreto é" : "Revelação simulada"}</p>
                    <h3>{revealed.person.name}</h3>
                  </div>
                </div>
                <p className="as-reveal-hint">{revealed.canSave
                  ? "Guarde o segredo e marque no calendário os dias em que você não pode participar."
                  : "Esse código mostrou um perfil fictício. Para registrar suas datas, use o código recebido do organizador."}</p>
                {calendarEditable && <a className="as-calendar-shortcut" href="#as-calendar-heading">Marcar meus dias <ArrowRight size={16} aria-hidden="true" /></a>}
                <button className="as-text-button" type="button" disabled={saving} onClick={resetReveal}>Usar outro código</button>
              </div>
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
                  {saved && <p className="as-success" role="status"><Check size={17} aria-hidden="true" /> {revealed.mode === "demo" ? "Demonstração salva neste navegador." : "Suas datas foram salvas."}</p>}
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
