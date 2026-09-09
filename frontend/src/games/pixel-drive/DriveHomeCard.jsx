import {useEffect,useRef} from "react";
import {ChevronRight} from "lucide-react";
import {ART_URLS,drawParkedBuggy} from "./art";
import "./homeCard.css";
export default function DriveHomeCard({onClick}){
  const ref=useRef(null);
  useEffect(()=>{const image=new Image();let active=true;
    const draw=()=>{if(!active||!ref.current)return;const c=ref.current.getContext("2d");if(!c)return;c.clearRect(0,0,340,280);drawParkedBuggy(c,image,161,121,1.75,{engine:1,suspension:1,tires:1,tank:1});};
    image.onload=draw;image.src=ART_URLS.cat;draw();return()=>{active=false;image.onload=null;};
  },[]);
  return <button type="button" className="drive-home-card" style={{"--drive-landscape":"url('/games/pixel-drive/v1/landscape.webp')"}} onClick={onClick} data-testid="home-pixel-drive">
    <div className="drive-home-copy"><small>НОВА ПРИГОДА З ПІКСЕЛЕМ</small><strong>Повний газ</strong><span>Навчання + 6 трас · свій гараж</span><b>До пригоди <ChevronRight size={16}/></b></div>
    <canvas ref={ref} width="340" height="280" aria-hidden="true"/>
  </button>;
}
