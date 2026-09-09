import fixtures from "./fixtures.json";
import { createFlight, stepFlight } from "./engine";

test.each(fixtures.map((f, i) => [i, f]))("flight %s reproduces the Python verifier exactly", (_, fixture) => {
  const state = createFlight(fixture.level), flaps = new Set(fixture.payload.flaps);
  for (let tick = 0; tick < fixture.payload.ticks; tick++) stepFlight(fixture.level, state, flaps.has(tick));
  expect(state).toEqual(fixture.outcome);
  const terminal = { ...state };
  stepFlight(fixture.level, state, true);
  expect(state).toEqual(terminal);
});

test("rapid repeated inputs do not create extra impulses", () => {
  const level = fixtures[0].level, state = createFlight(level);
  stepFlight(level, state, true);
  const velocity = state.velocity;
  stepFlight(level, state, true);
  expect(state.velocity).toBe(velocity + level.physics.gravity);
  expect(state.last_flap).toBe(0);
});
