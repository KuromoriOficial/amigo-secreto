"use client";

import { Sparkles } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import { apiUrl, assetUrl } from "../lib/frontend-paths";

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const REVEAL_DURATION = 2900;

export type Profile = { name: string; nickname?: string; photo: string };
export type RevealAudio = { context: AudioContext; bus: GainNode | null; achievement: Promise<AudioBuffer | null> };

type Bell = readonly [offset: number, pitch: number, decay: number, volume: number];

const ROLL_SCORE: readonly Bell[] = [
  [0, 69, .19, .065], [.15, 74, .17, .07], [.3, 78, .17, .07], [.46, 81, .2, .075],
  [.66, 76, .19, .065], [.83, 81, .17, .07], [1, 85, .18, .075], [1.19, 81, .2, .07],
  [1.42, 71, .2, .065], [1.63, 74, .21, .075], [1.86, 78, .22, .085],
  [2.1, 83, .26, .09], [2.39, 81, .4, .09],
];

const PARTICLES = [
  [-154, -31, -125, "#be523b"], [-142, 35, -72, "#e4b95e"], [-111, -51, 90, "#80a878"],
  [-99, 31, 125, "#adcd91"], [-74, -39, -90, "#e0b151"], [-58, 41, 140, "#c8533d"],
  [-32, -48, -100, "#e0b151"], [-13, 46, 120, "#8eaa76"], [19, -46, 75, "#f4cf79"],
  [35, 39, 92, "#dbaa4c"], [51, -38, 110, "#bc4937"], [72, 47, -134, "#81ad77"],
  [93, -44, 96, "#e3b650"], [110, 30, 128, "#c3523d"], [134, -42, -92, "#ebc46d"],
  [147, 31, 130, "#adcd91"], [161, -17, -98, "#76a073"],
] as const;

export function prepareRevealAudio(): RevealAudio | null {
  try {
    const context = new AudioContext();
    void context.resume().catch(() => {});
    const achievement = fetch(assetUrl("/minecraft-rare-achievement.mp3"))
      .then((response) => response.ok ? response.arrayBuffer() : null)
      .then((bytes) => bytes ? context.decodeAudioData(bytes) : null)
      .catch(() => null);
    return { context, bus: null, achievement };
  } catch {
    return null;
  }
}

export function playRollingAudio(audio: RevealAudio | null) {
  if (!audio || audio.context.state === "closed") return;

  try {
    const { context } = audio;
    audio.bus?.disconnect();
    const bus = context.createGain();
    bus.gain.value = .27;
    bus.connect(context.destination);
    audio.bus = bus;
    const start = context.currentTime + .02;

    for (const [offset, pitch, decay, volume] of ROLL_SCORE) {
      const time = start + offset;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
      envelope.gain.setValueAtTime(.0001, time);
      envelope.gain.exponentialRampToValueAtTime(volume, time + .008);
      envelope.gain.exponentialRampToValueAtTime(.0001, time + decay);
      oscillator.connect(envelope);
      envelope.connect(bus);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
      };
      oscillator.start(time);
      oscillator.stop(time + decay);
    }

  } catch {
    // The reveal can continue when audio is unavailable.
  }
}

export function playAdvancementAudio(audio: RevealAudio | null) {
  if (!audio || audio.context.state === "closed") return;
  audio.bus?.disconnect();
  audio.bus = null;

  void audio.achievement.then((buffer) => {
    const { context } = audio;
    if (!buffer || context.state === "closed") return;
    const source = context.createBufferSource();
    const bus = context.createGain();
    source.buffer = buffer;
    bus.gain.value = .65;
    source.connect(bus);
    bus.connect(context.destination);
    audio.bus = bus;
    source.onended = () => {
      source.disconnect();
      bus.disconnect();
      if (audio.bus === bus) audio.bus = null;
    };
    source.start();
  }).catch(() => {});
}

export function profilePhotoUrl(photo: string) {
  return photo.startsWith("/api/") ? apiUrl(photo) : assetUrl(photo);
}

export function ProfilePhoto({ person }: { person: Profile }) {
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

export function rouletteFrames(result: { person: Profile; candidates?: Profile[] }): Profile[] {
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

function frameTime(index: number, count: number) {
  const progress = index / count;
  return REVEAL_DURATION * (.34 * progress + .66 * progress ** 3);
}

function frameDuration(index: number, count: number) {
  return frameTime(index + 1, count) - frameTime(index, count);
}

function ReelPeek({ person }: { person?: Profile }) {
  return (
    <div className="as-reel-peek">
      {person ? <><ProfilePhoto person={person} /><span>{person.name}</span></> : <span>•••</span>}
    </div>
  );
}

export function Roulette<Attempt>({ reel, onFinish }: {
  reel: { attempt: Attempt; frames: Profile[] };
  onFinish: (attempt: Attempt) => void;
}) {
  const [frameIndex, setFrameIndex] = useState(0);
  const count = reel.frames.length;

  useEffect(() => {
    let index = 0;
    let timer = 0;
    let finished = false;
    const motionPreference = window.matchMedia(REDUCED_MOTION);

    function finish() {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      onFinish(reel.attempt);
    }

    function skipMotion(event: MediaQueryListEvent) {
      if (event.matches) finish();
    }

    function nextFrame() {
      timer = window.setTimeout(() => {
        index += 1;
        if (index === count) finish();
        else {
          setFrameIndex(index);
          nextFrame();
        }
      }, frameDuration(index, count));
    }

    if (motionPreference.matches) finish();
    else nextFrame();
    motionPreference.addEventListener("change", skipMotion);
    return () => {
      finished = true;
      window.clearTimeout(timer);
      motionPreference.removeEventListener("change", skipMotion);
    };
  }, [count, reel, onFinish]);

  const person = reel.frames[frameIndex];
  const settling = frameIndex >= count - 2;
  const speed = `${Math.min(160, frameDuration(frameIndex, count) * .86)}ms`;
  return (
    <div className={settling ? "as-reel as-reel-settling" : "as-reel"}>
      <div className="as-reel-heading">
        <p className="as-reel-label" role="status"><Sparkles size={16} aria-hidden="true" /> Girando a roleta…</p>
        <span className="as-reel-readout" aria-hidden="true">{settling ? "Quase lá" : "Em movimento"}</span>
      </div>
      <div className="as-reel-window" aria-hidden="true">
        <ReelPeek key={`before-${frameIndex}`} person={reel.frames[frameIndex - 1]} />
        <div className="as-reel-lane">
          <div className="as-reel-frame" key={frameIndex} style={{ "--as-reel-speed": speed } as CSSProperties}>
            <ProfilePhoto person={person} />
            <div>
              <span className="as-reel-caption">Na roleta</span>
              <strong>{person.name}</strong>
              {person.nickname && <span className="as-person-nickname">“{person.nickname}”</span>}
            </div>
          </div>
        </div>
        <ReelPeek key={`after-${frameIndex}`} person={reel.frames[frameIndex + 1]} />
      </div>
      <div className="as-reel-progress" aria-hidden="true"><span style={{ animationDuration: `${REVEAL_DURATION}ms` }} /></div>
    </div>
  );
}

export function RevealConfetti() {
  return (
    <span className="as-confetti" aria-hidden="true">
      <span className="as-result-halo" />
      <Sparkles className="as-result-star" size={28} strokeWidth={1.5} />
      {PARTICLES.map(([x, y, spin, color]) => (
        <i key={x} style={{ "--as-confetti-x": `${x}px`, "--as-confetti-y": `${y}px`, "--as-confetti-spin": `${spin}deg`, backgroundColor: color } as CSSProperties} />
      ))}
    </span>
  );
}
