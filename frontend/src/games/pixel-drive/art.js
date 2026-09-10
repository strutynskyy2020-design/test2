export const ART_ROOT="/games/pixel-drive/v1/";
export const ART_URLS={landscape:ART_ROOT+"landscape.webp",garage:ART_ROOT+"garage.webp",cat:"/games/pixel-drive/v2/pixel-driver.webp"};
let promise;
export function loadDriveArt(){
  if(!promise) promise=Promise.all(Object.entries(ART_URLS).map(([key,url])=>new Promise((resolve,reject)=>{
    const image=new Image(),timer=setTimeout(()=>reject(new Error("Графіка завантажується довше звичайного")),15000);
    image.onload=()=>{clearTimeout(timer);resolve([key,image]);};image.onerror=()=>{clearTimeout(timer);reject(new Error("Не вдалося завантажити графіку"));};image.src=url;
  }))).then(Object.fromEntries).catch(error=>{promise=null;throw error;});
  return promise;
}
function shape(c,points,fill,stroke="#202b2d",width=1.5){
  c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}
}
function round(c,x,y,w,h,r,fill){c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();}
export function drawWheel(c,x,y,rotation=0,level=0){
  c.save();c.translate(x,y);c.rotate(rotation);
  c.fillStyle="#171e20";c.beginPath();c.arc(0,0,21,0,Math.PI*2);c.fill();
  c.lineWidth=3;c.strokeStyle="#465051";c.stroke();
  for(let n=0;n<14+level*2;n++){c.save();c.rotate(n*Math.PI*2/(14+level*2));round(c,-2,-22,4,7,1,"#293334");c.restore();}
  const metal=c.createRadialGradient(-3,-4,1,0,0,15);metal.addColorStop(0,"#f5d28c");metal.addColorStop(1,"#ad732e");
  c.fillStyle=metal;c.beginPath();c.arc(0,0,12,0,Math.PI*2);c.fill();c.strokeStyle="#101d20";c.lineWidth=2;c.stroke();
  for(let n=0;n<5;n++){const a=n*Math.PI*2/5;c.fillStyle="#27393b";c.beginPath();c.arc(Math.cos(a)*7.5,Math.sin(a)*7.5,2.6,0,Math.PI*2);c.fill();}
  c.fillStyle="#afb6b0";c.beginPath();c.arc(0,0,3.5,0,Math.PI*2);c.fill();c.restore();
}
export function drawSpring(c,x1,y1,x2,y2,level=0){
  c.strokeStyle="#283032";c.lineWidth=5;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();
  c.strokeStyle=level>2?"#c6dee0":"#e7ad4e";c.lineWidth=2;c.beginPath();
  for(let n=0;n<=10;n++){const t=n/10;const x=x1+(x2-x1)*t+(n===0||n===10?0:n%2?3:-3);const y=y1+(y2-y1)*t;n?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();
}
export function drawBody(c,cat,upgrades={engine:0,suspension:0,tires:0,tank:0},{driverScaleX=1}={}){
  // The chassis stays code-authored; Pixel has a dedicated reference-matched driving pose.
  c.save();c.lineJoin="round";c.lineCap="round";
  round(c,-33,-8,24,38,7,"#293337");round(c,-30,-5,16,34,5,"#535750");
  shape(c,[[-55,24],[-37,-40],[27,-42],[62,20]],"#172a2d18","#14272a",6);
  c.strokeStyle="#d6c5a0";c.lineWidth=1.2;c.beginPath();c.moveTo(-55,24);c.lineTo(-37,-40);c.lineTo(27,-42);c.lineTo(62,20);c.stroke();
  // Racing stretches the chassis to its physical wheelbase; undo that only for
  // the illustrated driver and wheel, anchored at the head rather than the door.
  c.save();c.translate(9,0);c.scale(driverScaleX,1);c.translate(-9,0);
  c.strokeStyle="#17282a";c.lineWidth=5;c.beginPath();c.moveTo(34,18);c.lineTo(44,31);c.stroke();
  c.beginPath();c.ellipse(34,15,8,15,.52,0,Math.PI*2);c.lineWidth=4.5;c.stroke();
  c.strokeStyle="#b99759";c.lineWidth=1.3;c.beginPath();c.ellipse(34,15,8,15,.52,Math.PI,Math.PI*2);c.stroke();
  c.strokeStyle="#17282a";c.lineWidth=2.5;c.beginPath();c.moveTo(27,9);c.lineTo(39,23);c.stroke();
  // Full sprite includes the seated torso and real paws, with ears/whiskers intact.
  if(cat?.naturalWidth)c.drawImage(cat,-29,-40,72,72*cat.naturalHeight/cat.naturalWidth);
  c.restore();
  const paint=c.createLinearGradient(0,10,0,48);paint.addColorStop(0,"#71c6b8");paint.addColorStop(.3,"#368b86");paint.addColorStop(1,"#195354");
  const outline=[[-73,18],[-40,17],[-25,28],[14,28],[26,12],[70,12],[77,21],[80,46],[65,48],[-63,48],[-75,37]];
  c.beginPath();outline.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();
  c.save();c.clip();c.beginPath();c.rect(-85,0,172,76);
  for(const x of [-47,47]){c.moveTo(x+25,50);c.arc(x,50,25,0,Math.PI*2);}
  c.clip("evenodd");c.fillStyle=paint;c.fillRect(-80,10,164,40);
  c.strokeStyle="#1b3638";c.lineWidth=1.5;c.beginPath();outline.slice(0,7).forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();c.restore();
  c.strokeStyle="#e8dcc0";c.lineWidth=6;c.beginPath();c.arc(-47,50,26,Math.PI,Math.PI*2);c.stroke();c.beginPath();c.arc(47,50,26,Math.PI,Math.PI*2);c.stroke();
  round(c,-23,45,45,5,2,"#243435");round(c,-19,43,37,3,1,"#d5c7a6");
  c.strokeStyle="#b3e5cf";c.lineWidth=1;c.beginPath();c.moveTo(-22,31);c.lineTo(12,31);c.lineTo(24,18);c.stroke();
  round(c,71,17,7,14,3,"#233639");round(c,73,19,4,10,2,"#ffe099");
  round(c,-78,37,10,9,2,"#b9b8a2");round(c,72,39,14,7,2,"#e2d7b9");
  round(c,-74,23,5,10,1,"#c35a39");round(c,-25,26,8,3,1,"#d5dac5");
  if(upgrades.engine>0){round(c,40,6,18,6,2,"#283b3a");for(let i=0;i<Math.min(5,Math.ceil(upgrades.engine/2));i++)round(c,42+i*3,5,1.5,4,.5,"#abc6b5");}
  if(upgrades.tank>0){round(c,-64,0,15,17,3,"#b66137");round(c,-60,-4,7,4,1,"#394847");}
  for(let i=0;i<5;i++){c.fillStyle="#b39664";c.fillRect(-20+i*9,39+(i%2)*2,2,1);}
  c.restore();
}
export function drawParkedBuggy(c,cat,x,y,scale,upgrades){
  c.save();c.translate(x,y);c.scale(scale,scale);
  c.fillStyle="#171a1970";c.beginPath();c.ellipse(4,72,84,8,0,0,Math.PI*2);c.fill();
  [-47,47].forEach(wx=>{drawSpring(c,wx,21,wx,49,upgrades.suspension);drawWheel(c,wx,50,0,upgrades.tires);});
  drawBody(c,cat,upgrades);c.restore();
}
