// Version 1. Integer arithmetic and update order must match backend/flappy_game.py.
export const createFlight = (level) => ({
  tick: 0, y: level.physics.start_y, velocity: level.physics.start_velocity,
  passed: 0, status: "playing", last_flap: -level.physics.min_flap_ticks,
});

export function stepFlight(level, state, flap = false) {
  if (state.status !== "playing") return state;
  const p = level.physics;
  if (flap && state.tick - state.last_flap >= p.min_flap_ticks) {
    state.velocity = p.impulse;
    state.last_flap = state.tick;
  }
  state.velocity += p.gravity;
  state.y += state.velocity;
  state.tick += 1;
  const { y } = state, radius = p.radius, x = p.player_x;
  if (y - radius <= 0 || y + radius >= p.floor) {
    state.status = "failed";
    return state;
  }
  let passed = 0;
  for (const gate of level.gates) {
    const gx = gate.x - level.speed * state.tick;
    if (gx + 52000 < x - radius) passed += 1;
    if (x + radius > gx - 9000 && x - radius < gx + 52000) {
      if (y - radius < gate.center - Math.floor(gate.gap / 2) + 6000 || y + radius > gate.center + Math.floor(gate.gap / 2)) {
        state.status = "failed";
        return state;
      }
    }
  }
  state.passed = passed;
  if (passed === level.gate_count) state.status = "completed";
  else if (state.tick >= level.max_ticks) state.status = "failed";
  return state;
}
