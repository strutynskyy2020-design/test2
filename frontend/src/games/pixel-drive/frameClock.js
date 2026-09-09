// Wall time schedules fixed simulation steps; it never becomes a physics delta.
export function createFrameClock(fixedDt=1/60,pauseGapMs=350){
  const stepMs=fixedDt*1000;
  let previous=null,accumulator=0;
  const reset=()=>{previous=null;accumulator=0;};
  return {
    reset,
    advance(now,step){
      if(previous===null){previous=now;return {paused:false,steps:0,alpha:0};}
      const elapsed=now-previous;previous=now;
      if(elapsed<0||elapsed>pauseGapMs){reset();return {paused:true,steps:0,alpha:0};}
      accumulator+=elapsed;let steps=0;
      while(accumulator+1e-7>=stepMs){
        accumulator=Math.max(0,accumulator-stepMs);steps++;
        if(step()===false){accumulator=0;break;}
      }
      return {paused:false,steps,alpha:Math.max(0,Math.min(1,accumulator/stepMs))};
    }
  };
}
