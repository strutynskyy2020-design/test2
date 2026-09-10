import {terrain,surfaceAt} from './engine';
import {getWorld} from './fleetConfig';

export function visibleAreas(level,left,right){
  if(!level.endless)return [level];
  const areas=[];
  for(let i=Math.floor(left/level.chunkSize);i<=Math.floor(right/level.chunkSize);i++)areas.push(level.getChunk(i));
  return areas;
}

export function drawWorldSky(c,worldId,x,art,reduced){
  const world=getWorld(worldId);
  if(world.id==='earth'&&art?.landscape){c.drawImage(art.landscape,-(reduced?0:Math.max(0,Math.min(320,x*.25))),-30,1600,810);return;}
  const sky=c.createLinearGradient(0,0,0,720);sky.addColorStop(0,world.sky[0]);sky.addColorStop(1,world.sky[1]);c.fillStyle=sky;c.fillRect(0,0,1280,720);
  if(world.id==='moon'){
    c.fillStyle='#e7e7e4';for(let i=0;i<85;i++){const sx=(i*173+29)%1280,sy=(i*i*31+71)%400;c.globalAlpha=.25+(i%4)*.15;c.fillRect(sx,sy,i%7?1.5:2.5,i%7?1.5:2.5);}c.globalAlpha=1;
    c.fillStyle='#7697ad';c.beginPath();c.arc(1020,155,44,0,Math.PI*2);c.fill();c.fillStyle='#d1e0d570';c.beginPath();c.ellipse(1007,151,17,35,.4,0,Math.PI*2);c.fill();
  }else{
    c.fillStyle=world.id==='mars'?'#ffdba563':'#d6c0a25c';c.beginPath();c.arc(1040,200,world.id==='mars'?28:41,0,Math.PI*2);c.fill();
  }
  for(let layer=0;layer<3;layer++){
    const base=390+layer*83,pan=reduced?0:x*(.12+layer*.09);
    c.fillStyle=world.id==='moon'?['#343c53','#494e67','#62647c'][layer]:world.id==='mars'?['#885961','#a56c63','#b98069'][layer]:['#4c4c5b','#595b64','#6c6b70'][layer];
    c.beginPath();c.moveTo(0,720);
    for(let sx=-10;sx<=1290;sx+=8){const wx=sx+pan;const h=world.id==='basalt'?Math.round(Math.sin(wx/103+layer)*3)*11:Math.sin(wx/155+layer)*38+Math.sin(wx/63+layer)*15;c.lineTo(sx,base+h);}
    c.lineTo(1280,720);c.closePath();c.fill();
  }
}

const SURFACE_COLORS={dirt:'#93a364',asphalt:'#5e6770',stone:'#a4a39a',sand:'#dfc492',snow:'#eff1e8',ice:'#a6d9e7',moon_dust:'#b4b1c5',mars_dust:'#dc926d',mineral:'#b4c1bb'};
export function drawWorldTerrain(c,level,state,camera,px,py,scale){
  const world=getWorld(level.worldId||state.worldId),left=camera.x-1,right=camera.x+1280/scale+1;
  const areas=visibleAreas(level,left,right),gaps=areas.flatMap(a=>a.gaps||[]),liquids=areas.flatMap(a=>a.liquids||[]);
  const holes=[...gaps,...liquids],absent=x=>holes.some(g=>x>=g.from&&x<=g.to);
  const segments=[];let points=[];
  for(let sx=-20;sx<=1300;sx+=4){const wx=sx/scale+camera.x;
    if(absent(wx)){if(points.length)segments.push(points);points=[];}else points.push([sx,py(terrain(level,wx)),wx]);
  }if(points.length)segments.push(points);
  const soil=c.createLinearGradient(0,360,0,720);soil.addColorStop(0,world.ground[0]);soil.addColorStop(1,world.ground[1]);
  for(const segment of segments){
    c.fillStyle=soil;c.beginPath();c.moveTo(segment[0][0],720);segment.forEach(([x,y])=>c.lineTo(x,y));c.lineTo(segment.at(-1)[0],720);c.closePath();c.fill();
    c.save();c.clip();
    for(let i=Math.floor((segment[0][0]/scale+camera.x)/1.2);i<=(segment.at(-1)[0]/scale+camera.x)/1.2;i++){
      const wx=i*1.2,y=py(terrain(level,wx)),sx=px(wx);
      for(let k=0;k<5;k++){const jitter=((i*37+k*61)%23+23)%23;c.fillStyle=(i+k)%3?'#efd3ac22':'#16273530';c.beginPath();c.ellipse(sx+jitter,y+24+k*55+jitter,4+jitter*.55,3+jitter*.23,.3,0,Math.PI*2);c.fill();}
    }c.restore();
    c.lineJoin='round';c.lineCap='round';c.beginPath();segment.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=world.ground[1];c.lineWidth=10;c.stroke();
    for(let i=1;i<segment.length;i++){
      const [sx,sy,wx]=segment[i],surface=surfaceAt(level,wx);c.strokeStyle=SURFACE_COLORS[surface]||world.ground[0];c.lineWidth=surface==='snow'?9:5;c.beginPath();c.moveTo(segment[i-1][0],segment[i-1][1]);c.lineTo(sx,sy);c.stroke();
    }
  }
  for(const liquid of liquids){
    const x1=px(liquid.from),x2=px(liquid.to),y=py(liquid.y??terrain(level,(liquid.from+liquid.to)/2));
    c.fillStyle='#38788990';c.fillRect(x1,y,x2-x1,720-y);c.strokeStyle='#b1e4da';c.lineWidth=3;c.beginPath();c.moveTo(x1,y);c.lineTo(x2,y);c.stroke();
  }
  if(world.id==='earth')for(let i=Math.floor(left/.8);i<right/.8;i++){
    const wx=i*.8;if(absent(wx)||surfaceAt(level,wx)!=='dirt')continue;
    const x=px(wx),y=py(terrain(level,wx));c.strokeStyle=i%3?'#889158':'#b8b274';c.lineWidth=1.5;c.beginPath();c.moveTo(x,y);c.lineTo(x-3,y-8-(i%3)*2);c.moveTo(x,y);c.lineTo(x+4,y-6);c.stroke();
  }
  for(const roof of areas.flatMap(a=>a.ceilings||[])){
    if(roof.to<left||roof.from>right)continue;
    const x1=Math.max(left,roof.from),x2=Math.min(right,roof.to),roofPoints=[];
    for(let x=x1;x<x2;x+=.1)roofPoints.push([px(x),py(roof.y??terrain(level,x)+(roof.height??5))]);
    roofPoints.push([px(x2),py(roof.y??terrain(level,x2)+(roof.height??5))]);
    c.fillStyle=world.ground[1];c.beginPath();c.moveTo(px(x1),0);roofPoints.forEach(p=>c.lineTo(...p));c.lineTo(px(x2),0);c.closePath();c.fill();
    c.strokeStyle=world.ground[0];c.lineWidth=7;c.beginPath();roofPoints.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke();
    // Roof faces match the actual collision surface, without decorative spikes.
  }
  return areas;
}
