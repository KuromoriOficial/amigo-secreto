"use client";

import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { apiUrl, assetUrl, isStaticFrontend, pageUrl } from "../../lib/frontend-paths";
import styles from "./organizar.module.css";

type Profile = { name: string; nickname?: string; photo: string };
type Participant = Profile & { id: string; code?: string; responded: boolean };
type Day = { date: string; available: number; unavailable: number };
type Event = { phase: "draft" | "drawn"; drawMethod?: "offline" | "online"; participants: Participant[]; responseCount: number; dates: Day[] };
type PhotoDraft = Profile & { id?: string };
type OfflineAssignment = { participantId: string; lookup: string; iv: string; ciphertext: string };
type OfflineDraw = { version: 1; assignments: OfflineAssignment[] };
type OrganizerAction = { action: "save"; participants: Profile[] } | { action: "import"; draw: OfflineDraw };
type IconName = "gift" | "arrow" | "lock" | "calendar" | "copy" | "people" | "check";

const emptyDraft: PhotoDraft = { name: "", photo: "" };
const participantPage = pageUrl("/");
const months = { "11": "Novembro", "12": "Dezembro" };
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" });
const saoPauloDate = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Sao_Paulo" });

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    gift: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v8h14v-8M12 8v12M12 8c-5 0-6.4-2-5.4-3.5C8 2.5 11 4.1 12 8Zm0 0c5 0 6.4-2 5.4-3.5C16 2.5 13 4.1 12 8Z" /></>,
    arrow: <path d="m12 19-7-7 7-7M5 12h14" />,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 1 1 8 0v4m-4 4v2" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4m8-4v4m-8 8h2m4 0h2" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    people: <><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2m2-16a3 3 0 0 1 0 6m4 10v-2a5 5 0 0 0-3-4.6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

async function organizerRequest(key: string, action?: OrganizerAction, signal?: AbortSignal) {
  const response = await fetch(apiUrl("/api/organizer"), {
    method: action ? "POST" : "GET",
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(action ? { "Content-Type": "application/json" } : {}) },
    body: action ? JSON.stringify(action) : undefined,
    cache: "no-store",
    credentials: isStaticFrontend ? "omit" : "same-origin",
    signal,
  });
  const data = await response.json().catch(() => null) as Event | { error: string } | null;
  if (!response.ok || !data || typeof data !== "object" || !("phase" in data)) {
    throw new Error(data && typeof data === "object" && "error" in data ? data.error : "Não foi possível acessar o painel. Tente novamente.");
  }
  return data;
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

function downloadRoster(participants: Participant[]) {
  const roster = participants.map(({ id, name, nickname }) => ({ id, name, nickname }));
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
  const [readingDraw, setReadingDraw] = useState(false);
  const [drawError, setDrawError] = useState("");
  const [month, setMonth] = useState<"all" | "11" | "12">("all");
  const [showAll, setShowAll] = useState(false);

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

  function clearPendingDraw() {
    setPendingDraw(null);
    setDrawError("");
  }

  function applyEvent(nextEvent: Event) {
    setEvent(nextEvent);
    setRoster(nextEvent.participants);
    setDraft(emptyDraft);
    setChanged(false);
    clearPendingDraw();
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

  async function update(action?: OrganizerAction) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    setDrawError("");
    try {
      applyEvent(await organizerRequest(key, action));
      setMessage(action?.action === "import"
        ? "Sorteio ativado. Envie os códigos do arquivo local individualmente."
        : action?.action === "save" ? "Lista salva." : "Respostas atualizadas.");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Falha ao atualizar o painel.";
      if (action?.action === "import") setDrawError(detail);
      else setError(detail);
    } finally {
      setBusy(false);
    }
  }

  function saveDraft() {
    if (!canSaveDraft) return;
    const participants = roster.map(({ name, nickname, photo }) => ({ name, nickname, photo }));
    void update({ action: "save", participants });
  }

  async function stageDraw(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !readyForDraw || !savedRoster) return;
    clearPendingDraw();
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

  function saveParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name || !draft.photo) {
      setFormError("Preencha o nome e selecione uma foto.");
      return;
    }
    if (roster.length >= 32 && !draft.id) {
      setFormError("A lista pode ter até 32 participantes.");
      return;
    }
    const participant = {
      id: draft.id ?? crypto.randomUUID(),
      name,
      nickname: draft.nickname?.trim() || undefined,
      photo: draft.photo,
      responded: false,
    };
    setRoster((current) => draft.id ? current.map((entry) => entry.id === draft.id ? participant : entry) : [...current, participant]);
    setChanged(true);
    clearPendingDraw();
    setFormError("");
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
    setChanged(false);
  }

  const drawn = event?.phase === "drawn";
  const offline = drawn && event?.drawMethod === "offline";
  const responseCount = event?.responseCount ?? 0;
  const pending = roster.length - responseCount;
  const today = todayInSaoPaulo();
  const commonDays = event?.dates.filter((day) => day.date >= today && day.unavailable === 0 && pending === 0).length ?? 0;
  const rankedDates = (event?.dates ?? [])
    .filter((day) => month === "all" || day.date.slice(5, 7) === month)
    .sort((first, second) => Number(first.date < today) - Number(second.date < today) || first.unavailable - second.unavailable || first.date.localeCompare(second.date));
  const draftInProgress = Boolean(draft.id || draft.name || draft.nickname || draft.photo);
  const savedRoster = event?.phase === "draft" ? event.participants : null;
  const editing = changed || draftInProgress || photoBusy;
  const canSaveDraft = changed && !draftInProgress && !photoBusy && !busy && !readingDraw;
  const readyForDraw = Boolean(savedRoster && savedRoster.length >= 2 && !editing && !busy && !readingDraw);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <a className={styles.brand} href={participantPage}>
          <span className={styles.brandIcon}><Icon name="gift" /></span>
          <span>Amigo Secreto <small>2026</small></span>
        </a>
        {event && key && <button type="button" className={styles.textButton} onClick={leave} disabled={busy || readingDraw}>Sair do painel</button>}
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
              <p>{drawn ? "Compartilhe os códigos e acompanhe as respostas do grupo." : "Prepare a lista de participantes e ative o sorteio feito offline."}</p>
            </div>
            <span className={styles.phase}>{drawn ? "Sorteio ativo" : "Em preparação"}</span>
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

          <div className={styles.grid}>
            <section className={styles.card} aria-labelledby="participants-title">
              <div className={styles.sectionHeading}>
                <span className={styles.sectionIcon}><Icon name="people" /></span>
                <div>
                  <h2 id="participants-title">Participantes</h2>
                  <p>{drawn ? "Envie o código de cada pessoa em particular." : `${roster.length} de 32 · Nome e foto de cada pessoa`}</p>
                </div>
              </div>

              {roster.length === 0 ? (
                <p className={styles.empty}>Adicione pelo menos duas pessoas para começar.</p>
              ) : (
                <ul className={styles.roster}>
                  {roster.map((person) => (
                    <li key={person.id}>
                      <img className={styles.avatar} src={person.photo} alt="" width={44} height={44} />
                      <div className={styles.person}>
                        <strong>{person.name}</strong>
                        {person.nickname && <small>Discord · {person.nickname}</small>}
                        {drawn && <small>{person.responded ? "Respondeu" : "Aguardando resposta"}</small>}
                      </div>
                      {drawn ? (!offline && person.code && (
                        <button className={styles.code} type="button" onClick={() => copy(person.code ?? "", `Código de ${person.name} copiado.`)} aria-label={`Copiar código de ${person.name}`}>
                          <span>{person.code}</span><Icon name="copy" size={16} />
                        </button>
                      )) : (
                        <div className={styles.rowActions}>
                          <button className={styles.textButton} type="button" aria-label={`Editar ${person.name}`} disabled={busy || photoBusy} onClick={() => {
                            setDraft(person);
                            setFormError("");
                            document.getElementById("participant-name")?.focus();
                          }}>Editar</button>
                          <button className={styles.remove} type="button" aria-label={`Remover ${person.name}`} disabled={busy || photoBusy} onClick={() => {
                            setRoster((current) => current.filter((entry) => entry.id !== person.id));
                            if (draft.id === person.id) setDraft(emptyDraft);
                            setChanged(true);
                            clearPendingDraw();
                          }}>Remover</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {offline && <p className={styles.notice}>Abra o arquivo privado <b>codigos-amigo-secreto-2026.txt</b> que você baixou da ferramenta offline. Envie a cada pessoa apenas o código dela.</p>}
              {drawn ? (
                <div className={styles.share}>
                  <button type="button" className={styles.secondary} onClick={() => copy(new URL(participantPage, window.location.origin).href, "Link do participante copiado.")}><Icon name="copy" size={16} /> Copiar link do participante</button>
                  <a href={participantPage}>Abrir página do participante</a>
                </div>
              ) : (
                <form className={styles.participantForm} onSubmit={saveParticipant}>
                  <h3>{draft.id ? "Editar participante" : "Adicionar participante"}</h3>
                  <label htmlFor="participant-name">Nome</label>
                  <input id="participant-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ex. Mariana" maxLength={70} required disabled={busy} />
                  <label htmlFor="participant-nickname">Nick no Discord (opcional)</label>
                  <input id="participant-nickname" value={draft.nickname ?? ""} onChange={(event) => setDraft((current) => ({ ...current, nickname: event.target.value }))} maxLength={70} autoCapitalize="none" spellCheck={false} disabled={busy} />
                  <label htmlFor="participant-photo">Foto</label>
                  <div className={styles.photoUpload}>
                    {draft.photo && <img className={styles.avatar} src={draft.photo} alt="Prévia da foto" width={44} height={44} />}
                    <input id="participant-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPhoto} disabled={busy || photoBusy} />
                  </div>
                  {formError && <p className={styles.error} role="alert">{formError}</p>}
                  <div className={styles.formActions}>
                    <button className={styles.primary} type="submit" disabled={busy || photoBusy}>{photoBusy ? "Preparando foto…" : draft.id ? "Aplicar edição" : "Adicionar à lista"}</button>
                    {draftInProgress && <button className={styles.textButton} type="button" onClick={() => { setDraft(emptyDraft); setFormError(""); }} disabled={busy || photoBusy}>Cancelar</button>}
                  </div>
                </form>
              )}
            </section>

            {drawn ? (
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
                  <button type="button" className={styles.secondary} onClick={() => update()} disabled={busy}>{busy ? "Atualizando…" : "Atualizar respostas"}</button>
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
            ) : (
              <section className={styles.card} aria-labelledby="draw-title">
                <div className={styles.sectionHeading}>
                  <span className={styles.sectionIcon}><Icon name="gift" /></span>
                  <div>
                    <h2 id="draw-title">Sorteio offline</h2>
                    <p>Gere os códigos no seu dispositivo e envie o resultado protegido para ativar o sorteio.</p>
                  </div>
                </div>
                <ol className={styles.steps}>
                  <li>
                    <span>1</span>
                    <div>
                      <strong>Salve e baixe a lista</strong>
                      <p>Cadastre pelo menos duas pessoas. Se a lista mudar depois de baixar, salve e gere um novo resultado.</p>
                      <div className={styles.formActions}>
                        <button className={styles.secondary} type="button" onClick={saveDraft} disabled={!canSaveDraft}>Salvar rascunho</button>
                        <button className={styles.secondary} type="button" onClick={() => { if (readyForDraw && savedRoster) downloadRoster(savedRoster); }} disabled={!readyForDraw}>Baixar lista salva</button>
                      </div>
                      {draftInProgress && <p>Conclua ou cancele a edição do participante antes de continuar.</p>}
                      {changed && !draftInProgress && <p>Salve o rascunho para baixar a versão atual da lista.</p>}
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Faça o sorteio no seu dispositivo</strong>
                      <p>Abra a ferramenta baixada, importe a lista salva e guarde o arquivo de códigos em particular.</p>
                      <div className={styles.formActions}>
                        <a className={styles.secondary} href={assetUrl("/sorteio-offline.html")} download="sorteio-offline.html">Baixar ferramenta offline</a>
                      </div>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <strong>Envie o resultado protegido</strong>
                      <p>Selecione <b>sorteio-criptografado-2026.json</b> para revisar e ativar. O arquivo de códigos fica com você.</p>
                      <div className={styles.drawFile}>
                        <label htmlFor="protected-draw">Arquivo de resultado protegido</label>
                        <input id="protected-draw" type="file" accept=".json,application/json" onChange={stageDraw} disabled={!readyForDraw} />
                      </div>
                    </div>
                  </li>
                </ol>
                {readingDraw && <p className={styles.calendarHint} role="status">Verificando o arquivo…</p>}
                {drawError && <p className={styles.error} role="alert">{drawError}</p>}
                {pendingDraw && (
                  <div className={styles.confirm}>
                    <strong>Resultado pronto para ativar</strong>
                    <p className={styles.filename} role="status"><b>{pendingDraw.filename}</b></p>
                    <p>Ao ativar, a lista de {pendingDraw.data.assignments.length} pessoas será fechada e os códigos gerados offline passarão a funcionar.</p>
                    <div className={styles.formActions}>
                      <button className={styles.primary} type="button" onClick={() => { if (readyForDraw) update({ action: "import", draw: pendingDraw.data }); }} disabled={!readyForDraw}>{busy ? "Ativando…" : "Ativar sorteio"}</button>
                      <button className={styles.textButton} type="button" onClick={clearPendingDraw} disabled={busy}>Remover arquivo</button>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        </main>
      )}
      <footer className={styles.footer}>Amigo Secreto <span>·</span> 2026</footer>
    </div>
  );
}
