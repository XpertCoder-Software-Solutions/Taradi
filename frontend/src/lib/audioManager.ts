export const AUDIO_BLOCKED_EVENT = "taradi:audio-blocked";

const NEW_MESSAGE_SOUND_URL = "/sounds/new-message.mp3";
const MIN_PLAY_INTERVAL_MS = 500;
const MAX_PENDING_PLAYS = 8;
const SESSION_AUDIO_ENABLED_KEY = "taradi.audio.enabled.session";

let audio: HTMLAudioElement | null = null;
let enabled = true;
let pendingPlays = 0;
let lastPlayStartedAt = 0;
let drainTimer: number | null = null;

function canUseAudio() {
  return typeof window !== "undefined" && typeof Audio !== "undefined";
}

function readSessionEnabled() {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    return window.sessionStorage.getItem(SESSION_AUDIO_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

function persistSessionEnabled(value: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(SESSION_AUDIO_ENABLED_KEY, String(value));
  } catch {
    // Session persistence is optional; the in-memory flag still controls audio.
  }
}

function dispatchAudioBlocked() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUDIO_BLOCKED_EVENT));
  }
}

function getAudio() {
  if (!canUseAudio()) {
    return null;
  }

  if (!audio) {
    audio = new Audio(NEW_MESSAGE_SOUND_URL);
    audio.preload = "auto";
    audio.volume = 1;
  }

  return audio;
}

function clearDrainTimer() {
  if (drainTimer !== null) {
    if (typeof window !== "undefined") {
      window.clearTimeout(drainTimer);
    }

    drainTimer = null;
  }
}

function scheduleDrain(delayMs: number) {
  if (typeof window === "undefined") {
    return;
  }

  clearDrainTimer();
  drainTimer = window.setTimeout(() => {
    drainTimer = null;
    void drainQueue();
  }, delayMs);
}

async function startPlayback() {
  const sound = getAudio();

  if (!enabled || !sound) {
    return;
  }

  try {
    sound.pause();
    sound.currentTime = 0;
    sound.volume = 1;
    await sound.play();
  } catch {
    pendingPlays = 0;
    dispatchAudioBlocked();
  }
}

async function drainQueue() {
  if (!enabled || pendingPlays <= 0) {
    return;
  }

  const elapsedMs = Date.now() - lastPlayStartedAt;

  if (elapsedMs < MIN_PLAY_INTERVAL_MS) {
    scheduleDrain(MIN_PLAY_INTERVAL_MS - elapsedMs);
    return;
  }

  pendingPlays -= 1;
  lastPlayStartedAt = Date.now();
  await startPlayback();

  if (pendingPlays > 0) {
    scheduleDrain(MIN_PLAY_INTERVAL_MS);
  }
}

export function playIncomingMessage() {
  enabled = readSessionEnabled();

  if (!enabled) {
    return;
  }

  pendingPlays = Math.min(pendingPlays + 1, MAX_PENDING_PLAYS);
  void drainQueue();
}

export async function enableAudio() {
  enabled = true;
  persistSessionEnabled(true);

  const sound = getAudio();

  if (!sound) {
    return false;
  }

  try {
    const previousVolume = sound.volume;
    sound.volume = 0;
    await sound.play();
    sound.pause();
    sound.currentTime = 0;
    sound.volume = previousVolume || 1;
    return true;
  } catch {
    sound.volume = 1;
    dispatchAudioBlocked();
    return false;
  }
}

export function disableAudio() {
  enabled = false;
  persistSessionEnabled(false);
  pendingPlays = 0;
  clearDrainTimer();

  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}
