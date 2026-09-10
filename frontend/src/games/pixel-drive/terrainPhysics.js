const {Vec2, Chain} = require('./vendor/planck');
const inRange = (items, x) => (items || []).find(item => x >= item.from && x <= item.to);

function terrain(l, x) {
  if (typeof l.terrainAt === 'function') return l.terrainAt(x);
  const points = l.terrain;
  if (x <= points[0][0]) return points[0][1];
  if (x >= points[points.length - 1][0]) return points[points.length - 1][1];
  let a = 0, b = points.length - 1;
  while (b - a > 1) { const m = Math.floor((a + b) / 2); if (points[m][0] <= x) a = m; else b = m; }
  const t = (x - points[a][0]) / (points[b][0] - points[a][0]);
  return points[a][1] + (points[b][1] - points[a][1]) * (l.linearTerrain ? t : t * t * (3 - 2 * t));
}
function areaData(l, x) {
  return l.endless && typeof l.getChunk === 'function' ? l.getChunk(Math.floor(x / (l.chunkSize || 120))) : l;
}
function surfaceAt(l, x) { const data = areaData(l,x); return inRange(data.surfaces,x)?.kind || data.surface || l.surface || 'dirt'; }
function supportSurface(l,x) {
  const data = areaData(l,x), liquid = inRange(data.liquids,x);
  if (liquid) return liquid.y ?? terrain(l,x);
  return inRange(data.gaps,x) ? null : terrain(l,x);
}
function makeChunk(f, l, index) {
  const size = l.chunkSize || 120, from = index * size, to = from + size;
  const data = areaData(l,from + .01), body = f.world.createBody({position: Vec2(-f.originX,0)});
  const step = f.p.terrainStep;
  const chain = (points, ceiling = false) => {
    if (points.length < 2) return;
    if (!ceiling) points.reverse();
    const shape = new Chain(points.map(([x,y]) => Vec2(x,y)), false);
    const first = points[0], last = points[points.length-1], dir = ceiling ? 1 : -1;
    // Ghost vertices ensure adjoining chunks have the same collision normal.
    if (!ceiling && !inRange(data.gaps,first[0]-dir*step)) shape.setPrevVertex(Vec2(first[0]-dir*step,terrain(l,first[0]-dir*step)));
    if (!ceiling && !inRange(data.gaps,last[0]+dir*step)) shape.setNextVertex(Vec2(last[0]+dir*step,terrain(l,last[0]+dir*step)));
    body.createFixture(shape,{friction:1,restitution:f.p.restitution,userData:{kind:ceiling?'ceiling':'road'}});
  };
  const boundaries = new Set([from,to]);
  for(let x=from;x<=to;x+=step) boundaries.add(x);
  for(const gap of [...data.gaps||[],...data.liquids||[]]) {
    if(gap.from>from&&gap.from<to)boundaries.add(gap.from);
    if(gap.to>from&&gap.to<to)boundaries.add(gap.to);
  }
  let points = [], previous = null;
  for (const x of [...boundaries].sort((a,b)=>a-b)) {
    if(previous!==null) {
      const midpoint=(previous+x)/2;
      if(inRange(data.gaps,midpoint)||inRange(data.liquids,midpoint)){chain(points);points=[];}
      else if(!points.length)points.push([previous,terrain(l,previous)]);
    }
    if(points.length||previous===null)points.push([x,terrain(l,x)]);
    previous=x;
  }
  chain(points);
  for (const roof of data.ceilings || []) {
    const left = Math.max(from,roof.from),right = Math.min(to,roof.to);
    if (right<=left) continue;
    const roofPoints=[];
    for(let x=left;x<=right+.0001;x+=step) roofPoints.push([x,roof.y ?? terrain(l,x)+(roof.height ?? 5)]);
    chain(roofPoints,true);
  }
  return body;
}
function syncTerrain(f,l,state) {
  const size=l.chunkSize||120, x=state.x;
  const above=Math.max(0,state.y-terrain(l,x));
  const flight=(Math.max(0,state.vy)+Math.sqrt(state.vy**2+2*f.p.gravity*above))/f.p.gravity;
  const reach=Math.max(360,Math.abs(state.vx)*(flight+3)+160);
  const back=Math.max(180,state.vx<0?reach:Math.min(reach,300));
  const first=Math.floor((x-back)/size),last=Math.floor((x+reach)/size);
  if (Math.abs(f.chassis.getPosition().x)>1000) {
    const shift=Math.trunc(f.chassis.getPosition().x/1000)*1000;
    f.world.shiftOrigin(Vec2(shift,0)); f.originX+=shift; f.originShifts++;
  }
  for(let index=first;index<=last;index++) if(!f.terrainBodies.has(index)) f.terrainBodies.set(index,makeChunk(f,l,index));
  for(const [index,body] of f.terrainBodies) if(index<first||index>last) {f.world.destroyBody(body);f.terrainBodies.delete(index);}
  if(l.endless && typeof l.pruneChunks==='function') l.pruneChunks(first,last);
  f.loadedRange=[first*size,(last+1)*size];
}
module.exports={terrain,surfaceAt,supportSurface,areaData,syncTerrain};
