import React,{act} from "react";
import {createRoot} from "react-dom/client";
import AppLayout from "@/components/AppLayout";
const mockNavigate=jest.fn(),mockUser={id:"drive-layout-test",role:"employee"};
let mockLocation;
jest.mock("react-router-dom",()=>({
  useNavigate:()=>mockNavigate,useLocation:()=>mockLocation,
  Outlet:()=> <div data-testid="route-content">Гра</div>,
  NavLink:({children,to,...props})=><a href={to} data-testid={props["data-testid"]}>{typeof children==="function"?children({isActive:false}):children}</a>,
}),{virtual:true});
jest.mock("@/context/AppContext",()=>({useApp:()=>({user:mockUser,logout:jest.fn()})}));
jest.mock("@/lib/api",()=>({__esModule:true,default:{post:()=>Promise.resolve({data:{}})}}));
jest.mock("@/components/NotificationBell",()=>()=>null);
jest.mock("@/components/InstallPrompt",()=>()=> <div data-testid="install-prompt"/>);
jest.mock("@/components/AdminAnnouncementModal",()=>()=> <div data-testid="announcement"/>);

test.each([
  ["/games/pixel-drive",true],
  ["/games/pixel-drive/",true],
  ["/",false],
  ["/games/pixel-drive/another-page",false],
])("the actual layout uses the correct full-width game shell for %s",async(pathname,isGame)=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;sessionStorage.clear();mockLocation={pathname,search:""};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(<AppLayout/>));
    expect(host.querySelector('[data-testid="route-content"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="main-content"]').getAttribute("data-game-route")).toBe(String(isGame));
    expect(host.querySelector(".app-theme-shell").style.maxWidth).toBe(isGame?"none":"480px");
    for(const selector of [".app-theme-header",'[data-testid="bottom-nav"]','[data-testid="install-prompt"]','[data-testid="announcement"]']){
      if(isGame)expect(host.querySelector(selector)).toBeNull();else expect(host.querySelector(selector)).not.toBeNull();
    }
  }finally{await act(async()=>root.unmount());host.remove();}
});
