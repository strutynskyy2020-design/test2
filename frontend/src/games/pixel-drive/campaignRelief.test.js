import {reliefHeight} from './campaignRelief';
import {generateCampaign} from './campaignGenerator';

test('the added road relief joins each authored module without a height or slope step',()=>{
  for(const world of ['earth','moon','mars','basalt'])for(const type of ['intro','recovery','climb','rollers','jump','tunnel']){
    const height=x=>reliefHeight(type,120,x,.173,world),epsilon=.0001;
    expect(height(0)).toBe(0);expect(height(120)).toBe(0);
    expect(Math.abs(height(epsilon)/epsilon)).toBeLessThan(.0001);
    expect(Math.abs(height(120-epsilon)/epsilon)).toBeLessThan(.0001);
  }
});

test('the first main road has visible crests and valleys before the long climb',()=>{
  const level=generateCampaign().levels[1];
  const points=level.terrain.filter(([x])=>x>=15&&x<=145);
  const heights=points.map(p=>p[1]);
  const slopes=points.slice(1).map((p,i)=>p[1]-points[i][1]);
  const turns=slopes.filter((v,i)=>i>0&&v*slopes[i-1]<0).length;
  expect(turns).toBeGreaterThanOrEqual(8);
  expect(Math.max(...heights)-Math.min(...heights)).toBeGreaterThan(2);
  // On a fixed uphill grade, short changes of slope require active driving.
  const climb=level.terrain.filter(([x])=>x>=200&&x<=350);
  const grades=climb.slice(1).map((p,i)=>p[1]-climb[i][1]);
  expect(Math.max(...grades)-Math.min(...grades)).toBeGreaterThan(.2);
});
