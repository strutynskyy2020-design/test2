import {createFrameClock} from "./frameClock";
import {captureDrive,createDrive,getLevel,stepDrive} from "./engine";

test("recorded controls render at 30, 60 and 120 FPS with identical physical states",()=>{
  const simulate=fps=>{
    const level=getLevel(1),state=createDrive(level),clock=createFrameClock();
    const advance=()=>{stepDrive(level,state,state.tick<120?1:state.tick<240?0:2);};
    clock.advance(0,advance);
    for(let frame=1;frame<=fps*6;frame++)clock.advance(frame*1000/fps,advance);
    return captureDrive(state);
  };
  const baseline=simulate(60);
  expect(baseline.tick).toBe(360);expect(simulate(30)).toEqual(baseline);expect(simulate(120)).toEqual(baseline);
});
test("intermediate frames expose fractional interpolation without adding physics steps",()=>{
  const clock=createFrameClock(),step=jest.fn();clock.advance(0,step);
  expect(clock.advance(1000/120,step)).toEqual({paused:false,steps:0,alpha:.5});
  expect(clock.advance(1000/60,step)).toEqual({paused:false,steps:1,alpha:0});expect(step).toHaveBeenCalledTimes(1);
});
test("a delayed frame pauses and discards its elapsed time before resuming",()=>{
  const clock=createFrameClock(),level=getLevel(1),state=createDrive(level),step=()=>stepDrive(level,state,1);
  clock.advance(0,step);clock.advance(100,step);const before=captureDrive(state);
  expect(clock.advance(3100,step).paused).toBe(true);expect(captureDrive(state)).toEqual(before);
  expect(clock.advance(10000,step).steps).toBe(0);expect(captureDrive(state)).toEqual(before);
  clock.advance(10000+1000/60,step);expect(state.tick).toBe(before.tick+1);
});
