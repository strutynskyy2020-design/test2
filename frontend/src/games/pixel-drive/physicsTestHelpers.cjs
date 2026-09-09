// Test-only driver; never imported by the product or offered as automatic play.
const {
  createDrive,
  stepDrive,
  terrain
} = require('./engine');
const flatLevel = (extra = {}) => ({
  id: -1,
  name: 'Контрольна пряма',
  length: 1000,
  meters: 1000,
  max_ticks: 10800,
  terrain: [[-100, 0], [1200, 0]],
  gears: [],
  fuel: [],
  bridges: [],
  ...extra
});
const runTicks = (level, state, ticks, input = 0) => {
  for (let n = 0; n < ticks && state.status === 'playing'; n++) stepDrive(level, state, typeof input === 'function' ? input(state, n) : input);
  return state;
};
function pilotInput(level, state, speed = 12) {
  const angle = Math.atan2(Math.sin(state.angle), Math.cos(state.angle));
  const slopeAt = x => Math.atan((terrain(level, x + 3) - terrain(level, x - 3)) / 6);
  if (state.grounded === 0) {
    const target = slopeAt(state.x + state.vx * .4),
      error = Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
    const alpha = 7 * error - 2.8 * state.av;
    return alpha > .4 ? 1 : alpha < -.4 ? 2 : 0;
  }
  if (state.vx > speed + 1 || angle > slopeAt(state.x) + .45) return 2;
  return state.vx > speed ? 0 : 1;
}
function controlledRun(level, upgrades = level.recommended, speed = level.id === 3 ? 26 : 24, holdTicks = 12) {
  const state = createDrive(level, upgrades),
    events = [];
  let previous = -1, input = 0;
  while (state.status === 'playing') {
    if (state.tick % holdTicks === 0) input = pilotInput(level, state, speed);
    if (input !== previous) {
      events.push([state.tick, input]);
      previous = input;
    }
    stepDrive(level, state, input);
  }
  return {
    state,
    events
  };
}
module.exports = {
  flatLevel,
  runTicks,
  pilotInput,
  controlledRun
};
