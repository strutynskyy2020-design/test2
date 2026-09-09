import { ChevronRight } from "lucide-react";
import "./homeCard.css";

export default function FlappyHomeCard({ onClick }) {
  return <button type="button" className="flappy-home-card" data-testid="home-flappy-pixel" onClick={onClick}>
    <span className="flappy-home-art" aria-hidden="true"><img src="/pet/room/v6/rig/sit-poster.webp" alt="" loading="lazy" onError={e => { e.currentTarget.hidden = true; }} /><span>☁</span></span>
    <span className="flappy-home-copy"><small>Небесна пригода</small><strong>Flappy Піксель</strong><span>12 рівнів · 3 нові світи</span></span>
    <ChevronRight size={23} aria-hidden="true" />
  </button>;
}
