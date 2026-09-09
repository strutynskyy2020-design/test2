import React,{act} from "react";
import {createRoot} from "react-dom/client";
import Home from "@/pages/Home";
const mockNavigate=jest.fn();
const mockUser={id:"drive-test",name:"Тест",balance:0,total_earned:0,streak:0,role:"employee"};
jest.mock("react-router-dom",()=>({useNavigate:()=>mockNavigate}),{virtual:true});
jest.mock("@/context/AppContext",()=>({useApp:()=>({mode:"live",user:mockUser})}));
jest.mock("@/hooks/useGoogleReports",()=>({useDailyGoogleReports:()=>({data:null})}));
jest.mock("@/lib/api",()=>({__esModule:true,default:{get:()=>Promise.resolve({data:{events:[]}})}}));
jest.mock("@/components/AvatarFrame",()=>()=>null);
jest.mock("@/components/FeedItem",()=>()=>null);
jest.mock("@/components/ThemeToggle",()=>()=>null);
jest.mock("./art",()=>({ART_URLS:{cat:"/cat.webp"},drawParkedBuggy:()=>{}}));
test("the actual home page places Pixel Drive immediately before the work schedule and opens its game route",async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;
  window.requestIdleCallback=()=>1;window.cancelIdleCallback=()=>{};
  HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(<Home/>));
    const card=host.querySelector('[data-testid="home-pixel-drive"]');
    expect(card).not.toBeNull();expect(card.nextElementSibling.textContent).toContain("МІЙ ГРАФІК");
    await act(async()=>card.click());
    const destination=new URL(mockNavigate.mock.calls.at(-1)[0],"http://localhost");
    expect(destination.pathname).toBe("/games/pixel-drive");
    expect(destination.searchParams.get("from")).toBe("pixel");
  }finally{await act(async()=>root.unmount());host.remove();}
});
