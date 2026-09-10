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
test("home hides the standalone Flappy and Pixel Drive cards while keeping access to Pixel's room",async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(<Home/>));
    expect(host.querySelector('[data-testid="home-pixel-drive"]')).toBeNull();
    expect(host.querySelector('[data-testid="home-flappy-pixel"]')).toBeNull();
    expect(host.textContent).not.toMatch(/Flappy|Повний газ/);
    expect(host.textContent).toContain("МІЙ ГРАФІК");
    const card=host.querySelector('[data-testid="home-pixel-story"]');
    expect(card).not.toBeNull();
    await act(async()=>card.click());
    const destination=new URL(mockNavigate.mock.calls.at(-1)[0],"http://localhost");
    expect(destination.pathname).toBe("/pet/room");
  }finally{await act(async()=>root.unmount());host.remove();}
});
