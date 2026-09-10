import React,{act} from "react";
import {createRoot} from "react-dom/client";
import PixelDrive from "@/pages/PixelDrive";
import {CONFIG,freshUpgrades,getLevel,getEndlessLevel,stepDrive,summarize} from "./engine";
import {getUpgradePrice} from "./progression";
import {drawDrive} from "./renderer";
import {controlledRun} from "./physicsTestHelpers.cjs";
import {normalizeFinish} from "./finishResult";
import {persistPendingSave,readPendingSaves} from "./pendingSave";
jest.mock("react-router-dom",()=>({useNavigate:()=>jest.fn(),useLocation:()=>({pathname:"/games/pixel-drive",search:""})}),{virtual:true});
jest.mock("@/lib/api",()=>({__esModule:true,default:{},extractError:e=>e.message}));
jest.mock("./art",()=>({loadDriveArt:()=>Promise.resolve({cat:{},garage:{},landscape:{}})}));
jest.mock("./renderer",()=>({drawDrive:jest.fn(),drawGarage:jest.fn(),drawRoute:jest.fn()}));
jest.mock("./engine",()=>{const actual=jest.requireActual("./engine");return {...actual,stepDrive:jest.fn(actual.stepDrive)};});
let host,root,service,raf,frame,time;
const progress=()=>({version:CONFIG.version,result_mode:"client",save_scope:"account-a",balance:1000,upgrades:freshUpgrades(),tracks:{},unlocked_level:1,levels:CONFIG.levels});
const button=name=>Array.from(host.querySelectorAll("button")).find(b=>(b.getAttribute("aria-label")||b.textContent).trim()===name);
const phase=()=>host.querySelector("[data-phase]").dataset.phase;
const queuedEntry=(sessionId="another-session",scope="account-a")=>({schema:1,id:`queue-${sessionId}`,scope,version:CONFIG.version,levelId:1,sessionId,createdAt:Date.now(),payload:{ticks:60,abandon:true,outcome:{status:"failed",reason:"abandoned",ticks:60,distance:20,fuel:97,fuelSeconds:39,coinValue:0,gears:[],checkpoints:[],medals:[],analysis:[]}}});
const finishCalls=()=>service.post.mock.calls.filter(([url])=>url.endsWith("/finish"));
async function remount(nextService=service){await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(<PixelDrive service={nextService}/>));}
async function click(name){await act(async()=>{button(name).click();});}
async function frames(count){
  await act(async()=>{for(let i=0;i<count;i++){time+=1000/60;const batch=Array.from(raf.values());raf.clear();batch.forEach(cb=>cb(time));}});
}
function key(type,code){host.querySelector("[data-phase]").dispatchEvent(new KeyboardEvent(type,{bubbles:true,code}));}
beforeEach(async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;jest.useFakeTimers();raf=new Map();frame=0;time=100;
  jest.clearAllMocks();stepDrive.mockImplementation(jest.requireActual("./engine").stepDrive);localStorage.clear();
  window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  global.ResizeObserver=class{observe(){}disconnect(){}};
  window.requestAnimationFrame=cb=>{raf.set(++frame,cb);return frame;};window.cancelAnimationFrame=id=>raf.delete(id);
  let saved=progress(),sessionNumber=0;const sessions=new Map(),receipts=new Map();
  service={get:jest.fn(async()=>({data:saved})),post:jest.fn(async(url,body)=>{
    if(url.endsWith("/start")){const level=body.mode==='endless'?getEndlessLevel(body.world_id,123):getLevel(body.level);const data={session_id:`test-session-${++sessionNumber}`,level_id:body.level,version:CONFIG.version,vehicle_id:body.vehicle_id||'wanderer',world_id:body.world_id||level.worldId,mode:body.mode||'campaign',stageId:level.stageId,seed:level.seed,generatorVersion:level.generatorVersion,upgrades:{...saved.upgrades},expires_at:new Date(Date.now()+1800000).toISOString()};sessions.set(data.session_id,data);return {data};}
    if(url.endsWith("/upgrade")){saved={...saved,balance:saved.balance-CONFIG.upgradePrices[body.part][body.level],upgrades:{...saved.upgrades,[body.part]:body.level+1}};return {data:{progress:saved}};}
    if(receipts.has(url))return receipts.get(url);
    const session=sessions.get(url.split("/").at(-2))||{level_id:1,upgrades:freshUpgrades()};
    const outcome=normalizeFinish(getLevel(session.level_id),session.upgrades,body);
    const previous=saved.tracks[String(session.level_id)]?.best||0;
    saved={...saved,balance:saved.balance+outcome.coinValue,unlocked_level:outcome.status==="completed"?Math.max(saved.unlocked_level,session.level_id+1):saved.unlocked_level,tracks:{...saved.tracks,[String(session.level_id)]:{best:Math.max(previous,outcome.distance),medals:outcome.medals,checkpoints:outcome.checkpoints}}};
    const response={data:{progress:saved,outcome,receipt:{parts:outcome.coinValue,coin_parts:outcome.coinValue,new_record:outcome.distance>previous,previous_best:previous}}};receipts.set(url,response);return response;
  })};
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  await act(async()=>{root.render(<PixelDrive service={service}/>);});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();jest.useRealTimers();});
async function start(){await click("Виїхати");await act(async()=>jest.advanceTimersByTime(2000));expect(phase()).toBe("racing");}

test("a changed generator blocks a new drive before physics and allows a fresh start request",async()=>{
  const original=service.post.getMockImplementation();let mismatch=true;
  service.post.mockImplementation(async(url,body)=>{
    const response=await original(url,body);
    if(url.endsWith('/start')&&mismatch)response.data.generatorVersion++;
    return response;
  });
  await click('Виїхати');
  expect(phase()).toBe('garage');expect(host.textContent).toContain('Перезавантажте сторінку');
  expect(stepDrive).not.toHaveBeenCalled();expect(finishCalls()).toHaveLength(0);
  mismatch=false;await start();
  const requests=service.post.mock.calls.filter(([url])=>url.endsWith('/start')).map(([,body])=>body.request_id);
  expect(requests).toHaveLength(2);expect(requests[0]).not.toBe(requests[1]);
});
test("continuous keyboard input submits its final outcome without events or replay",async()=>{
  await start();await act(async()=>key("keydown","KeyD"));await frames(getLevel(1).max_ticks+3);
  expect(phase()).toBe("result");
  const finish=service.post.mock.calls.find(([url])=>url.endsWith("/finish"))[1];
  expect(finish).not.toHaveProperty("events");expect(Object.keys(finish).sort()).toEqual(["abandon","outcome","ticks"]);
  expect(finish.outcome).toEqual(summarize(getLevel(1),drawDrive.mock.calls.at(-1)[2]));
  expect(finish.ticks).toBeGreaterThan(60);expect(finish.ticks).toBeLessThanOrEqual(getLevel(1).max_ticks);
},30000);
test("a controlled winning replay passes through keyboard events, fixed frames and the saved result UI",async()=>{
  const expected=controlledRun(getLevel(1),freshUpgrades());expect(expected.state.status).toBe("completed");
  await start();await frames(1);let event=0,held=0;
  await act(async()=>{
    for(let tick=0;tick<expected.state.tick;tick++){
      if(expected.events[event]?.[0]===tick){
        const next=expected.events[event++][1];
        for(const [bit,code] of [[1,"KeyD"],[2,"KeyA"]])if((held&bit)!==(next&bit))key(next&bit?"keydown":"keyup",code);
        held=next;
      }
      time+=1000/60;const batch=Array.from(raf.values());raf.clear();batch.forEach(cb=>cb(time));
    }
  });
  expect(phase()).toBe("result");expect(host.textContent).toContain("Фініш, Пікселю!");
  const finish=service.post.mock.calls.find(([url])=>url.endsWith("/finish"))[1];
  expect(finish.outcome).toEqual(summarize(getLevel(1),expected.state));expect(finish.ticks).toBe(expected.state.tick);expect(finish.abandon).toBe(false);
},30000);
test("blur pauses without burning fuel; returning clears held input and a failed save retries the same payload",async()=>{
  await start();await act(async()=>key("keydown","KeyD"));await frames(180);
  await act(async()=>window.dispatchEvent(new Event("blur")));expect(phase()).toBe("paused");
  const before=host.querySelector('progress[aria-label="Паливо"]').value;
  await frames(120);expect(host.querySelector('progress[aria-label="Паливо"]').value).toBe(before);
  await click("Продовжити");await act(async()=>jest.advanceTimersByTime(2000));await frames(25);
  await click("Пауза");
  const original=service.post.getMockImplementation();let fail=true;
  service.post.mockImplementation(async(url,body)=>{if(url.endsWith("/finish")&&fail){fail=false;const error=new Error("temporary network failure");error.response={status:503};throw error;}return original(url,body);});
  await click("Завершити та зберегти");expect(phase()).toBe("save-error");
  await click("Надіслати ще раз");expect(phase()).toBe("result");
  const attempts=service.post.mock.calls.filter(([url])=>url.endsWith("/finish"));
  expect(attempts).toHaveLength(2);expect(attempts[0][1]).toEqual(attempts[1][1]);
  expect(stepDrive.mock.calls.at(-1)[2]).toBe(0);expect(attempts[0][1].outcome).toMatchObject({status:"failed",reason:"abandoned"});
});
test("a hidden document freezes fuel and physics until an explicit resume after becoming visible",async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(document,"hidden");let hidden=false;
  Object.defineProperty(document,"hidden",{configurable:true,get:()=>hidden});
  const state=()=>drawDrive.mock.calls.at(-1)[2];
  try{
    await start();await act(async()=>key("keydown","KeyD"));await frames(120);
    await act(async()=>{hidden=true;document.dispatchEvent(new Event("visibilitychange"));});
    expect(phase()).toBe("paused");
    const before={tick:state().tick,fuel:state().fuel};
    const fuelBar=host.querySelector('progress[aria-label="Паливо"]').value;
    await act(async()=>jest.advanceTimersByTime(10000));await frames(600);
    expect({tick:state().tick,fuel:state().fuel}).toEqual(before);
    expect(host.querySelector('progress[aria-label="Паливо"]').value).toBe(fuelBar);
    await act(async()=>{hidden=false;document.dispatchEvent(new Event("visibilitychange"));});
    await act(async()=>jest.advanceTimersByTime(3000));await frames(180);
    expect(phase()).toBe("paused");expect({tick:state().tick,fuel:state().fuel}).toEqual(before);
    expect(service.post.mock.calls.filter(([url])=>url.endsWith("/finish"))).toHaveLength(0);
    await click("Продовжити");expect(phase()).toBe("countdown");
    await frames(120);expect({tick:state().tick,fuel:state().fuel}).toEqual(before);
    await act(async()=>jest.advanceTimersByTime(2000));await frames(2);
    expect(phase()).toBe("racing");expect(state().tick).toBe(before.tick+1);
    expect(state().fuel).toBeCloseTo(before.fuel-1/60,8);
  }finally{
    if(descriptor)Object.defineProperty(document,"hidden",descriptor);else delete document.hidden;
  }
});
test("a short pointer tap is sampled and cancellation cannot leave the pedal down",async()=>{
  await start();const gas=button("Газ");
  await act(async()=>{
    const down=new MouseEvent("pointerdown",{bubbles:true,button:0});Object.defineProperty(down,"pointerId",{value:7});gas.dispatchEvent(down);
    const cancel=new MouseEvent("pointercancel",{bubbles:true});Object.defineProperty(cancel,"pointerId",{value:7});gas.dispatchEvent(cancel);
  });
  await frames(30);await click("Пауза");await click("Завершити та зберегти");
  const body=service.post.mock.calls.find(([url])=>url.endsWith("/finish"))[1];
  expect(stepDrive.mock.calls[0][2]).toBe(1);expect(stepDrive.mock.calls.slice(1).every(call=>call[2]===0)).toBe(true);
  expect(body).not.toHaveProperty("events");
});
test("two pedals and overlapping keyboard/pointer holds retain every active source",async()=>{
  await start();await act(async()=>{key("keydown","KeyD");key("keydown","KeyA");});await frames(30);
  await act(async()=>key("keyup","KeyD"));await frames(30);
  const pointer=type=>{const event=new MouseEvent(type,{bubbles:true,button:0});Object.defineProperty(event,"pointerId",{value:7});button("Газ").dispatchEvent(event);};
  await act(async()=>pointer("pointerdown"));await frames(30);
  await act(async()=>key("keyup","KeyA"));await frames(30);
  await act(async()=>{key("keydown","KeyD");pointer("pointercancel");});await frames(30);
  await act(async()=>key("keyup","KeyD"));await frames(30);
  await click("Пауза");await click("Завершити та зберегти");
  const body=service.post.mock.calls.find(([url])=>url.endsWith("/finish"))[1];
  const sampled=stepDrive.mock.calls.map(call=>call[2]).filter((value,index,array)=>index===0||value!==array[index-1]);
  expect(sampled).toEqual([3,2,3,1,0]);expect(body).not.toHaveProperty("events");
});
test("a lost upgrade response keeps its idempotency key and blocks unrelated spending",async()=>{
  const original=service.post.getMockImplementation();let fail=true;
  service.post.mockImplementation(async(url,body)=>{if(url.endsWith("/upgrade")&&fail){fail=false;throw new Error("lost response");}return original(url,body);});
  const price=CONFIG.upgradePrices.engine[0];
  await click(`Двигун: покращити за ${price} монет`);
  expect(button("Виїхати").disabled).toBe(true);expect(button(`Бак: покращити за ${CONFIG.upgradePrices.tank[0]} монет`).disabled).toBe(true);
  await click(`Двигун: покращити за ${price} монет`);
  const attempts=service.post.mock.calls.filter(([url])=>url.endsWith("/upgrade"));
  expect(attempts[0][1]).toEqual(attempts[1][1]);expect(attempts[0][1].level).toBe(0);expect(host.querySelector(".drive-wallet b").textContent).toBe(String(1000-price));
  expect(button("Виїхати").disabled).toBe(false);
});
test("F2 and the accessible toggle expose diagnostics without changing input",async()=>{
  await start();await frames(3);
  await act(async()=>key("keydown","F2"));expect(button("Діагностика фізики").getAttribute("aria-pressed")).toBe("true");
  await frames(3);expect(drawDrive.mock.calls.at(-1)[4].diagnostics).toBe(true);
  await click("Діагностика фізики");expect(button("Діагностика фізики").getAttribute("aria-pressed")).toBe("false");
});
test("the short physics course never creates or saves an authenticated session",async()=>{
  await act(async()=>{host.querySelector(".drive-test-course").click();});
  await act(async()=>jest.advanceTimersByTime(2000));await frames(60);
  expect(phase()).toBe("racing");expect(host.textContent).toContain("ВИПРОБУВАННЯ");
  await click("Пауза");await click("Завершити випробування");
  expect(phase()).toBe("result");expect(host.textContent).toContain("Тест завершено · без нагород.");
  expect(service.post).not.toHaveBeenCalled();
  await click("До гаража");expect(host.querySelector(".drive-wallet b").textContent.replace(/\s/g,"")).toBe("1000");
  expect(host.querySelector(".drive-next-route").textContent).toContain(getLevel(1).name);
  expect(host.querySelector(".drive-next-route").textContent).toContain(`${getLevel(1).meters} м`);
});
test("reloading the service during a practice run restores the campaign garage",async()=>{
  await act(async()=>{host.querySelector(".drive-test-course").click();});
  await act(async()=>jest.advanceTimersByTime(2000));await frames(3);
  await act(async()=>{root.render(<PixelDrive service={{...service}}/>);});
  expect(phase()).toBe("garage");
  expect(host.querySelector(".drive-next-route").textContent).toContain(getLevel(1).name);
  expect(host.querySelector(".drive-next-route").textContent).toContain(`${getLevel(1).meters} м`);
  expect(service.post).not.toHaveBeenCalled();
});
test("locked routes show their length and prerequisite but cannot start",async()=>{
  await act(async()=>host.querySelector(".drive-next-route").click());
  expect(host.querySelectorAll(".drive-routes .drive-route")).toHaveLength(7);
  expect(host.querySelector('[data-testid="drive-track-1"]').textContent).toContain(getLevel(1).name);
  const locked=host.querySelector('[data-testid="drive-track-2"]');expect(locked.disabled).toBe(false);
  await act(async()=>locked.click());
  expect(phase()).toBe("garage");expect(host.querySelector(".drive-next-route").textContent).toContain(getLevel(2).name);
  expect(host.querySelector(".drive-unlock-hint").textContent).toContain(getLevel(1).name);expect(host.textContent).not.toContain(getLevel(2).description);
  expect(button("Траса ще закрита").disabled).toBe(true);await click("Траса ще закрита");expect(service.post).not.toHaveBeenCalled();
});
test("compact upgrades show ranks and prices and update the tank after purchase",async()=>{
  expect(host.querySelector('[data-testid="drive-upgrade-engine"]').textContent).toContain("0/10");
  expect(host.querySelectorAll(".drive-upgrade")).toHaveLength(4);
  expect(host.querySelector('[data-testid="drive-upgrade-tank"]').textContent).toContain(String(CONFIG.upgradePrices.tank[0]));
  await click(`Бак: покращити за ${CONFIG.upgradePrices.tank[0]} монет`);
  expect(host.querySelector('[data-testid="drive-upgrade-tank"]').textContent).toContain("1/10");
  expect(service.post.mock.calls[0][1]).toMatchObject({part:"tank",level:0});
});
test("an unlocked campaign route starts on a zero-level car despite its higher recommended profile",async()=>{
  service.get.mockResolvedValue({data:{...progress(),unlocked_level:2}});
  await act(async()=>root.render(<PixelDrive service={{...service}}/>));
  expect(host.querySelector(".drive-next-route").textContent).toContain(getLevel(2).name);
  expect(button("Виїхати").disabled).toBe(false);await start();
  expect(service.post.mock.calls[0][1].level).toBe(2);
  const state=drawDrive.mock.calls.at(-1)[2];expect(Object.values(state.upgrades)).toEqual([0,0,0,0]);
});
test("failed result keeps the reason, distance and earnings without technical analysis",async()=>{
  const original=service.post.getMockImplementation();
  service.post.mockImplementation(async(url,body)=>{
    const response=await original(url,body);
    if(url.endsWith("/finish")){response.data.outcome.reason="fuel";response.data.outcome.analysis=[{type:"fuel",message:"Пальне закінчилося за 38 м до каністри."}];response.data.receipt={...response.data.receipt,parts:300,coin_parts:250,checkpoint_parts:50};}
    return response;
  });
  await start();await frames(60);await click("Пауза");await click("Завершити та зберегти");
  expect(host.querySelector(".drive-result h2").textContent).toBe("Пальне закінчилося");
  expect(host.querySelector(".drive-reward").textContent).toContain("+300 монет");expect(host.querySelector(".drive-result-distance").textContent).toMatch(/\d/);
  expect(host.querySelector(".drive-run-analysis")).toBeNull();expect(host.querySelector(".drive-result-facts")).toBeNull();expect(button("Ще раз")).toBeDefined();
});
test("a run without evidence does not invent upgrade advice or hide previously collected coins",async()=>{
  const original=service.post.getMockImplementation();
  service.post.mockImplementation(async(url,body)=>{const response=await original(url,body);if(url.endsWith("/finish"))response.data.outcome.analysis=[];return response;});
  await start();await frames(60);
  expect(drawDrive.mock.calls.at(-1)[4]).not.toHaveProperty("collected");
  await click("Пауза");await click("Завершити та зберегти");expect(host.querySelector(".drive-run-analysis")).toBeNull();
});
test.each([409,410,404])("permanent finish error %i explains the expired/replaced attempt and returns to the refreshed garage",async status=>{
  const original=service.post.getMockImplementation();
  const message="Заїзд замінено новою спробою в цій або іншій вкладці. Поверніться до гаража.";
  service.post.mockImplementation(async(url,body)=>{
    if(url.endsWith("/finish")){const error=new Error("Request failed");error.response={status,data:{detail:{code:"run_superseded",message}}};throw error;}
    return original(url,body);
  });
  await start();await frames(30);await click("Пауза");await click("Завершити та зберегти");
  expect(phase()).toBe("save-error");expect(host.querySelector('[role="alert"]').textContent).toBe(message);
  expect(button("Надіслати ще раз")).toBeUndefined();expect(button("До гаража").disabled).toBe(false);
  await click("До гаража");expect(phase()).toBe("garage");expect(service.get).toHaveBeenCalledTimes(3);
  expect(service.post.mock.calls.filter(([url])=>url.endsWith("/finish"))).toHaveLength(1);
});
test("the complete finish result is durable before POST and saved UI waits for its acknowledgement",async()=>{
  const original=service.post.getMockImplementation();let acknowledge;
  service.post.mockImplementation(async(url,body)=>{
    if(!url.endsWith("/finish"))return original(url,body);
    expect(readPendingSaves("account-a")[0].payload).toEqual(body);
    const saved=await original(url,body);return new Promise(resolve=>{acknowledge=()=>resolve(saved);});
  });
  await start();await frames(180);await click("Пауза");await click("Завершити та зберегти");
  expect(phase()).toBe("saving");expect(host.textContent).toContain("Зберігаємо заїзд…");expect(host.textContent).not.toContain("Перевіряємо");
  expect(host.querySelector(".drive-reward")).toBeNull();expect(readPendingSaves("account-a")).toHaveLength(1);
  await act(async()=>acknowledge());expect(phase()).toBe("result");expect(readPendingSaves("account-a")).toEqual([]);
  expect(host.textContent).toContain("Заїзд збережено.");
});
test("a lost acknowledgement survives reload and resends the same result without paying twice",async()=>{
  const original=service.post.getMockImplementation();let lost=true;
  service.post.mockImplementation(async(url,body)=>{
    const response=await original(url,body);
    if(url.endsWith("/finish")&&lost){lost=false;throw new Error("The acknowledgement was lost");}
    return response;
  });
  await start();await act(async()=>key("keydown","KeyD"));await frames(180);await click("Пауза");await click("Завершити та зберегти");
  expect(phase()).toBe("save-error");const [queued]=readPendingSaves("account-a");expect(queued.payload.outcome.gears.length).toBeGreaterThan(0);
  const first=finishCalls()[0],balanceAfterCommit=(await service.get()).data.balance;
  await remount();expect(phase()).toBe("save-error");expect(button("Виїхати")).toBeUndefined();
  await act(async()=>jest.advanceTimersByTime(1000));expect(phase()).toBe("result");
  expect(finishCalls()).toHaveLength(2);expect(finishCalls()[1]).toEqual(first);expect(readPendingSaves("account-a")).toEqual([]);
  expect((await service.get()).data.balance).toBe(balanceAfterCommit);
});
test("an offline finish queues locally and resumes saving when the network returns",async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(navigator,"onLine");let connected=true;
  Object.defineProperty(navigator,"onLine",{configurable:true,get:()=>connected});
  try{
    await start();await frames(90);
    await act(async()=>{connected=false;window.dispatchEvent(new Event("offline"));});
    expect(phase()).toBe("paused");expect(button("Завершити та зберегти").disabled).toBe(false);
    await click("Завершити та зберегти");expect(phase()).toBe("save-error");expect(readPendingSaves("account-a")).toHaveLength(1);expect(finishCalls()).toHaveLength(0);
    expect(host.textContent).toContain("Результат у черзі акаунта");
    await act(async()=>{connected=true;window.dispatchEvent(new Event("online"));});
    await act(async()=>jest.advanceTimersByTime(1000));expect(phase()).toBe("result");expect(finishCalls()).toHaveLength(1);
  }finally{if(descriptor)Object.defineProperty(navigator,"onLine",descriptor);else delete navigator.onLine;}
});
test("another account never restores or posts this account's queued finish",async()=>{
  const entry=persistPendingSave(queuedEntry());
  const other={get:jest.fn(async()=>({data:{...progress(),save_scope:"account-b"}})),post:jest.fn()};
  await remount(other);await act(async()=>jest.advanceTimersByTime(60000));
  expect(phase()).toBe("garage");expect(other.post).not.toHaveBeenCalled();expect(readPendingSaves("account-a")).toEqual([entry]);expect(readPendingSaves("account-b")).toEqual([]);
});
test("reopening while offline recovers its account queue automatically when status becomes available",async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(navigator,"onLine");let connected=false;
  Object.defineProperty(navigator,"onLine",{configurable:true,get:()=>connected});
  const original=service.get.getMockImplementation();persistPendingSave(queuedEntry());
  service.get.mockImplementation(async(...args)=>{if(!connected)throw new Error("offline");return original(...args);});
  try{
    await remount();expect(phase()).toBe("load-error");expect(finishCalls()).toHaveLength(0);
    await act(async()=>{connected=true;window.dispatchEvent(new Event("online"));});expect(phase()).toBe("save-error");
    await act(async()=>jest.advanceTimersByTime(1000));expect(phase()).toBe("result");expect(finishCalls()).toHaveLength(1);expect(readPendingSaves("account-a")).toEqual([]);
  }finally{if(descriptor)Object.defineProperty(navigator,"onLine",descriptor);else delete navigator.onLine;}
});
test("an account change before finish POST preserves the old queue and requires reopening the garage",async()=>{
  await start();await frames(60);await click("Пауза");
  service.get.mockResolvedValue({data:{...progress(),save_scope:"account-b"}});
  await click("Завершити та зберегти");
  expect(phase()).toBe("load-error");expect(host.textContent).toContain("Акаунт змінився");expect(finishCalls()).toHaveLength(0);
  expect(readPendingSaves("account-a")).toHaveLength(1);expect(readPendingSaves("account-b")).toEqual([]);
  await click("Спробувати ще раз");expect(phase()).toBe("garage");
});
test("storage failure keeps the result in the current tab without POST or a new start",async()=>{
  await start();await frames(60);await click("Пауза");
  const write=jest.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("quota exceeded");});
  try{
    await click("Завершити та зберегти");expect(phase()).toBe("save-error");expect(finishCalls()).toHaveLength(0);
    expect(host.textContent).toContain("Результат лише у цій вкладці");expect(button("Виїхати")).toBeUndefined();expect(button("До гаража без збереження")).toBeUndefined();
    await act(async()=>jest.advanceTimersByTime(60000));expect(finishCalls()).toHaveLength(0);
  }finally{write.mockRestore();}
  await click("Надіслати ще раз");expect(phase()).toBe("result");expect(finishCalls()).toHaveLength(1);expect(readPendingSaves("account-a")).toEqual([]);
});
test("automatic transient retries are bounded and preserve the exact durable result",async()=>{
  const original=service.post.getMockImplementation();
  service.post.mockImplementation(async(url,body)=>{
    if(url.endsWith("/finish")){const error=new Error("temporary failure");error.response={status:503};throw error;}
    return original(url,body);
  });
  await start();await frames(60);await click("Пауза");await click("Завершити та зберегти");
  for(const delay of [1000,2500,5000,10000,30000])await act(async()=>jest.advanceTimersByTime(delay));
  expect(finishCalls()).toHaveLength(6);await act(async()=>jest.advanceTimersByTime(120000));expect(finishCalls()).toHaveLength(6);
  expect(host.textContent).toContain("Результат у черзі. Спробуйте надіслати ще раз.");
  expect(readPendingSaves("account-a")).toHaveLength(1);expect(finishCalls().every(call=>JSON.stringify(call[1])===JSON.stringify(finishCalls()[0][1]))).toBe(true);
  await click("Надіслати ще раз");expect(finishCalls()).toHaveLength(7);
});
test("a pending result from another tab is settled before starting a newer session",async()=>{
  const entry=persistPendingSave(queuedEntry());await click("Виїхати");
  expect(phase()).toBe("save-error");expect(service.post).not.toHaveBeenCalled();
  await act(async()=>jest.advanceTimersByTime(1000));expect(phase()).toBe("result");expect(finishCalls()[0][1]).toEqual(entry.payload);
  expect(service.post.mock.calls.filter(([url])=>url.endsWith("/start"))).toHaveLength(0);
  await click("До гаража");await click("Виїхати");expect(service.post.mock.calls.filter(([url])=>url.endsWith("/start"))).toHaveLength(1);
});

const fleetProfile=(vehicleId="wanderer",extra={})=>({...progress(),vehicle_id:vehicleId,vehicles:{[vehicleId]:{upgrades:freshUpgrades(),records:{campaign:{},endless:{}}}},unlocked_levels:[1],unlocked_worlds:["earth"],...extra});
async function useProfile(data){service.get.mockResolvedValue({data});await remount({...service});}
test("all twelve vehicles keep a short specialty, price and free trial",async()=>{
  await useProfile(fleetProfile());expect(host.querySelectorAll(".drive-vehicle-card")).toHaveLength(12);
  await click("Переглянути Ковзун");expect(host.querySelector(".drive-car-label p").textContent).toBe("Плавно над нерівностями");
  expect(host.querySelector(".drive-vehicle-actions .drive-primary").textContent).toMatch(/Придбати за/);expect(button("Безкоштовний тест")).toBeDefined();expect(host.querySelector("table")).toBeNull();
  expect(button("Спершу придбай авто").disabled).toBe(true);expect(host.querySelector('[data-testid="drive-upgrade-engine"]').disabled).toBe(true);
});
test("an unowned vehicle can be tried for free in another world without any purchase, session or save",async()=>{
  await useProfile(fleetProfile());await click("Переглянути Полярник");await act(async()=>host.querySelector(".drive-next-route").click());
  await click("Світ Місяць");await act(async()=>host.querySelector('[data-testid="drive-track-8"]').click());
  await act(async()=>host.querySelector(".drive-test-course").click());await act(async()=>jest.advanceTimersByTime(2000));await frames(60);
  const state=drawDrive.mock.calls.at(-1)[2];expect(state.vehicleId).toBe("polar");expect(state.worldId).toBe("moon");expect(Object.values(state.upgrades)).toEqual([0,0,0,0]);
  await click("Пауза");await click("Завершити випробування");expect(host.textContent).toContain("Тест завершено · без нагород.");expect(service.post).not.toHaveBeenCalled();expect(readPendingSaves("account-a")).toEqual([]);
});
test("branching campaign unlocks Moon independently from later Earth levels",async()=>{
  await useProfile(fleetProfile("wanderer",{unlocked_level:4,unlocked_levels:[1,2,3,4,8],unlocked_worlds:["earth","moon"]}));
  await act(async()=>host.querySelector(".drive-next-route").click());await click("Світ Місяць");expect(host.querySelectorAll(".drive-route")).toHaveLength(3);expect(host.querySelector('[aria-label="Світ Місяць"]').getAttribute("aria-pressed")).toBe("true");
  await act(async()=>host.querySelector('[data-testid="drive-track-8"]').click());expect(button("Виїхати").disabled).toBe(false);await start();
  expect(service.post.mock.calls[0][1]).toMatchObject({level:8,mode:"campaign",world_id:"moon",vehicle_id:"wanderer"});
});
test("a vehicle purchase retry retains its request and blocks unrelated spending",async()=>{
  await useProfile(fleetProfile("wanderer",{balance:100000}));await click("Переглянути Стриж");let lost=true;
  const purchased=fleetProfile("swift",{balance:97600,vehicles:{wanderer:{upgrades:freshUpgrades(),records:{}},swift:{upgrades:freshUpgrades(),records:{}}}});
  service.post.mockImplementation(async()=>{if(lost){lost=false;throw new Error("lost response");}return {data:{progress:purchased}};});
  await act(async()=>host.querySelector(".drive-vehicle-actions .drive-primary").click());expect(host.textContent).toContain("Повторити покупку");expect(host.querySelector('[aria-label="Переглянути Тягач"]').disabled).toBe(true);
  await click("Повторити покупку");expect(service.post.mock.calls[0]).toEqual(service.post.mock.calls[1]);expect(service.post.mock.calls[0][0]).toBe("/games/pixel-drive/vehicle/purchase");expect(service.post.mock.calls[0][1].vehicle_id).toBe("swift");expect(button("Виїхати").disabled).toBe(false);
});
test("upgrades use the browsed owned vehicle and its own price and ranks",async()=>{
  const upgrades={...freshUpgrades(),tank:3};await useProfile(fleetProfile("wanderer",{balance:100000,vehicles:{wanderer:{upgrades:freshUpgrades(),records:{}},swift:{upgrades,records:{}}}}));await click("Переглянути Стриж");
  const price=getUpgradePrice("tank",3,"swift");expect(host.querySelector('[data-testid="drive-upgrade-tank"]').textContent).toContain("3/10");expect(host.querySelector('[data-testid="drive-upgrade-tank"]').getAttribute("aria-label")).toContain(String(price));
  service.post.mockResolvedValue({data:{progress:fleetProfile("swift")}});await click(`Бак: покращити за ${price} монет`);expect(service.post.mock.calls[0][1]).toMatchObject({vehicle_id:"swift",part:"tank",level:3});
});
test("Orbiter uses Space and its separate touch button; pause releases jet input",async()=>{
  await useProfile(fleetProfile("orbiter"));await start();await act(async()=>key("keydown","Space"));await frames(5);expect(stepDrive.mock.calls.at(-1)[2]).toBe(4);
  await act(async()=>key("keydown","KeyD"));await frames(5);expect(stepDrive.mock.calls.at(-1)[2]).toBe(5);
  await act(async()=>key("keyup","Space"));await frames(5);expect(stepDrive.mock.calls.at(-1)[2]).toBe(1);
  const jet=button("Реактивна тяга");expect(jet).toBeDefined();await act(async()=>{const event=new MouseEvent("pointerdown",{bubbles:true,button:0});Object.defineProperty(event,"pointerId",{value:9});jet.dispatchEvent(event);});await frames(5);expect(stepDrive.mock.calls.at(-1)[2]).toBe(5);
  await click("Пауза");await click("Продовжити");await act(async()=>jest.advanceTimersByTime(2000));await frames(4);expect(stepDrive.mock.calls.at(-1)[2]).toBe(0);
});
test("endless mode sends world and vehicle, and its HUD treats milestones as achievements",async()=>{
  await useProfile(fleetProfile("wanderer",{unlocked_levels:[1,2,3,4,8],unlocked_worlds:["earth","moon"]}));
  await act(async()=>host.querySelector(".drive-next-route").click());await click("Світ Місяць");await click("Нескінченна подорож");expect(host.textContent).toContain("Без фінішу");await click("До автомобіля");await start();await frames(3);
  expect(service.post.mock.calls[0][1]).toMatchObject({mode:"endless",world_id:"moon",vehicle_id:"wanderer"});expect(host.querySelector('progress[aria-label="Дистанція до досягнення"]')).not.toBeNull();expect(host.querySelector('progress[aria-label="Дистанція до фінішу"]')).toBeNull();expect(host.querySelector(".drive-distance").textContent).not.toContain("Infinity");
});

test("garage records stay separate for each vehicle on the same route",async()=>{
  await useProfile(fleetProfile("wanderer",{tracks:{"1":{best:180}},vehicles:{wanderer:{upgrades:freshUpgrades(),records:{campaign:{"1":{best:180}}}},swift:{upgrades:freshUpgrades(),records:{campaign:{"1":{best:45}}}}}}));
  expect(host.querySelector(".drive-next-route").textContent).toContain("рекорд 180 м");await click("Переглянути Стриж");expect(host.querySelector(".drive-next-route").textContent).toContain("рекорд 45 м");await click("Переглянути Тягач");expect(host.querySelector(".drive-next-route").textContent).toContain("рекорд 0 м");
});
test("a version-three queued result is still submitted after the v4 migration",async()=>{
  const entry=queuedEntry("legacy-v3");entry.version=3;persistPendingSave(entry);await remount();expect(phase()).toBe("save-error");
  await act(async()=>jest.advanceTimersByTime(1000));expect(phase()).toBe("result");expect(finishCalls()[0][1]).toEqual(entry.payload);expect(readPendingSaves("account-a")).toEqual([]);
});

test("technical detail stays closed and compact by default",async()=>{
  await useProfile(fleetProfile());const details=host.querySelector(".drive-specs");
  expect(details.open).toBe(false);expect(details.querySelector("summary").textContent).toBe("Характеристики");
  expect(details.querySelectorAll("dl>div")).toHaveLength(2);expect(details.textContent).toContain("Маса");expect(details.textContent).toContain("Пальне");
  expect(host.querySelector(".drive-comparison")).toBeNull();expect(host.querySelector(".drive-benchmarks")).toBeNull();
  expect(host.querySelectorAll(".drive-upgrade")).toHaveLength(4);expect(service.post).not.toHaveBeenCalled();
});

test("repulsor upgrades retain their rank and price without spring explanations",async()=>{
  await useProfile(fleetProfile());await click("Переглянути Ковзун");const support=host.querySelector('[data-testid="drive-upgrade-suspension"]');
  expect(support.textContent).toContain("Опора");expect(support.textContent).toContain("0/10");expect(support.getAttribute("aria-label")).toContain(String(getUpgradePrice("suspension",0,"glider")));
  expect(host.textContent).not.toContain("кН");expect(host.textContent).not.toContain("Пружини");
});
