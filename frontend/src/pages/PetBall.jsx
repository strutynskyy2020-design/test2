import { useEffect, useRef } from "react";
import { stepBall, throwBall } from "./petGestures";

export default function PetBall({ toss, catPosition, onPosition, onFinish, onBounce, paused }) {
  const element = useRef(null), callbacks = useRef({ catPosition, onPosition, onFinish, onBounce });
  callbacks.current = { catPosition, onPosition, onFinish, onBounce };
  useEffect(() => {
    if (!toss || paused) return undefined;
    let ball = throwBall(toss.point, toss.velocity), frame, previous, lastUpdate = 0, active = true;
    const tick = (now) => {
      if (!active) return;
      const priorBounces = ball.bounces;
      ball = stepBall(ball, previous ? (now - previous) / 1000 : .016, callbacks.current.catPosition()); previous = now;
      if (element.current) { element.current.style.left = `${ball.x}%`; element.current.style.top = `${ball.y}%`; element.current.style.transform = `translate(-50%, -50%) rotate(${ball.rotation}deg)`; }
      if (ball.bounces > priorBounces) callbacks.current.onBounce();
      if (now - lastUpdate > 130) { lastUpdate = now; callbacks.current.onPosition(ball); }
      if (ball.stopped) { active = false; callbacks.current.onFinish(ball.distance >= 8, toss.context); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [toss, paused]);
  return toss ? <img ref={element} className="play-rolling-ball" src="/pet/room/v3/items/ball.webp" alt="М’ячик котиться" draggable={false} /> : null;
}
