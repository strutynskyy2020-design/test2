import { clamp } from './pixelCatMotion';

export const CAT_MODES = ['sit', 'sleep', 'eat', 'walk', 'groom', 'rise'];
const smooth = x => { const t = clamp(x); return t * t * (3 - 2 * t); };
const weightsFor = mode => Object.fromEntries(CAT_MODES.map(key => [key, key === mode ? 1 : 0]));
const dominant = weights => CAT_MODES.reduce((best, key) => weights[key] > weights[best] ? key : best, 'sit');
export function createCatTransition(mode = 'sit') {
  return { target: mode, age: 1, duration: 0, bridge: false, squash: 0, fromSquash: 0, from: weightsFor(mode), weights: weightsFor(mode) };
}

// Weights drive registration and pose timing only, never image opacity.
// A single opaque exposure avoids doubled eyes, feet and see-through fur.
export function stepCatTransition(state, target, seconds, immediate = false) {
  if (immediate) {
    Object.assign(state, createCatTransition(target));
    return state.weights;
  }
  if (target !== state.target) {
    const from = dominant(state.weights);
    state.fromSquash = state.squash;
    state.from = { ...state.weights }; state.target = target; state.age = 0;
    state.bridge = from !== target && ((from === 'walk' && ['sit', 'sleep', 'groom'].includes(target)) || (target === 'walk' && ['sit', 'sleep', 'groom'].includes(from)) || (from === 'sit' && target === 'sleep') || (from === 'sleep' && target === 'sit'));
    state.duration = state.bridge ? .46 : .24;
  }
  state.age = Math.min(state.duration, state.age + clamp(seconds, 0, .05));
  const progress = state.duration ? clamp(state.age / state.duration) : 1;
  const split = .52, first = state.bridge && progress < split;
  const from = first || !state.bridge ? state.from : weightsFor('rise');
  const to = weightsFor(first ? 'rise' : target);
  const mix = smooth(state.bridge ? first ? progress / split : (progress - split) / (1 - split) : progress);
  for (const mode of CAT_MODES) state.weights[mode] = from[mode] * (1 - mix) + to[mode] * mix;
  state.squash = progress === 1 ? 0 : state.fromSquash * (1 - smooth(progress)) + Math.sin(Math.PI * progress) ** 2 * .018;
  return state.weights;
}

export function catTransitionPresentation(state, facing = -1) {
  const mode = dominant(state.weights);
  return { mode, opacity: weightsFor(mode), registration: transitionRegistration(state.weights, facing),
    scaleX: 1 + state.squash * .5, scaleY: 1 - state.squash };
}

export function actionVisualMode(sequence, age = 0, still = false) {
  if (sequence === 'pounce') return still || age < 1.48 ? 'walk' : 'sit';
  if (sequence === 'clean') return still || age < 3.4 ? 'groom' : 'sit';
  if (sequence === 'sleep') return 'sleep';
  if (sequence === 'eat') return 'eat';
  return sequence.startsWith('walk') ? 'walk' : 'sit';
}
const pulse = (age, start, peak, end) => age < start || age > end ? 0 : age < peak ? smooth((age - start) / (peak - start)) : 1 - smooth((age - peak) / (end - peak));
export function pounceFrame(age, still = false) {
  if (still) return { lift: 0, crouch: 0, tuck: 0, pitch: 0, shadow: 1 };
  const flight = clamp((age - .5) / .58), air = flight > 0 && flight < 1 ? Math.sin(Math.PI * flight) : 0;
  return {
    lift: 145 * air,
    crouch: pulse(age, .06, .33, .5) + pulse(age, 1.08, 1.19, 1.46) * .65,
    tuck: air,
    pitch: -3 * Math.sin(2 * Math.PI * flight) * air,
    shadow: 1 - air * .38,
  };
}
export function groomingFrame(age, still = false) {
  if (still) return { paw: 0, lift: 0 };
  const envelope = smooth((age - .25) / .25) * (1 - smooth((age - 2.8) / .45));
  const stroke = Math.sin((age - .25) * Math.PI * 2 * 1.4);
  return { paw: stroke * 2.1 * envelope, lift: -Math.max(0, stroke) * 5 * envelope };
}
export const yawnAmount = (age, still = false) => still ? 1 : pulse(age, .18, .9, 2.0);

// Register the face horizontally while the torso turns between three poses.
// Pure poses have zero offset; vertical coordinates keep the foot plane fixed.
export function transitionRegistration(weights, facing = -1) {
  const anchors = { sit: 775, rise: facing > 0 ? 1015 : 585, walk: facing > 0 ? 1188 : 412, sleep: 550, eat: 430, groom: 775 };
  const total = CAT_MODES.reduce((sum, mode) => sum + (weights[mode] || 0), 0);
  if (total <= 0) return Object.fromEntries(CAT_MODES.map(mode => [mode, 0]));
  const x = Object.entries(anchors).reduce((sum, [mode, anchor]) => sum + anchor * (weights[mode] || 0), 0) / total;
  const strength = smooth(total);
  return Object.fromEntries(Object.entries(anchors).map(([mode, anchor]) => [mode, (x - anchor) * strength]));
}
