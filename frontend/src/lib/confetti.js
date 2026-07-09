import confetti from "canvas-confetti";

export const fireConfetti = () => {
  const colors = ["#FFB800", "#FF5C00", "#39FF14", "#00F0FF", "#F5F5F5"];
  confetti({
    particleCount: 90,
    spread: 70,
    origin: { y: 0.6 },
    colors,
    scalar: 0.9,
  });
  setTimeout(() => {
    confetti({
      particleCount: 60,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.7 },
      colors,
    });
    confetti({
      particleCount: 60,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.7 },
      colors,
    });
  }, 180);
};
