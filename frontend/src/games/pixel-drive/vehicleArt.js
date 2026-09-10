import {drawBody,drawWheel,drawSpring} from './art';
import {getVehicle} from './fleetConfig';

const path=(c,points,fill,stroke='#1c2b30',width=2)=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}};
const box=(c,x,y,w,h,r,color)=>{c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();};
const line=(c,points,color,width)=>{c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();};

// All new silhouettes use 50 art units per metre and the physical chassis origin.
// Pixel's illustration is never stretched with a longer chassis.
function driver(c,cat,v){
  const top=-v.bodyHeight*25;
  box(c,-23,top-11,19,34,5,'#24383b');
  line(c,[[28,top+5],[39,top+18]],'#182b31',4);
  c.strokeStyle='#c49d65';c.lineWidth=4;c.beginPath();c.ellipse(29,top+3,8,14,.5,0,Math.PI*2);c.stroke();
  if(cat?.naturalWidth)c.drawImage(cat,-29,top-44,72,72*cat.naturalHeight/cat.naturalWidth);
}

export function drawVehicleBody(c,cat,upgrades,vehicleId='wanderer',jet=0,tick=0){
  const v=getVehicle(vehicleId),L=v.bodyLength*25,H=v.bodyHeight*25;
  c.save();c.lineJoin='round';c.lineCap='round';
  if(v.id==='wanderer'){
    c.scale(50*2.6/94,1);c.translate(0,-20);
    drawBody(c,cat,upgrades,{driverScaleX:94/(50*2.6)});c.restore();return;
  }
  const color=c.createLinearGradient(0,-H,0,H);color.addColorStop(0,v.accent);color.addColorStop(.16,v.color);color.addColorStop(1,'#263b40');
  // Rear details are behind the driver. Each chassis is deliberately recognisable.
  if(v.id==='dune_buggy'||v.id==='boar'){
    line(c,[[-L*.85,H],[-L*.5,-H-45],[L*.25,-H-45],[L*.75,H]],'#23343a',6);
    line(c,[[-L*.83,H],[-L*.49,-H-44],[L*.25,-H-44]],v.accent,1.6);
  }
  if(v.id==='rally'||v.id==='arrow'||v.id==='sprinter'){
    box(c,-L*.85,-H-20,6,23,1,'#35464a');box(c,-L-7,-H-24,L*.6,6,2,v.accent);
  }
  if(v.id==='hauler'){
    box(c,-L+5,-H-15,L*.7,30,3,'#343f38');
    for(let i=0;i<3;i++)box(c,-L+10+i*21,-H-12,17,24,2,i%2?'#b58f5b':'#94784e');
    line(c,[[-L+4,-H-18],[-L*.26,-H-18]],v.accent,4);
  }
  if(v.id==='orbiter'){
    box(c,-L*.65,-H-21,19,40,7,'#6a858a');box(c,-L*.61,-H-17,11,29,5,'#d5e0d8');
    line(c,[[L*.45,-H],[L*.45,-H-49],[L*.65,-H-56]],'#e1d9aa',2);
    box(c,L*.61,-H-59,6,6,3,'#91e3e0');
  }
  driver(c,cat,v);
  if(v.type==='motorcycle'){
    line(c,[[-L*.9,H+13],[-L*.34,-H],[L*.45,H+12],[-L*.9,H+13]],v.color,7);
    line(c,[[L*.9,H+15],[L*.65,-H-20],[L*.35,-H-22]],v.accent,5);
    path(c,[[-L*.3,-H-5],[L*.24,-H-7],[L*.46,H*.2],[-L*.25,H*.2]],color);
    box(c,-L*.55,-H-7,L*.4,7,3,'#293338');box(c,-9,1,20,15,4,'#556165');
  }else if(v.type==='race'){
    path(c,[[-L,-H*.5],[-L*.5,-H],[L*.1,-H],[L,H*.2],[L,H],[-L,H]],color);
    path(c,[[-L*.3,-H-2],[-L*.22,-H-11],[L*.24,-H-8],[L*.46,-H+1]],'#a8d4d280');
    box(c,L*.67,H-2,L*.38,5,1,v.accent);
    line(c,[[-L*.2,-H],[L*.65,H*.05]],v.accent,5);
  }else if(v.type==='tracked'){
    path(c,[[-L,-H*.3],[-L*.75,-H],[L*.55,-H],[L,-H*.2],[L*.92,H],[-L*.95,H]],color);
    box(c,-L*.67,-H-3,L*.28,5,1,v.accent);
    for(let i=0;i<5;i++)box(c,L*.28+i*7,-H+5,4,10,1,'#23383c');
    line(c,[[-L*.7,H-4],[L*.7,H-4]],v.accent,3);
  }else if(v.type==='snowmobile'){
    path(c,[[-L,H],[-L*.7,-H*.3],[L*.1,-H],[L*.73,-H-8],[L,-H*.1],[L*.86,H]],color);
    path(c,[[L*.1,-H],[L*.35,-H-29],[L*.51,-H-31],[L*.6,-H]],'#a8e2e680');
    line(c,[[-L*.6,H-3],[L*.76,H-3]],v.accent,4);
  }else if(v.type==='hover'){
    path(c,[[-L,-H*.3],[-L*.7,-H],[L*.5,-H],[L,-H*.2],[L*.8,H*.6],[-L*.77,H]],color);
    line(c,[[-L*.8,H],[L*.75,H]],v.accent,3);
    for(const x of [-v.wheelbase*25,v.wheelbase*25]){
      box(c,x-14,H-2,28,9,4,'#293d48');box(c,x-11,H+6,22,3,1,v.accent);
    }
  }else{
    const front=v.id==='rally'?L*.65:L*.4;
    path(c,[[-L,-H],[-L*.42,-H],[-L*.25,H*.08],[L*.15,H*.08],[front,-H],[L*.84,-H],[L,-H*.25],[L,H],[-L,H]],color);
    line(c,[[-L*.24,H*.2],[L*.13,H*.2],[front,-H+4]],v.accent,2);
    for(const x of [-v.wheelbase*25,v.wheelbase*25]){
      c.beginPath();c.ellipse(x,H+11,v.wheelRadius*50+4,v.wheelRadius*32,0,Math.PI,Math.PI*2);c.strokeStyle=v.accent;c.lineWidth=5;c.stroke();
    }
  }
  box(c,L-4,-H+4,5,9,2,'#ffe0a1');box(c,-L-2,-H+5,4,8,1,'#e67753');
  if(upgrades.engine>0&&v.type!=='motorcycle')for(let i=0;i<Math.min(5,Math.ceil(upgrades.engine/2));i++)box(c,L*.38+i*6,-H+5,3,7,1,v.accent);
  if(upgrades.tank>0&&v.id!=='hauler')box(c,-L*.8,-H-13,11,14,2,'#b67743');
  if(v.id==='orbiter')for(const x of [-32,32]){
    box(c,x-9,H-1,18,12,3,'#52646a');box(c,x-7,H+9,14,4,2,'#273b45');
    if(jet>0){const length=(22+6*Math.sin(tick*1.7))*jet;
      path(c,[[x-7,H+13],[x,H+13+length],[x+7,H+13]],'#f1b871',null);
      path(c,[[x-4,H+13],[x,H+13+length*.67],[x+4,H+13]],'#d7faff',null);
    }
  }
  c.restore();
}

export function drawVehicleSupports(c,wheels,upgrades,px,py,scale){
  const rollers=wheels.filter(w=>w.role==='roller');
  if(rollers.length>1){
    // The belt follows the independent physical rollers; it is purely a visual link.
    const top=rollers.map(w=>[px(w.x),py(w.y)+w.radius*scale]),bottom=[...rollers].reverse().map(w=>[px(w.x),py(w.y)-w.radius*scale]);
    path(c,[...top,...bottom],'#273334','#142329',6);
    line(c,[...top,...bottom,top[0]],'#8d9388',2);
  }
  for(const wheel of wheels){
    const x=px(wheel.x),y=py(wheel.y);
    drawSpring(c,px(wheel.anchorX),py(wheel.anchorY),x,y,upgrades.suspension);
    c.save();c.translate(x,y);
    if(wheel.role==='ski'){
      c.rotate(-wheel.angle);
      line(c,[[-scale*.55,scale*.13],[scale*.4,scale*.13],[scale*.66,-scale*.1]],'#162e39',6);
      line(c,[[-scale*.54,scale*.1],[scale*.4,scale*.1],[scale*.63,-scale*.11]],'#bde4dc',2);
    }else{const size=wheel.radius*scale/22.5;c.scale(size,size);drawWheel(c,0,0,-wheel.angle,upgrades.tires);}
    c.restore();
  }
}

export function drawParkedVehicle(c,cat,upgrades,vehicleId,x=435,y=365){
  const v=getVehicle(vehicleId),scale=Math.min(142,620/(v.bodyLength+.6));
  const rest=-(v.bodyHeight/2+.2+v.travel*.3),wheels=[];
  const count=v.type==='tracked'?v.wheelCount:v.type==='snowmobile'?5:2;
  if(v.type!=='hover')for(let i=0;i<count;i++){
    const wx=v.type==='snowmobile'?(i===4?v.wheelbase/2:-v.wheelbase/2+i*.32):count===2?(i-.5)*v.wheelbase:-v.wheelbase/2+i*v.wheelbase/(count-1);
    wheels.push({x:wx,y:rest,anchorX:wx,anchorY:-v.bodyHeight/2,angle:0,radius:v.wheelRadius,role:v.type==='snowmobile'?(i===4?'ski':'roller'):v.type==='tracked'?'roller':'wheel'});
  }
  c.fillStyle='#14252865';c.beginPath();c.ellipse(x,y+(-rest+v.wheelRadius)*scale,scale*(v.bodyLength/2+.2),14,0,0,Math.PI*2);c.fill();
  drawVehicleSupports(c,wheels,upgrades,wx=>x+wx*scale,wy=>y-wy*scale,scale);
  c.save();c.translate(x,y);c.scale(scale/50,scale/50);drawVehicleBody(c,cat,upgrades,vehicleId);c.restore();
}
