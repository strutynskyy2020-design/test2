const {createEndlessLevel,CHUNK_SIZE,GENERATOR_VERSION}=require('./endlessGenerator');

describe('endless terrain revision 5',()=>{
  test.each(['earth','moon','mars','basalt'])('%s introduces readable short features in the first 100 metres',worldId=>{
    const l=createEndlessLevel(worldId);let min=Infinity,max=-Infinity,detail=0,grade=0;
    for(let x=20;x<=100;x+=.5){
      const y=l.terrainAt(x);min=Math.min(min,y);max=Math.max(max,y);
      detail=Math.max(detail,Math.abs(y-(l.terrainAt(x-10)+l.terrainAt(x+10))/2));
      grade=Math.max(grade,Math.abs(l.terrainAt(x+.5)-l.terrainAt(x-.5)));
    }
    expect(max-min).toBeGreaterThan(4);
    expect(detail).toBeGreaterThan(.65);
    expect(grade).toBeGreaterThan(.2);
    expect(l.terrainAt(9)).toBe(12);
    expect(l.generatorVersion).toBe(5);expect(GENERATOR_VERSION).toBe(5);
  });
  test.each(['earth','moon','mars','basalt'])('%s chunks and feature boundaries share continuous height and slope',worldId=>{
    const l=createEndlessLevel(worldId,17),moduleLength={earth:120,moon:240,mars:160,basalt:140}[worldId];
    const joins=new Set([18,20,83,430,500,580,625]);
    for(let i=1;i<=40;i++){joins.add(i*CHUNK_SIZE);joins.add(i*moduleLength);}
    for(const x of joins){
      const eps=.0001,y=l.terrainAt(x),before=l.terrainAt(x-eps),after=l.terrainAt(x+eps);
      expect(Math.abs(after-before)).toBeLessThan(.001);
      expect(Math.abs((after-y)/eps-(y-before)/eps)).toBeLessThan(.002);
    }
    for(const id of [-1,0,1,4,83,833]){
      const chunk=l.getChunk(id),next=l.getChunk(id+1);
      expect(chunk.terrain).toHaveLength(241);
      expect(chunk.terrain[240]).toEqual(next.terrain[0]);
      for(const [x,y] of chunk.terrain)expect(y).toBe(l.terrainAt(x));
    }
  });
  test.each(['earth','moon','mars','basalt'])('%s retains bounded high-distance terrain and deterministic bounded storage',worldId=>{
    const l=createEndlessLevel(worldId,99),again=createEndlessLevel(worldId,99);
    for(const start of [15000,50000,100000])for(let x=start;x<start+1000;x+=.5){
      expect(Math.abs(l.terrainAt(x))).toBeLessThan(50);
      expect(Math.abs(l.terrainAt(x+.25)-l.terrainAt(x-.25))/.5).toBeLessThan(1.2);
    }
    const original=l.getChunk(0);
    for(let i=0;i<1000;i++)l.getChunk(i);
    expect(l.cachedChunkCount()).toBeLessThanOrEqual(48);
    expect(l.getChunk(0)).toEqual(original);expect(again.getChunk(0)).toEqual(original);
    l.pruneChunks(800,806);expect(l.cachedChunkCount()).toBeLessThanOrEqual(7);
    const spacing={earth:480,moon:540,mars:480,basalt:420}[worldId];
    const fuel=l.getChunk(Math.floor(spacing/120)).fuel;expect(fuel).toContain(spacing);
  });
  test('Mars alternates open short features and calm low-ceiling approaches',()=>{
    const l=createEndlessLevel('mars');
    expect(l.getChunk(4).ceilings).toEqual([{from:500,to:580,height:4.5}]);
    expect(l.getChunk(3).ceilings).toEqual([]);expect(l.getChunk(5).ceilings).toEqual([]);
    for(let x=470;x<=610;x+=1)expect(Math.abs(l.terrainAt(x+1)+l.terrainAt(x-1)-2*l.terrainAt(x))).toBeLessThan(.035);
  });
});
