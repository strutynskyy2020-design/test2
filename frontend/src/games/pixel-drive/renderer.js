import {terrain,surfaceAt} from "./engine";
import {drawBody,drawWheel,drawSpring,drawParkedBuggy} from "./art";

const W=1280,H=720;
export const PIXELS_PER_METRE=46;
const circle=(c,x,y,r,color)=>{c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function coin(c,x,y,value=1){
  c.save();c.translate(x,y);circle(c,0,0,13,"#81542d");circle(c,0,-1,11,"#eac578");circle(c,0,-1,7,"#b88943");
  c.fillStyle="#ffe4a1";c.fillRect(-2,-7,4,12);c.fillRect(-5,-5,10,3);c.fillRect(-5,1,10,3);
  if(value>1){c.font="bold 11px sans-serif";c.textAlign="center";c.fillStyle="#fff0c9";c.fillText(String(value),0,-19);}c.restore();
}
function fuel(c,x,y){
  c.save();c.translate(x,y);c.strokeStyle="#442e27";c.lineWidth=3;c.fillStyle="#c85f36";
  c.beginPath();c.roundRect(-11,-14,22,27,4);c.fill();c.stroke();
  c.beginPath();c.roundRect(-6,-21,12,6,2);c.stroke();c.strokeStyle="#edb785";c.lineWidth=1.4;
  c.beginPath();c.moveTo(-6,-8);c.lineTo(6,6);c.moveTo(6,-8);c.lineTo(-6,6);c.stroke();c.restore();
}

function diagnostics(c,state,px,py){
  const data=state.diagnostics||state;
  c.save();c.lineWidth=1.7;c.strokeStyle="#9efbe3";
  for(const collider of data.colliders||[]){
    c.beginPath();
    if(collider.radius!==undefined)c.arc(px(collider.x),py(collider.y),collider.radius*PIXELS_PER_METRE,0,Math.PI*2);
    else {const points=collider.vertices||collider.points||[];points.forEach((p,i)=>{const x=px(p.x??p[0]),y=py(p.y??p[1]);i?c.lineTo(x,y):c.moveTo(x,y);});c.closePath();}
    c.strokeStyle=collider.sensor||collider.type==="head"?"#ff9580":"#9efbe3";c.stroke();
  }
  for(const contact of data.contacts||[]){
    const x=px(contact.x),y=py(contact.y);circle(c,x,y,4,"#ffd582");c.strokeStyle="#ffd582";
    c.beginPath();c.moveTo(x,y);c.lineTo(x+(contact.nx||0)*30,y-(contact.ny||0)*30);c.stroke();
  }
  const com=data.com||{x:state.x,y:state.y};
  circle(c,px(com.x),py(com.y),5,"#fd7973");c.strokeStyle="#fd7973";
  c.beginPath();c.moveTo(px(com.x)-10,py(com.y));c.lineTo(px(com.x)+10,py(com.y));c.moveTo(px(com.x),py(com.y)-10);c.lineTo(px(com.x),py(com.y)+10);c.stroke();
  for(const wheel of state.wheels||[]){
    if(typeof wheel!=="object")continue;
    c.strokeStyle=wheel.grounded?"#9efbe3":"#ffcd8f";c.beginPath();c.moveTo(px(wheel.anchorX),py(wheel.anchorY));c.lineTo(px(wheel.x),py(wheel.y));c.stroke();
  }
  const mode={drive:"газ",forward:"уперед",brake:"гальмо",reverse:"задній хід",coast:"накат",neutral:"нейтраль",air:"політ","air-neutral":"політ · нейтраль","air-gas":"політ · газ","air-brake":"політ · гальмо"};
  const number=(n,p=1)=>Number.isFinite(n)?n.toFixed(p):"0";
  const wheels=state.wheels||[];
  const lines=[
    "ФІЗИКА · F2",`${number(state.vx)} м/с   ω ${number(state.av,2)} рад/с`,
    `Педалі: ${mode[state.mode||data.mode]||state.mode||data.mode||"нейтраль"}`,
    `Опора: ${wheels.map(w=>w.grounded?"●":"○").join("  ")}  заднє / переднє`,
    `Хід, м: ${wheels.map(w=>`${number(w.compression,2)}/${number(w.travel,2)}`).join(" · ")}`,
    `Навантаження, Н: ${wheels.map(w=>number(w.normalLoad,0)).join(" / ")}`,
    `Колеса, рад/с: ${wheels.map(w=>number(w.av)).join(" / ")}`,
    `Привід, Н·м: ${wheels.map(w=>number(w.driveTorque,0)).join(" / ")}`,
    `Гальмо, Н·м: ${wheels.map(w=>number(w.brakeTorque,0)).join(" / ")}`,
    `Пробуксовування: ${wheels.map(w=>number(w.slip,2)).join(" / ")}`,
    `Повітряний момент: ${number(state.airTorque??data.airTorque,0)} Н·м`,
    `Пальне: ${number(state.fuel)} / ${number(state.capacity,0)} с`,
    `Ділянка: ${(state.challenge?.name || "вступ").slice(0,28)}`,
    `Позначки: ${(state.checkpoints||[]).length} · Монети: ${state.coinValue||0}`,
  ];
  const x=W-392,y=125;
  c.fillStyle="#142923e8";c.beginPath();c.roundRect(x,y,372,28+lines.length*22,12);c.fill();
  c.font="14px ui-monospace,Consolas,monospace";c.textAlign="left";
  lines.forEach((line,i)=>{c.fillStyle=i===0?"#ffd48c":"#d9f0de";c.fillText(line,x+15,y+25+i*22);});
  c.restore();
}

export function drawDrive(canvas,level,state,art,{reduced=false,camera={},diagnostics:showDiagnostics=false}={}){
  if(!canvas||!level||!state)return;
  const c=canvas.getContext("2d");if(!c)return;
  c.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);c.clearRect(0,0,W,H);
  if(art?.landscape){
    const pan=reduced?0:clamp(state.x*.25,0,320);c.drawImage(art.landscape,-pan,-30,1600,810);
  }else{c.fillStyle="#a8b6b2";c.fillRect(0,0,W,H);}
  const now=performance.now(),dt=camera.time===undefined?1/60:clamp((now-camera.time)/1000,0,.1);camera.time=now;
  const road=terrain(level,state.x),targetY=Math.max(road,state.y-2.6),targetX=state.x-(state.vx<-1?880:310)/PIXELS_PER_METRE;
  const blend=1-Math.exp(-6*dt);
  camera.y=camera.y===undefined?targetY:camera.y+(targetY-camera.y)*blend;
  camera.x=camera.x===undefined?targetX:camera.x+(targetX-camera.x)*Math.min(1,blend*2);
  const px=x=>(x-camera.x)*PIXELS_PER_METRE,py=y=>520+(camera.y-y)*PIXELS_PER_METRE;
  const groundAt=x=>py(terrain(level,x/PIXELS_PER_METRE+camera.x));
  const points=[];for(let x=-20;x<=W+20;x+=5)points.push([x,groundAt(x)]);
  const soil=c.createLinearGradient(0,400,0,H);soil.addColorStop(0,"#be9360");soil.addColorStop(.35,"#916645");soil.addColorStop(1,"#4b4434");
  c.fillStyle=soil;c.beginPath();c.moveTo(-20,H);points.forEach(([x,y])=>c.lineTo(x,y));c.lineTo(W+20,H);c.closePath();c.fill();
  c.save();c.clip();
  for(let i=Math.floor(camera.x/1.2)-1;i<(camera.x+W/PIXELS_PER_METRE)/1.2+1;i++){
    const x=px(i*1.2),base=groundAt(x);
    for(let k=0;k<5;k++){const jitter=((i*37+k*61)%23+23)%23,y=base+24+k*55+jitter;c.fillStyle=(i+k)%3?"#d8ad7727":"#372f302d";c.beginPath();c.ellipse(x+jitter,y,4+jitter*.55,3+jitter*.23,.3,0,Math.PI*2);c.fill();}
  }c.restore();
  // All visible surface samples use the same height function as the chain collider.
  c.lineJoin="round";c.lineCap="round";c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));
  c.strokeStyle="#4c563c";c.lineWidth=10;c.stroke();c.strokeStyle="#93a364";c.lineWidth=5;c.stroke();c.strokeStyle="#d0b77f";c.lineWidth=2;c.stroke();
  for(let i=1;i<points.length;i++){
    const [x,y]=points[i],surface=surfaceAt(level,x/PIXELS_PER_METRE+camera.x);if(surface==="dirt")continue;
    c.strokeStyle=surface==="ice"?"#accfe6":"#f0f1e8";c.lineWidth=surface==="ice"?6:9;c.beginPath();c.moveTo(...points[i-1]);c.lineTo(x,y);c.stroke();
  }
  for(let i=Math.floor(camera.x/.8)-1;i<(camera.x+W/PIXELS_PER_METRE)/.8;i++){
    if(surfaceAt(level,i*.8)!=="dirt")continue;
    const x=px(i*.8),y=groundAt(x);c.strokeStyle=i%3?"#889158":"#b8b274";c.lineWidth=1.5;c.beginPath();c.moveTo(x,y);c.lineTo(x-3,y-8-(i%3)*2);c.moveTo(x,y);c.lineTo(x+4,y-6);c.stroke();
    if(i%13===0)circle(c,x+4,y-8,2.5,"#eed18c");
  }
  for(const bridge of level.bridges||[]){
    const start=px(bridge);if(start<-640||start>W+50)continue;
    for(let i=0;i<15;i+=.4){const x=start+i*PIXELS_PER_METRE,y=groundAt(x);c.strokeStyle="#5d4530";c.lineWidth=5;c.beginPath();c.moveTo(x,y+3);c.lineTo(x+14,y+3);c.stroke();}
    for(const shift of[1,5,9,13]){const x=start+shift*PIXELS_PER_METRE,y=groundAt(x);c.fillStyle="#54422d";c.fillRect(x,y+5,8,82);c.strokeStyle="#6c5034";c.lineWidth=5;c.beginPath();c.moveTo(x,y+74);c.lineTo(x+45,y+10);c.stroke();}
  }
  level.gears.forEach((x,i)=>{if(state.gears.includes(i))return;const screen=px(x);if(screen>-20&&screen<W+20)coin(c,screen,py(terrain(level,x)+1.15),level.coinValues?.[i]??1);});
  level.fuel.forEach((x,i)=>{if(state.cans.includes(i))return;const screen=px(x);if(screen>-20&&screen<W+20)fuel(c,screen,py(terrain(level,x)+1.15));});
  for(const checkpoint of level.checkpoints||[]){
    const x=px(checkpoint.x);if(x < -50 || x > W+50)continue;const y=py(terrain(level,checkpoint.x));
    c.fillStyle="#635344";c.fillRect(x,y-65,5,65);c.fillStyle=state.checkpoints?.includes(checkpoint.id)?"#9abe8f":"#e3c785";c.fillRect(x-20,y-65,48,25);
    c.fillStyle="#304637";c.font="bold 11px sans-serif";c.textAlign="center";c.fillText(`${Math.round(checkpoint.x-9)} м`,x+4,y-48);c.textAlign="left";
  }
  const finish=level.length+(level.startX??9),flagX=px(finish),flagY=py(terrain(level,finish));
  if(flagX>-100&&flagX<W+100){
    c.fillStyle="#343e36";c.fillRect(flagX,flagY-146,6,146);
    for(let yy=0;yy<4;yy++)for(let xx=0;xx<7;xx++){c.fillStyle=(yy+xx)%2?"#2b3633":"#f7ebd2";c.fillRect(flagX+6+xx*11,flagY-146+yy*11,11,11);}
    c.fillStyle="#fff1cc";c.font="700 18px sans-serif";c.fillText("ФІНІШ",flagX-25,flagY-162);
  }
  if(!reduced&&state.grounded&&Math.abs(state.vx)>2){
    for(let i=0;i<8;i++){const age=(state.tick+i*7)%45,x=px(state.x)-67-age*1.8,y=py(road)+3-age*.25;c.globalAlpha=(1-age/45)*.16;circle(c,x,y,4+age*.18,"#e8c690");}c.globalAlpha=1;
  }
  // Poses and spin are read directly from the simulated wheel bodies, never snapped to terrain.
  for(const wheel of state.wheels){
    const sx=px(wheel.x),sy=py(wheel.y);
    drawSpring(c,px(wheel.anchorX),py(wheel.anchorY),sx,sy,state.upgrades.suspension);
    c.save();c.translate(sx,sy);const size=(wheel.radius??.45)*PIXELS_PER_METRE/22.5;c.scale(size,size);drawWheel(c,0,0,-wheel.angle,state.upgrades.tires);c.restore();
  }
  c.save();c.translate(px(state.x),py(state.y));c.rotate(-state.angle);
  // Art wheelbase94 units =2.6m; y50 is the static axle line, bodyorigin y20 is .6m above it.
  c.scale(PIXELS_PER_METRE*2.6/94,PIXELS_PER_METRE/50);c.translate(0,-20);drawBody(c,art?.cat,state.upgrades);c.restore();
  if(showDiagnostics)diagnostics(c,state,px,py);
}

export function drawGarage(canvas,art,upgrades){
  if(!canvas)return;const c=canvas.getContext("2d");if(!c)return;c.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);c.clearRect(0,0,W,H);
  if(art?.garage)c.drawImage(art.garage,0,0,W,H);else{c.fillStyle="#766045";c.fillRect(0,0,W,H);}
  const shade=c.createLinearGradient(0,0,W,0);shade.addColorStop(0,"#15221b00");shade.addColorStop(.55,"#15221b00");shade.addColorStop(1,"#15221b50");c.fillStyle=shade;c.fillRect(0,0,W,H);
  drawParkedBuggy(c,art?.cat,410,330,3.3,upgrades);
}
export function drawRoute(canvas,level,selected,completed){
  const c=canvas?.getContext("2d");if(!c)return;c.setTransform(canvas.width/300,0,0,canvas.height/80,0,0);c.clearRect(0,0,300,80);
  const heights=Array.from({length:151},(_,i)=>terrain(level,i/150*level.length)),lo=Math.min(...heights),range=Math.max(3,Math.max(...heights)-lo);
  c.strokeStyle=completed?"#a4cba0":selected?"#ecc37c":"#829180";c.lineWidth=3;c.lineJoin="round";c.beginPath();
  heights.forEach((h,i)=>{const x=i*2,y=68-(h-lo)/range*52;i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();
}
