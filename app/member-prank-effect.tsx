"use client";

import { SkipForward, Volume2, VolumeX, X } from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { assetUrl } from "../lib/frontend-paths";
import styles from "./member-prank-effect.module.css";

type PrankEffectProps = {
  kind: "tomato" | "scare";
  senderName: string;
  onFinish: () => void;
};

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const CAPTION_TIME = 2;
const CLIP_VOLUME = .18;

function usePrankDialog(onFinish: () => void) {
  const dialog = useRef<HTMLDialogElement>(null);
  const completion = useRef(onFinish);
  const finished = useRef(false);

  useEffect(() => {
    completion.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    if (dialog.current?.open) dialog.current.close();
    completion.current();
  }, []);

  function cancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    finish();
  }

  return { dialog, finish, cancel };
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION).matches;
}

function ScareEffect({ senderName, onFinish }: Omit<PrankEffectProps, "kind">) {
  const { dialog, finish, cancel } = usePrankDialog(onFinish);
  const video = useRef<HTMLVideoElement>(null);
  const descriptionId = useId();
  const [still, setStill] = useState(prefersReducedMotion);
  const [caption, setCaption] = useState(false);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const preference = window.matchMedia(REDUCED_MOTION);
    function onPreference(event: MediaQueryListEvent) {
      if (event.matches) setStill(true);
    }
    preference.addEventListener("change", onPreference);
    return () => preference.removeEventListener("change", onPreference);
  }, []);

  useEffect(() => {
    if (still) {
      const showCaption = window.setTimeout(() => setCaption(true), CAPTION_TIME * 1000);
      const closeScene = window.setTimeout(finish, 4800);
      return () => {
        window.clearTimeout(showCaption);
        window.clearTimeout(closeScene);
      };
    }

    const element = video.current;
    if (!element) return;
    const clip = element;
    let active = true;
    let frame: number | undefined;
    let deadline = window.setTimeout(finish, 35_000);

    function fallBack() {
      if (!active) return;
      setStill(true);
      if (clip.currentTime >= CAPTION_TIME) setCaption(true);
    }

    const startup = window.setTimeout(() => {
      if (clip.currentTime < .05) fallBack();
    }, 4300);

    function metadata() {
      if (!Number.isFinite(clip.duration)) return;
      window.clearTimeout(deadline);
      const timeout = Math.min(120_000, Math.max(12_000, (clip.duration + 8) * 1000));
      deadline = window.setTimeout(finish, timeout);
    }

    function timedCaption() {
      if (clip.currentTime >= CAPTION_TIME) setCaption(true);
    }

    function watchFrame(_time: number, info: VideoFrameCallbackMetadata) {
      if (!active) return;
      if (info.mediaTime >= CAPTION_TIME) {
        setCaption(true);
        frame = undefined;
      } else {
        frame = clip.requestVideoFrameCallback(watchFrame);
      }
    }

    async function playClip() {
      clip.volume = CLIP_VOLUME;
      clip.muted = clip.volume > CLIP_VOLUME;
      try {
        await clip.play();
      } catch {
        if (!active) return;
        clip.muted = true;
        try {
          await clip.play();
        } catch {
          fallBack();
        }
      }
      if (active) setMuted(clip.muted);
    }

    clip.addEventListener("loadedmetadata", metadata);
    clip.addEventListener("timeupdate", timedCaption);
    clip.addEventListener("ended", finish);
    clip.addEventListener("error", fallBack);
    if (typeof clip.requestVideoFrameCallback === "function") frame = clip.requestVideoFrameCallback(watchFrame);
    void playClip();
    return () => {
      active = false;
      clip.pause();
      clip.removeEventListener("loadedmetadata", metadata);
      clip.removeEventListener("timeupdate", timedCaption);
      clip.removeEventListener("ended", finish);
      clip.removeEventListener("error", fallBack);
      if (frame !== undefined) clip.cancelVideoFrameCallback(frame);
      window.clearTimeout(startup);
      window.clearTimeout(deadline);
    };
  }, [finish, still]);

  function toggleAudio() {
    const clip = video.current;
    if (!clip) return;
    clip.volume = CLIP_VOLUME;
    clip.muted = !clip.muted;
    setMuted(clip.muted);
  }

  return (
    <dialog className={styles.scare} ref={dialog} onCancel={cancel} aria-label="Susto do grupo" aria-describedby={descriptionId}>
      <p id={descriptionId} className={styles.srOnly}>Brincadeira recebida. Use Escape ou Pular susto para voltar ao site.</p>
      {!still && <video ref={video} className={styles.video} src={assetUrl("/susto.mp4")} playsInline preload="auto" aria-hidden="true" />}
      {caption && <p className={still ? `${styles.ghost} ${styles.still}` : styles.ghost} role="status">{senderName} está te vendo.</p>}
      <div className={styles.scareControls}>
        {!still && <button type="button" className={styles.iconControl} aria-label="Som do susto" aria-pressed={!muted} onClick={toggleAudio}>
          {muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
        </button>}
        <button type="button" autoFocus onClick={finish}><SkipForward size={17} aria-hidden="true" /> Pular susto</button>
      </div>
    </dialog>
  );
}

function TomatoFruit() {
  const gradient = useId();
  return (
    <svg className={styles.tomato} viewBox="0 0 124 112" aria-hidden="true">
      <defs>
        <radialGradient id={gradient} cx="35%" cy="26%" r="69%">
          <stop stopColor="#ff9b73" />
          <stop offset=".48" stopColor="#e95a40" />
          <stop offset="1" stopColor="#ac312b" />
        </radialGradient>
      </defs>
      <path d="M64 29c12-10 31-9 41 5 12 17 10 41-5 57-9 10-23 16-37 15-23-1-43-13-49-32C8 53 18 35 34 28c10-5 22-4 30 1Z" fill={`url(#${gradient})`} />
      <path d="M64 30c-4-9-4-17 1-25l6 4c-5 8-5 14-2 20l18-7-13 15 9 10-20-5-17 8 8-13-16-8 21 1Z" fill="#467841" />
      <path d="M31 45c-4 5-6 11-5 16M37 41l5-2" stroke="#ffce9b" strokeWidth="4" strokeLinecap="round" opacity=".65" />
    </svg>
  );
}

function TomatoSplat() {
  return (
    <svg className={styles.splat} viewBox="0 0 388 310" aria-hidden="true">
      <g fill="#df523c">
        <path d="M191 61c12 33 25 26 45 11 16-11 38-26 42-13 4 11-13 36-5 50 12 22 77 6 85 21 9 17-39 27-46 41-10 23 41 45 29 58-11 13-48-2-77-8-23-4-22 24-18 46 3 17-4 32-16 23-14-11-26-43-48-39-21 4-40 46-55 38-14-8-3-30 6-48 11-24-3-37-22-36-23 1-56 13-62-1-5-14 20-23 31-39 15-21-26-41-28-56-3-20 34-11 64-5 16 3 26-12 22-28-3-14-7-47 6-50 14-4 36 25 47 35Z" />
        <ellipse cx="72" cy="69" rx="12" ry="7" transform="rotate(34 72 69)" />
        <ellipse cx="324" cy="69" rx="16" ry="7" transform="rotate(-32 324 69)" />
        <ellipse cx="343" cy="257" rx="10" ry="6" transform="rotate(29 343 257)" />
        <ellipse cx="111" cy="258" rx="7" ry="12" transform="rotate(32 111 258)" />
        <circle cx="366" cy="192" r="8" />
        <circle cx="26" cy="169" r="10" />
        <circle cx="182" cy="20" r="8" />
        <circle cx="295" cy="263" r="6" />
      </g>
      <path d="M108 146c18-27 55-48 90-42 31 5 40 28 69 40-20 8-31 8-44 25-11 17-14 38-36 37-21-1-27-28-53-27-11 1-32 5-37-4-5-10 5-20 11-29Z" fill="#f46d4d" />
      <path d="M134 144c14-12 37-18 57-15m28 26 7 3" fill="none" stroke="#ffab76" strokeWidth="7" strokeLinecap="round" opacity=".72" />
      <g fill="#ffe3a0" opacity=".87">
        <ellipse cx="172" cy="161" rx="6" ry="2.5" transform="rotate(-25 172 161)" />
        <ellipse cx="199" cy="175" rx="6" ry="2.5" transform="rotate(38 199 175)" />
        <ellipse cx="221" cy="142" rx="5" ry="2.3" transform="rotate(-39 221 142)" />
      </g>
    </svg>
  );
}

function TomatoEffect({ senderName, onFinish }: Omit<PrankEffectProps, "kind">) {
  const { dialog, finish, cancel } = usePrankDialog(onFinish);
  const labelId = useId();

  useEffect(() => {
    const timer = window.setTimeout(finish, prefersReducedMotion() ? 1700 : 2380);
    return () => window.clearTimeout(timer);
  }, [finish]);

  return (
    <dialog className={styles.tomatoScene} ref={dialog} onCancel={cancel} aria-labelledby={labelId}>
      <div className={styles.tomatoArt}><TomatoFruit /><TomatoSplat /></div>
      <div className={styles.tomatoNotice}>
        <p id={labelId}>{senderName} jogou um tomate!</p>
        <button type="button" autoFocus aria-label="Limpar tomate" onClick={finish}><X size={18} aria-hidden="true" /></button>
      </div>
    </dialog>
  );
}

export default function MemberPrankEffect({ kind, ...props }: PrankEffectProps) {
  return kind === "scare" ? <ScareEffect {...props} /> : <TomatoEffect {...props} />;
}
