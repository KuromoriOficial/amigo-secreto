"use client";

import { ArrowDown, ArrowLeft, Bell, ImagePlus, Maximize2, MessageCircle, Pin, Send, Volume2, VolumeX, X } from "lucide-react";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { apiUrl, assetUrl } from "../lib/frontend-paths";
import styles from "./group-chat.module.css";

const MESSAGE_LIMIT = 500;
const HISTORY_LIMIT = 120;
const SOUND_STORAGE = "amigo-secreto-chat-sound";
const TIME_LABEL = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DATE_LABEL = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" });

type ChatMessage = {
  id: string;
  sequence: number;
  kind: "member" | "system" | "announcement";
  authorId?: string;
  authorName: string;
  authorNickname?: string;
  text: string;
  hasPhoto: boolean;
  createdAt: string;
};
type ChatHistory = { messages: ChatMessage[]; cursor: number; reset?: boolean };
type ChatImage = { photo: string; author: string };
type MediaLoader = (kind: "avatar" | "photo", id: string) => Promise<string>;
type DraftSend = { text: string; photo: string; requestId: string };

class ChatRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function readPreference(key: string) {
  try {
    return typeof window === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function chatRequest<T>(sessionToken: string, payload: object, signal: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, sessionToken }),
    signal,
  });
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !data) throw new ChatRequestError(data?.error || "Não foi possível acessar o chat.", response.status);
  return data;
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[], resetCursor?: number) {
  const retained = resetCursor === undefined ? current : current.filter((message) => message.sequence > resetCursor);
  const messages = new Map(retained.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((left, right) => left.sequence - right.sequence).slice(-HISTORY_LIMIT);
}

async function prepareAttachment(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15_000_000) {
    throw new Error("Escolha uma imagem JPG, PNG ou WebP de até 15 MB.");
  }
  const image = await createImageBitmap(file).catch(() => { throw new Error("Não foi possível abrir esta imagem."); });
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("O navegador não conseguiu preparar a imagem.");
    for (const edge of [960, 720, 560, 420, 320]) {
      const scale = Math.min(1, edge / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const photo = canvas.toDataURL("image/jpeg", .76);
      if (photo.length <= 100_000) return photo;
    }
    throw new Error("A imagem ficou grande demais. Escolha outra foto.");
  } finally {
    image.close();
  }
}

function playChatTone(context: AudioContext | null, kind: "sent" | "incoming") {
  if (context?.state !== "running" || document.hidden) return;
  try {
    const pitches = kind === "sent" ? [659.25, 880] : [523.25, 783.99];
    pitches.forEach((pitch, index) => {
      const start = context.currentTime + .015 + index * .075;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = pitch;
      envelope.gain.setValueAtTime(.0001, start);
      envelope.gain.exponentialRampToValueAtTime(.055, start + .012);
      envelope.gain.exponentialRampToValueAtTime(.0001, start + .13);
      oscillator.connect(envelope);
      envelope.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + .13);
    });
  } catch {
    // Chat remains usable if the browser cannot play a tone.
  }
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("");
}

function useVisibleMedia(kind: "avatar" | "photo", id: string | undefined, load: MediaLoader) {
  const element = useRef<HTMLSpanElement>(null);
  const [media, setMedia] = useState<{ id: string; photo: string } | null>(null);
  useEffect(() => {
    const target = element.current;
    if (!target || !id) return;
    let active = true;
    const request = () => {
      void load(kind, id).then((photo) => {
        if (active) setMedia({ id, photo });
      }).catch(() => {
        if (active) setMedia({ id, photo: "" });
      });
    };
    if (typeof IntersectionObserver === "undefined") {
      request();
      return () => { active = false; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      request();
    });
    observer.observe(target);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [id, kind, load]);
  return { element, media: media?.id === id ? media : null };
}

function ChatAvatar({ message, load }: { message: ChatMessage; load: MediaLoader }) {
  const { element, media } = useVisibleMedia("avatar", message.kind === "member" ? message.authorId : undefined, load);
  const [failed, setFailed] = useState(false);
  const photo = message.kind === "member" ? media?.photo : assetUrl("/thyrddicks.png");
  return (
    <span className={styles.avatar} ref={element} aria-hidden="true">
      {message.kind === "announcement" ? <Pin size={17} /> : initials(message.authorName)}
      {photo && !failed && <img src={photo} alt="" onError={() => setFailed(true)} />}
    </span>
  );
}

function ChatAttachment({ message, load, onExpand }: {
  message: ChatMessage;
  load: MediaLoader;
  onExpand: (image: ChatImage, trigger: HTMLButtonElement) => void;
}) {
  const { element, media } = useVisibleMedia("photo", message.id, load);
  return (
    <span className={styles.attachment} ref={element}>
      {!media ? <span className={styles.photoPlaceholder}><ImagePlus size={16} aria-hidden="true" /> Foto</span>
        : media.photo ? (
          <button className={styles.photoButton} type="button" aria-label={`Ampliar foto de ${message.authorName}`}
            onClick={(event) => onExpand({ photo: media.photo, author: message.authorName }, event.currentTarget)}>
            <img src={media.photo} alt={`Foto enviada por ${message.authorName}`} />
            <span><Maximize2 size={14} aria-hidden="true" /></span>
          </button>
        ) : <span className={styles.photoPlaceholder}>Foto indisponível</span>}
    </span>
  );
}

function ChatItem({ message, own, load, onExpand }: {
  message: ChatMessage;
  own: boolean;
  load: MediaLoader;
  onExpand: (image: ChatImage, trigger: HTMLButtonElement) => void;
}) {
  const date = new Date(message.createdAt);
  return (
    <li className={styles.message} data-own={own || undefined} data-kind={message.kind}>
      <ChatAvatar message={message} load={load} />
      <div className={styles.bubble}>
        <div className={styles.messageMeta}>
          <span>
            <strong>{message.authorName}</strong>
            {message.authorNickname && <span className={styles.nick}> · {message.authorNickname}</span>}
          </span>
          {Number.isFinite(date.getTime()) && <time dateTime={message.createdAt}>{TIME_LABEL.format(date)}</time>}
        </div>
        {message.kind === "announcement" && <p className={styles.messageTag}><Pin size={12} aria-hidden="true" /> Importante</p>}
        {message.kind === "system" && <p className={styles.messageTag}><Bell size={12} aria-hidden="true" /> Sistema</p>}
        {message.text && <p className={styles.messageText}>{message.text}</p>}
        {message.hasPhoto && <ChatAttachment message={message} load={load} onExpand={onExpand} />}
      </div>
    </li>
  );
}

export default function GroupChat({ sessionToken, viewerId, onExpired }: {
  sessionToken: string;
  viewerId: string;
  onExpired?: (sessionToken: string) => void;
}) {
  const readStorage = `amigo-secreto-chat-read-v1:${viewerId}`;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [sound, setSound] = useState(() => readPreference(SOUND_STORAGE) !== "off");
  const [readThrough, setReadThrough] = useState(() => {
    const value = Number(readPreference(readStorage) ?? 0);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  });
  const [receivedThrough, setReceivedThrough] = useState(0);
  const [following, setFollowing] = useState(true);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [image, setImage] = useState<ChatImage | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const imageBack = useRef<HTMLButtonElement>(null);
  const imageTrigger = useRef<HTMLButtonElement | null>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const syncRequest = useRef<AbortController | null>(null);
  const sendRequest = useRef<AbortController | null>(null);
  const mediaRequests = useRef(new Set<AbortController>());
  const mediaCache = useRef(new Map<string, Promise<string>>());
  const pendingDraft = useRef<DraftSend | null>(null);
  const cursor = useRef<number | undefined>(undefined);
  const seen = useRef(readThrough);
  const audio = useRef<AudioContext | null>(null);
  const expired = useRef(false);
  const dialogId = useId();
  const titleId = useId();
  const composeId = useId();
  const latest = messages.at(-1)?.sequence ?? 0;
  const readableThrough = Math.min(latest, receivedThrough);
  const unread = messages.filter((message) => message.sequence > readThrough && message.authorId !== viewerId).length;
  const overLimit = Array.from(text).length > MESSAGE_LIMIT;

  const stopAudio = useCallback(() => {
    const context = audio.current;
    audio.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);

  useEffect(() => {
    function syncPreference(event: StorageEvent) {
      if (event.key === readStorage) {
        const value = Number(event.newValue ?? 0);
        if (Number.isSafeInteger(value) && value > seen.current) {
          seen.current = value;
          setReadThrough(value);
        }
      } else if (event.key === SOUND_STORAGE) {
        const enabled = event.newValue !== "off";
        setSound(enabled);
        if (!enabled) stopAudio();
      }
    }
    window.addEventListener("storage", syncPreference);
    window.addEventListener("pagehide", stopAudio);
    return () => {
      window.removeEventListener("storage", syncPreference);
      window.removeEventListener("pagehide", stopAudio);
      syncRequest.current?.abort();
      syncRequest.current = null;
      sendRequest.current?.abort();
      sendRequest.current = null;
      for (const request of mediaRequests.current) request.abort();
      mediaRequests.current.clear();
      mediaCache.current.clear();
      stopAudio();
    };
  }, [readStorage, stopAudio]);

  function unlockAudio() {
    try {
      const context = audio.current ?? new AudioContext();
      audio.current = context;
      if (context.state !== "running") void context.resume().catch(() => {});
    } catch {
      // Some browsers do not provide Web Audio.
    }
  }

  const handleError = useCallback((error: unknown, fallback: string) => {
    if (error instanceof ChatRequestError) {
      if (error.status === 401 && !expired.current) {
        expired.current = true;
        onExpired?.(sessionToken);
      }
      return error.message;
    }
    return fallback;
  }, [onExpired, sessionToken]);

  const sync = useCallback(async () => {
    if (document.hidden || syncRequest.current || expired.current) return;
    const request = new AbortController();
    syncRequest.current = request;
    const previousCursor = cursor.current;
    try {
      const history = await chatRequest<ChatHistory>(sessionToken, { action: "list", after: previousCursor }, request.signal);
      if (request.signal.aborted) return;
      const restarted = previousCursor !== undefined && history.cursor < previousCursor;
      if (seen.current > history.cursor && (restarted || previousCursor === undefined)) {
        seen.current = 0;
        setReadThrough(0);
        try { localStorage.removeItem(readStorage); } catch { /* Read state stays in memory. */ }
      }
      const hasIncoming = previousCursor !== undefined && history.messages.some((message) =>
        message.sequence > Math.max(previousCursor, seen.current) && message.authorId !== viewerId);
      cursor.current = history.cursor;
      setReceivedThrough(history.cursor);
      if (history.reset || history.messages.length) {
        setMessages((current) => mergeMessages(restarted ? [] : current, history.messages, history.reset ? history.cursor : undefined));
      }
      setLoaded(true);
      setSyncError("");
      if (hasIncoming) playChatTone(audio.current, "incoming");
    } catch (error) {
      if (!request.signal.aborted) setSyncError(handleError(error, "Não foi possível atualizar o chat."));
    } finally {
      if (syncRequest.current === request) syncRequest.current = null;
    }
  }, [handleError, readStorage, sessionToken, viewerId]);

  useEffect(() => {
    function check() { void sync(); }
    check();
    const interval = window.setInterval(check, open ? 12_000 : 30_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
    };
  }, [open, sync]);

  const loadMedia = useCallback<MediaLoader>((kind, id) => {
    const key = `${kind}:${id}`;
    const cached = mediaCache.current.get(key);
    if (cached) return cached;
    const request = new AbortController();
    mediaRequests.current.add(request);
    const data = chatRequest<{ photo: string }>(sessionToken,
      kind === "avatar" ? { action: kind, authorId: id } : { action: kind, messageId: id }, request.signal)
      .then(({ photo: value }) => value)
      .catch((error: unknown) => {
        if (mediaCache.current.get(key) === data) mediaCache.current.delete(key);
        if (!request.signal.aborted) handleError(error, "Foto indisponível.");
        throw error;
      })
      .finally(() => mediaRequests.current.delete(request));
    if (mediaCache.current.size >= 140) {
      const oldest = mediaCache.current.keys().next().value;
      if (oldest) mediaCache.current.delete(oldest);
    }
    mediaCache.current.set(key, data);
    return data;
  }, [handleError, sessionToken]);

  const markRead = useCallback((sequence: number) => {
    if (document.hidden || sequence <= seen.current) return;
    seen.current = sequence;
    setReadThrough(sequence);
    try { localStorage.setItem(readStorage, String(sequence)); } catch { /* Read state stays in memory. */ }
  }, [readStorage]);

  useEffect(() => {
    if (!open || !following || image) return;
    function followLatest() {
      if (!scrollArea.current || document.hidden) return;
      scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
      markRead(readableThrough);
    }
    const frame = requestAnimationFrame(followLatest);
    document.addEventListener("visibilitychange", followLatest);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", followLatest);
    };
  }, [following, image, latest, markRead, open, readableThrough]);

  function jumpToLatest() {
    setFollowing(true);
    if (scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
    markRead(readableThrough);
  }

  function trackScroll() {
    const element = scrollArea.current;
    if (!element || image) return;
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 45;
    setFollowing(atEnd);
    if (atEnd) markRead(readableThrough);
  }

  function closeChat() {
    setOpen(false);
    setImage(null);
    requestAnimationFrame(() => launcher.current?.focus());
  }

  function toggleChat() {
    if (open) {
      closeChat();
      return;
    }
    if (sound) unlockAudio();
    setFollowing(true);
    setOpen(true);
    requestAnimationFrame(() => closeButton.current?.focus());
  }

  function toggleSound() {
    const enabled = !sound;
    setSound(enabled);
    if (enabled) unlockAudio();
    else stopAudio();
    try { localStorage.setItem(SOUND_STORAGE, enabled ? "on" : "off"); } catch { /* Preference stays in memory. */ }
  }

  function expandImage(next: ChatImage, trigger: HTMLButtonElement) {
    imageTrigger.current = trigger;
    setImage(next);
    requestAnimationFrame(() => imageBack.current?.focus());
  }

  function closeImage() {
    setImage(null);
    requestAnimationFrame(() => imageTrigger.current?.focus());
  }

  async function attachPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || photoBusy || sending) return;
    setPhotoBusy(true);
    setSendError("");
    try {
      setPhoto(await prepareAttachment(file));
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Não foi possível preparar a foto.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = text.trim();
    if ((!content && !photo) || overLimit || photoBusy || sendRequest.current || expired.current) return;
    if (sound) unlockAudio();
    const request = new AbortController();
    sendRequest.current = request;
    setSending(true);
    setSendError("");

    try {
      const previous = pendingDraft.current;
      const requestId = previous?.text === content && previous.photo === photo ? previous.requestId : crypto.randomUUID();
      pendingDraft.current = { text: content, photo, requestId };
      const result = await chatRequest<{ message: ChatMessage }>(sessionToken, {
        action: "send",
        text: content || undefined,
        photo: photo || undefined,
        requestId,
      }, request.signal);
      if (request.signal.aborted) return;
      pendingDraft.current = null;
      setMessages((current) => mergeMessages(current, [result.message]));
      setText("");
      setPhoto("");
      setFollowing(true);
      playChatTone(audio.current, "sent");
      requestAnimationFrame(() => input.current?.focus());
    } catch (error) {
      if (!request.signal.aborted) setSendError(handleError(error, "Não foi possível enviar a mensagem. Tente novamente."));
    } finally {
      if (sendRequest.current === request) sendRequest.current = null;
      if (!request.signal.aborted) setSending(false);
    }
  }

  return (
    <div className={styles.widget}>
      {open && (
        <section id={dialogId} className={styles.panel} role="dialog" aria-labelledby={titleId}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            if (image) closeImage();
            else closeChat();
          }}>
          <header className={styles.header}>
            <span className={styles.headerIcon}><MessageCircle size={21} aria-hidden="true" /></span>
            <div className={styles.heading}>
              <h2 id={titleId}>Chat do grupo</h2>
              <p>Amigo Secreto</p>
            </div>
            <button className={styles.iconButton} type="button" aria-label="Som do chat" aria-pressed={sound} onClick={toggleSound}>
              {sound ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
            </button>
            <button ref={closeButton} className={styles.iconButton} type="button" aria-label="Fechar chat" onClick={closeChat}>
              <X size={20} aria-hidden="true" />
            </button>
          </header>

          <div className={styles.history} hidden={Boolean(image)}>
            <div className={styles.scroll} ref={scrollArea} onScroll={trackScroll} tabIndex={0} aria-label="Histórico de mensagens">
              {syncError && <div className={styles.notice}><p role="alert">{syncError}</p><button type="button" onClick={() => void sync()}>Tentar novamente</button></div>}
              {!loaded && !syncError && <p className={styles.empty} role="status">Carregando o chat…</p>}
              {loaded && !messages.length && <p className={styles.empty}>Ainda não há mensagens. Diga oi ao grupo!</p>}
              <ul className={styles.messages} role="list">
                {messages.map((message, index) => {
                  const day = new Date(message.createdAt);
                  const previous = messages[index - 1];
                  const showDate = Number.isFinite(day.getTime()) && (!previous || new Date(previous.createdAt).toDateString() !== day.toDateString());
                  return (
                    <MessageWithDate key={message.id} date={showDate ? DATE_LABEL.format(day) : undefined} message={message}
                      own={message.authorId === viewerId} load={loadMedia} onExpand={expandImage} />
                  );
                })}
              </ul>
            </div>
            {!following && unread > 0 && <button className={styles.jump} type="button" onClick={jumpToLatest}>
              <ArrowDown size={15} aria-hidden="true" /> Novas mensagens
            </button>}
          </div>

          {image && <div className={styles.photoView}>
            <button ref={imageBack} className={styles.back} type="button" onClick={closeImage}><ArrowLeft size={16} aria-hidden="true" /> Voltar ao chat</button>
            <img src={image.photo} alt={`Foto enviada por ${image.author}`} />
          </div>}

          <form className={styles.composer} hidden={Boolean(image)} onSubmit={sendMessage}>
            {photo && <div className={styles.preview}>
              <img src={photo} alt="Prévia da foto" />
              <span>Foto pronta para enviar</span>
              <button type="button" className={styles.iconButton} aria-label="Remover foto" disabled={sending} onClick={() => setPhoto("")}><X size={17} aria-hidden="true" /></button>
            </div>}
            {photoBusy && <p className={styles.note} role="status">Preparando a foto…</p>}
            {sendError && <p className={styles.error} role="alert">{sendError}</p>}
            {overLimit && <p className={styles.error} role="status">A mensagem pode ter até {MESSAGE_LIMIT} caracteres.</p>}
            <div className={styles.composerRow}>
              <input type="file" accept="image/jpeg,image/png,image/webp" ref={fileInput} hidden onChange={attachPhoto} />
              <button className={styles.iconButton} type="button" aria-label="Anexar foto" title="Anexar foto"
                disabled={photoBusy || sending} onClick={() => fileInput.current?.click()}><ImagePlus size={19} aria-hidden="true" /></button>
              <label className={styles.srOnly} htmlFor={composeId}>Mensagem</label>
              <textarea id={composeId} ref={input} value={text} rows={1} maxLength={MESSAGE_LIMIT * 2} placeholder="Escreva uma mensagem"
                aria-invalid={overLimit} disabled={sending} onChange={(event) => { setText(event.target.value); setSendError(""); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }} />
              <button className={styles.send} type="submit" aria-label={sending ? "Enviando mensagem" : "Enviar mensagem"} title="Enviar mensagem"
                disabled={sending || photoBusy || overLimit || (!text.trim() && !photo)}><Send size={17} aria-hidden="true" /></button>
            </div>
          </form>
        </section>
      )}

      <button className={styles.launcher} ref={launcher} type="button" aria-controls={open ? dialogId : undefined}
        aria-expanded={open} aria-label={open ? "Fechar chat do grupo" : unread ? `Abrir chat do grupo, ${unread} ${unread === 1 ? "mensagem não lida" : "mensagens não lidas"}` : "Abrir chat do grupo"}
        onClick={toggleChat}>
        {open ? <X size={23} aria-hidden="true" /> : <MessageCircle size={24} aria-hidden="true" />}
        {!open && unread > 0 && <span className={styles.led} aria-hidden="true" />}
      </button>
    </div>
  );
}

function MessageWithDate({ date, ...props }: Parameters<typeof ChatItem>[0] & { date?: string }) {
  return (
    <>
      {date && <li className={styles.dateSeparator}><span>{date}</span></li>}
      <ChatItem {...props} />
    </>
  );
}
