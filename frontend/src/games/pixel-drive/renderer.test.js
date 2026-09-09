import {createDrive,getLevel,stepDrive,captureDrive} from "./engine";
import {drawDrive,PIXELS_PER_METRE} from "./renderer";
import {drawWheel,drawSpring} from "./art";

jest.mock("./art",()=>({drawBody:jest.fn(),drawWheel:jest.fn(),drawSpring:jest.fn(),drawParkedBuggy:jest.fn()}));

function canvas(width,height){
  const gradient={addColorStop:jest.fn()},functions={};
  const context=new Proxy({createLinearGradient:()=>gradient},{get:(target,key)=>key in target?target[key]:(functions[key]||=jest.fn())});
  return {width,height,getContext:()=>context};
}

test("airborne wheels render their simulated spin and height without changing physics during resize",()=>{
  const level=getLevel(1),state=createDrive(level,undefined,{x:9,y:45,wheelOmega:-20});
  for(let i=0;i<15;i++)stepDrive(level,state,1);
  expect(state.grounded).toBe(0);
  const before=JSON.stringify(state),snapshot=captureDrive(state);
  for(const [width,height] of [[1280,720],[390,220],[844,475]]){
    jest.clearAllMocks();drawDrive(canvas(width,height),level,snapshot,{},{});
    expect(drawWheel).toHaveBeenCalledTimes(2);
    state.wheels.forEach((wheel,index)=>{
      expect(drawWheel.mock.calls[index][3]).toBe(-wheel.angle);
      const [,ax,ay,wx,wy]=drawSpring.mock.calls[index];
      expect(ax-wx).toBeCloseTo((wheel.anchorX-wheel.x)*PIXELS_PER_METRE,8);
      expect(ay-wy).toBeCloseTo(-(wheel.anchorY-wheel.y)*PIXELS_PER_METRE,8);
    });
    expect(JSON.stringify(state)).toBe(before);
  }
});
