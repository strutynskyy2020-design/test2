import React,{act} from "react";
import {createRoot} from "react-dom/client";
import PixelDrive from "@/pages/PixelDrive";
import {CONFIG,freshUpgrades,getLevel,replay} from "./engine";
import {drawDrive} from "./renderer";
import {controlledRun} from "./physicsTestHelpers.cjs";
jest.mock("react-router-dom",()=>({useNavigate:()=>jest.fn(),useLocation:()=>({pathname:"/games/pixel-drive",search:""})}),{virtual:true});
jest.mock("@/lib/api",()=>({__esModule:true,default:{},extractError:e=>e.message}));
jest.mock("./art",()=>({loadDriveArt:()=>Promise.resolve({cat:{},garage:{},landscape:{}})}));
jest.mock("./renderer",()=>({drawDrive:jest.fn(),drawGarage:jest.fn(),drawRoute:jest.fn()}));
let host,root,service,raf,frame,time;
const progress=()=>({version:CONFIG.version,balance:1000,upgrades:freshUpgrades(),tracks:{},unlocked_level:1,levels:CONFIG.levels});
const button=name=>Array.from(host.querySelectorAll("button")).find(b=>(b.getAttribute("aria-label")||b.textContent).trim()===name);
const phase=()=>host.querySelector("[data-phase]").dataset.phase;
async function click(name){await act(async()=>{button(name).click();});}
async function frames(count){
  await act(async()=>{for(let i=0;i<count;i++){time+=1000/60;const batch=Array.from(raf.values());raf.clear();batch.forEach(cb=>cb(time));}});
}
function key(type,code){host.querySelector("[data-phase]").dispatchEvent(new KeyboardEvent(type,{bubbles:true,code}));}
beforeEach(async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;jest.useFakeTimers();raf=new Map();frame=0;time=100;
  window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  global.ResizeObserver=class{observe(){}disconnect(){}};
  window.requestAnimationFrame=cb=>{raf.set(++frame,cb);return frame;};window.cancelAnimationFrame=id=>raf.delete(id);
  let saved=progress();
  service={get:jest.fn(async()=>({data:saved})),post:jest.fn(async(url,body)=>{
    if(url.endsWith("/start"))return {data:{session_id:"test-session",level_id:body.level,version:CONFIG.version,upgrades:{...saved.upgrades},expires_at:new Date(Date.now()+1800000).toISOString()}};
    if(url.endsWith("/upgrade")){saved={...saved,balance:saved.balance-CONFIG.upgradePrices[body.part][body.level],upgrades:{...saved.upgrades,[body.part]:body.level+1}};return {data:{progress:saved}};}
    const outcome=replay(getLevel(1),freshUpgrades(),body.events,body.ticks,body.abandon);
    const previous=saved.tracks["1"]?.best||0;
    saved={...saved,balance:saved.balance+outcome.coinValue,unlocked_level:outcome.status==="completed"?2:saved.unlocked_level,tracks:{...saved.tracks,"1":{best:Math.max(previous,outcome.distance),medals:outcome.medals,checkpoints:outcome.checkpoints}}};
    return {data:{progress:saved,outcome,receipt:{parts:outcome.coinValue,coin_parts:outcome.coinValue,new_record:outcome.distance>previous,previous_best:previous}}};
  })};
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  await act(async()=>{root.render(<PixelDrive service={service}/>);});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();jest.useRealTimers();});
async function start(){await click("Виїхати");await act(async()=>jest.advanceTimersByTime(2000));expect(phase()).toBe("racing");}
test("continuous keyboard input runs real physics to a terminal state and submits only its input log",async()=>{
  await start();await act(async()=>key("keydown","KeyD"));await frames(getLevel(1).max_ticks+3);
  expect(phase()).toBe("result");
  const finish=service.post.mock.calls.find(([url])=>url.endsWith("/finish"))[1];
  expect(finish.events).toEqual([[0,1]]);expect(Object.keys(finish).sort()).toEqual(["abandon","events","ticks"]);
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
  expect(finish.events).toEqual(expected.events);expect(finish.ticks).toBe(expected.state.tick);expect(finish.abandon).toBe(false);
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
  expect(attempts[0][1].events.at(-1)[1]).toBe(0);
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
  expect(body.events).toEqual([[0,1],[1,0]]);
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
  expect(body.events.map(event=>event[1])).toEqual([3,2,3,1,0]);
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
  expect(phase()).toBe("result");expect(host.textContent).toContain("Прогрес і монети не змінюються");
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
test("locked campaign routes can be previewed, with recommendations, but cannot start",async()=>{
  await act(async()=>host.querySelector(".drive-next-route").click());
  expect(host.querySelectorAll(".drive-routes .drive-route")).toHaveLength(6);
  expect(host.querySelector(".drive-tutorial-route").textContent).toContain(getLevel(1).name);
  const locked=host.querySelector('[data-testid="drive-track-2"]');expect(locked.disabled).toBe(false);
  await act(async()=>locked.click());
  expect(phase()).toBe("garage");expect(host.querySelector(".drive-route-preview").textContent).toContain(getLevel(2).description);
  expect(host.querySelector(".drive-route-preview").textContent).toContain("Це рекомендація");
  expect(button("Траса ще закрита").disabled).toBe(true);await click("Траса ще закрита");expect(service.post).not.toHaveBeenCalled();
});
test("zero-level garage shows concrete next changes and applies the separate tank price",async()=>{
  expect(host.querySelector('[data-testid="drive-upgrade-engine"]').textContent).toContain("0/10");
  expect(host.querySelector("#drive-stat-tank").textContent).toContain("40 → 44 с пального");
  expect(host.querySelector("#drive-stat-suspension").textContent).toContain("Амортизація");
  await click(`Бак: покращити за ${CONFIG.upgradePrices.tank[0]} монет`);
  expect(host.querySelector("#drive-stat-tank").textContent).toContain("44 → 48 с пального");
  expect(service.post.mock.calls[0][1]).toMatchObject({part:"tank",level:0});
});
test("an unlocked campaign route starts on a zero-level car despite its higher recommended profile",async()=>{
  service.get.mockResolvedValue({data:{...progress(),unlocked_level:2}});
  await act(async()=>root.render(<PixelDrive service={{...service}}/>));
  expect(host.querySelector(".drive-route-preview").textContent).toContain(getLevel(2).name);
  expect(button("Виїхати").disabled).toBe(false);await start();
  expect(service.post.mock.calls[0][1].level).toBe(2);
  const state=drawDrive.mock.calls.at(-1)[2];expect(Object.values(state.upgrades)).toEqual([0,0,0,0]);
});
test("result explanations use simulation evidence and preserve earnings after a failed run",async()=>{
  const original=service.post.getMockImplementation();
  service.post.mockImplementation(async(url,body)=>{
    const response=await original(url,body);
    if(url.endsWith("/finish")){response.data.outcome.reason="fuel";response.data.outcome.analysis=[{type:"fuel",message:"Пальне закінчилося за 38 м до каністри."}];response.data.receipt={...response.data.receipt,parts:300,coin_parts:250,checkpoint_parts:50};}
    return response;
  });
  await start();await frames(60);await click("Пауза");await click("Завершити та зберегти");
  expect(host.querySelector(".drive-run-analysis").textContent).toBe("Пальне закінчилося за 38 м до каністри.");
  expect(host.querySelector(".drive-reward").textContent).toContain("+300 монет");expect(host.querySelector(".drive-reward").textContent).toContain("позначки: 50");
  expect(host.querySelector(".drive-result-facts").textContent).toContain("Особистий рекорд");
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
  await click("До гаража");expect(phase()).toBe("garage");expect(service.get).toHaveBeenCalledTimes(2);
  expect(service.post.mock.calls.filter(([url])=>url.endsWith("/finish"))).toHaveLength(1);
});
