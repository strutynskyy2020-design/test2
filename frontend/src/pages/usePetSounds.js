import { useCallback, useEffect, useRef } from "react";

// Short synthesized effects: no audio downloads, microphone or recordings.
export function usePetSounds(enabled) {
  const audio = useRef(null), voices = useRef(new Set());
  useEffect(() => {
    if (!enabled) return undefined;
    const unlock = () => {
      if (document.hidden) return;
      try { if (!audio.current) audio.current = new (window.AudioContext || window.webkitAudioContext)(); void audio.current.resume().catch(() => {}); } catch (_) {}
    };
    const stop = () => { voices.current.forEach((stopVoice) => stopVoice()); voices.current.clear(); if (audio.current) { void audio.current.close().catch(() => {}); audio.current = null; } };
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener("pointerdown", unlock); document.addEventListener("keydown", unlock); document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("pointerdown", unlock); document.removeEventListener("keydown", unlock); document.removeEventListener("visibilitychange", hide); stop(); };
  }, [enabled]);
  return useCallback((kind) => {
    const ctx = audio.current;
    if (!enabled || !ctx || ctx.state !== "running" || document.hidden || voices.current.size >= 3) return;
    const duration = kind === "purr" ? .9 : kind === "clean" ? .4 : .16;
    const source = ctx.createOscillator(), gain = ctx.createGain(), start = ctx.currentTime;
    source.type = kind === "eat" ? "triangle" : "sine";
    const freq = { purr: 85, eat: 420, clean: 760, bounce: 180, refuse: 260, sleep: 180, yawn: 130, pounce: 310 }[kind] || 240;
    source.frequency.setValueAtTime(freq, start); source.frequency.exponentialRampToValueAtTime(freq * .65, start + duration);
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.035, start + .015); gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(gain); gain.connect(ctx.destination);
    let mod, modGain;
    if (kind === "purr") { mod = ctx.createOscillator(); modGain = ctx.createGain(); mod.frequency.value = 25; modGain.gain.value = .025; mod.connect(modGain); modGain.connect(gain.gain); mod.start(); }
    const cleanup = () => { try { source.stop(); mod?.stop(); } catch (_) {} source.disconnect(); gain.disconnect(); mod?.disconnect(); modGain?.disconnect(); voices.current.delete(cleanup); };
    voices.current.add(cleanup); source.onended = cleanup; source.start(); source.stop(start + duration);
  }, [enabled]);
}
