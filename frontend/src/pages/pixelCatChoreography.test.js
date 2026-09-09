import { createCatTransition, stepCatTransition, catTransitionPresentation, actionVisualMode, pounceFrame, groomingFrame, yawnAmount, transitionRegistration, CAT_MODES } from './pixelCatChoreography';

test('every transition and rapid interruption renders exactly one fully opaque silhouette', () => {
  const state = createCatTransition('sit');
  for (const target of CAT_MODES) for (let i = 0; i < 50; i++) {
    stepCatTransition(state, target, 1 / 120);
    const frame = catTransitionPresentation(state);
    expect(Object.values(frame.opacity).filter(Boolean)).toEqual([1]);
    const before = catTransitionPresentation(state);
    stepCatTransition(state, CAT_MODES[(i + 1) % CAT_MODES.length], 0);
    expect(catTransitionPresentation(state)).toEqual(before);
  }
});

const sum = weights => Object.values(weights).reduce((a, b) => a + b, 0);
test('standing transitions pass through the registered bridge before allowing travel', () => {
  const state = createCatTransition('sit');
  for (let i = 0; i < 5; i++) stepCatTransition(state, 'walk', .05);
  expect(state.weights.rise).toBeGreaterThan(.98);
  expect(state.weights.walk).toBeLessThan(.1);
  for (let i = 0; i < 6; i++) stepCatTransition(state, 'walk', .05);
  expect(state.weights.walk).toBe(1);
});
test('interrupted transitions start from the displayed weights and settle exactly', () => {
  const state = createCatTransition('sit');
  for (const mode of ['walk', 'sleep', 'sit', 'groom', 'walk', 'eat']) {
    stepCatTransition(state, mode, .05);
    const before = { ...state.weights };
    stepCatTransition(state, mode === 'sit' ? 'sleep' : 'sit', 0);
    expect(state.weights).toEqual(before);
    for (let i = 0; i < 15; i++) {
      stepCatTransition(state, mode, .05);
      expect(sum(state.weights)).toBeCloseTo(1, 9);
      expect(Object.values(state.weights).every(value => value >= 0 && value <= 1)).toBe(true);
    }
    expect(state.weights[mode]).toBe(1);
  }
});
test.each([30, 60, 120])('transition duration is time based at %s FPS', fps => {
  const state = createCatTransition('sit');
  for (let i = 0; i < fps; i++) stepCatTransition(state, 'walk', 1 / fps);
  expect(state.weights.walk).toBe(1);
});
test('jump has anticipation, airborne paws and one soft landing, not an endless loop', () => {
  expect(pounceFrame(.33).crouch).toBeCloseTo(1);
  expect(pounceFrame(.33).lift).toBe(0);
  expect(pounceFrame(.79).lift).toBeCloseTo(145);
  expect(pounceFrame(.79).shadow).toBeCloseTo(.62);
  expect(pounceFrame(1.19).crouch).toBeGreaterThan(.5);
  for (const age of [2, 6.5, 100]) {
    expect(pounceFrame(age).lift).toBeCloseTo(0);
    expect(pounceFrame(age).crouch).toBe(0);
    expect(actionVisualMode('pounce', age)).toBe('sit');
  }
});
test('action poses finish once; quiet mode retains a motionless representative pose', () => {
  expect(actionVisualMode('clean', 1)).toBe('groom');
  expect(actionVisualMode('clean', 4)).toBe('sit');
  expect(actionVisualMode('clean', 4, true)).toBe('groom');
  expect(groomingFrame(1).paw).not.toBe(0);
  expect(groomingFrame(1, true)).toEqual({ paw: 0, lift: 0 });
  expect(pounceFrame(.79, true).lift).toBe(0);
  expect(yawnAmount(.9)).toBe(1); expect(yawnAmount(3)).toBe(0);
});

test('turning poses share a horizontal face anchor without rescaling the artwork', () => {
  const state = createCatTransition('sit');
  expect(transitionRegistration(state.weights).sit).toBe(0);
  const weights = { ...state.weights, sit: .5, rise: .5 };
  const left = transitionRegistration(weights), right = transitionRegistration(weights, 1);
  expect(775 + left.sit).toBe(585 + left.rise);
  expect(775 + right.sit).toBe(1015 + right.rise);
  for (const mode of CAT_MODES) expect(transitionRegistration(createCatTransition(mode).weights)[mode]).toBe(0);
});
