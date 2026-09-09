const PALETTES = {
  garden: ["#353052", "#807198", "#d8a5b5", "#ffe2a9", "#746184", "#a98eae", "#9fe5df", "#529993"],
  sunset: ["#4b3b61", "#b07d92", "#f3b69c", "#fff0be", "#966c86", "#c494a6", "#ace5cc", "#64a78f"],
  stars: ["#181e42", "#4d5287", "#978bb4", "#fff0cf", "#464c75", "#8b8ab7", "#c3bcff", "#7e73b0"],
};

export function drawFlight(canvas, level, flight, cat, { preview = false, reduced = false } = {}) {
  if (!canvas || !level) return;
  const c = canvas.getContext("2d");
  if (!c) return;
  const p = PALETTES[level.theme] || PALETTES.garden;
  const round = (x, y, w, h, r, fill) => { c.fillStyle = fill; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };
  const cloud = (x, y, s, fill) => { c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, s * .53, s * .16, 0, 0, Math.PI * 2); c.ellipse(x - s * .2, y - s * .10, s * .19, s * .16, 0, 0, Math.PI * 2); c.ellipse(x + s * .06, y - s * .17, s * .25, s * .22, 0, 0, Math.PI * 2); c.ellipse(x + s * .28, y - s * .06, s * .19, s * .14, 0, 0, Math.PI * 2); c.fill(); };
  const star = (x, y, r, fill) => { c.fillStyle = fill; c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r * .25, y - r * .25); c.lineTo(x + r, y); c.lineTo(x + r * .25, y + r * .25); c.lineTo(x, y + r); c.lineTo(x - r * .25, y + r * .25); c.lineTo(x - r, y); c.lineTo(x - r * .25, y - r * .25); c.closePath(); c.fill(); };
  const post = (x, end, upper) => {
    const a = upper ? -8 : end + 8, b = upper ? end + 2 : 482, cy = upper ? end - 12 : end;
    const material = c.createLinearGradient(x, 0, x + 43, 0);
    material.addColorStop(0, "#b7886b"); material.addColorStop(.35, "#e4c39f"); material.addColorStop(.75, "#c8a079"); material.addColorStop(1, "#aa7f68");
    round(x, a, 43, b - a, 5, material);
    c.save(); c.beginPath(); c.rect(x, a, 43, b - a); c.clip(); c.strokeStyle = "#97725b55"; c.lineWidth = 2;
    for (let yy = a - 12; yy < b + 20; yy += 7) { c.beginPath(); c.moveTo(x - 4, yy); c.lineTo(x + 47, yy + 12); c.stroke(); }
    c.restore(); round(x - 9, cy, 61, 19, 8, p[7]); round(x - 9, cy, 61, 13, 7, p[6]); round(x - 3, cy + 2, 45, 3, 2, "#e6fff05c");
    if (!upper) { c.strokeStyle = p[7]; c.lineWidth = 2; c.beginPath(); c.moveTo(x + 26, end + 19); c.quadraticCurveTo(x + 65, end + 40, x + 53, end + 69); c.stroke(); c.fillStyle = p[6]; c.beginPath(); c.ellipse(x + 51, end + 65, 9, 4, -.7, 0, Math.PI * 2); c.ellipse(x + 57, end + 46, 9, 4, .5, 0, Math.PI * 2); c.fill(); }
  };
  c.setTransform(canvas.width / 360, 0, 0, canvas.height / 480, 0, 0);
  const gradient = c.createLinearGradient(0, 0, 0, 480);
  gradient.addColorStop(0, p[0]); gradient.addColorStop(.6, p[1]); gradient.addColorStop(1, p[2]); c.fillStyle = gradient; c.fillRect(0, 0, 360, 480);
  c.fillStyle = p[3]; c.beginPath(); c.arc(297, 92, 26, 0, Math.PI * 2); c.fill();
  for (let i = 0; i < (level.theme === "stars" ? 38 : 19); i++) { c.globalAlpha = .25 + (i % 3) * .18; star((i * 73 + 23) % 360, (i * 49 + 24) % 300, i % 5 === 0 ? 3.5 : 1.6, "#fff1dc"); } c.globalAlpha = 1;
  const time = flight ? flight.tick / 60 : 0, drift = !preview && !reduced ? time * 7 : 0;
  cloud(((72 - drift) % 480 + 480) % 480 - 60, 168, 120, p[5] + "69"); cloud(((346 - drift * .6) % 530 + 530) % 530 - 55, 256, 150, p[5] + "66");
  for (let i = 0; i < 7; i++) { const bx = i * 66 - 29 - (!preview && !reduced ? time * 3 % 66 : 0), by = 405 + (i % 3) * 14; round(bx, by, 48, 100, 4, p[4]); c.fillStyle = p[4]; c.beginPath(); c.moveTo(bx - 6, by); c.lineTo(bx + 24, by - 24); c.lineTo(bx + 54, by); c.fill(); round(bx + 20, by + 14, 9, 14, 4, p[3] + "66"); }
  if (preview) { post(-22, 228, true); post(315, 346, false); }
  else for (const gate of level.gates) { const x = (gate.x - level.speed * (flight?.tick || 0)) / 1000; if (x > -70 && x < 370) { post(x, (gate.center - gate.gap / 2) / 1000, true); post(x, (gate.center + gate.gap / 2) / 1000, false); } }
  const cx = preview ? 177 : level.physics.player_x / 1000, cy = preview ? 258 : (flight?.y ?? level.physics.start_y) / 1000, size = preview ? 124 : 55;
  const tilt = preview ? -.055 : reduced ? 0 : Math.max(-.20, Math.min(.37, (flight?.velocity || 0) / 18000));
  c.save(); c.translate(cx, cy); c.rotate(tilt);
  if (!reduced) { star(-size * .8, 8, 4, p[3]); star(-size * .58, -7, 2.5, "#fff1dc"); }
  cloud(0, size * .28, size * 1.15, "#bfc9e5"); cloud(1, size * .22, size * 1.13, "#f5f0fc");
  if (cat?.complete && cat.naturalWidth) c.drawImage(cat, -size * .51, -size * .67, size, size);
  c.restore();
  cloud(31, 486, 188, p[5]); cloud(184, 497, 220, p[5]); cloud(332, 486, 188, p[5]); cloud(0, 506, 180, "#e9cad6"); cloud(166, 513, 236, "#e9cad6"); cloud(359, 506, 175, "#e9cad6");
}
