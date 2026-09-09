import { act } from 'react';
import { createRoot } from 'react-dom/client';
import PetCatSprite, { clearRigAssetCache } from './PetCatSprite';

test('pause freezes the displayed pose; resuming does not skip time or flip the outgoing walk', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const originals = { Image: global.Image, request: global.requestAnimationFrame, cancel: global.cancelAnimationFrame };
  const images = [], frames = new Map(); let nextFrame = 0;
  global.Image = class { constructor() { this.naturalWidth = 256; this.naturalHeight = 256; images.push(this); } };
  global.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  global.cancelAnimationFrame = id => frames.delete(id);
  clearRigAssetCache();
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const snapshot = { pet: { name: 'Піксель', trust: 10, stats: { mood: 80, energy: 80 }, inventory: { equipped: {} } }, catalog: { items: [] } };
  const render = (x, paused = false) => act(() => root.render(<PetCatSprite pose="sit" snapshot={snapshot} chaseTarget={{ x, y: 81 }} paused={paused} />));
  const tick = timestamp => act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(timestamp)); });
  try {
    render(50);
    await act(async () => images.forEach(image => image.onload?.()));
    tick(0); render(69);
    for (let i = 1; i <= 12; i++) {
      tick(i * 16);
      const layers = [...host.querySelector('svg').children].filter(node => node.tagName.toLowerCase() === 'g');
      expect(layers.map(node => Number(node.getAttribute('opacity'))).filter(Boolean)).toEqual([1]);
    }
    expect(host.querySelector('[data-testid="play-cat"]').style.left).toBe('50.0000%'); // Rise before travel.
    for (let i = 13; i <= 42; i++) tick(i * 16);
    const cat = host.querySelector('[data-testid="play-cat"]');
    expect(cat.dataset.sequence).toBe('walk-right');
    render(69, true);
    const position = cat.style.left, pausedArt = cat.querySelector('svg').innerHTML;
    expect(frames.size).toBe(0);
    expect(cat.dataset.animationPaused).toBe('true');
    tick(100000);
    expect(cat.style.left).toBe(position);
    expect(cat.querySelector('svg').innerHTML).toBe(pausedArt);
    render(69);
    tick(100000); // First callback after resume must use dt = 0.
    expect(cat.style.left).toBe(position);
    expect(cat.querySelector('svg').innerHTML).toBe(pausedArt);
    tick(100016);
    expect(Math.abs(parseFloat(cat.style.left) - parseFloat(position))).toBeLessThan(.1);
    for (let i = 2; i < 160; i++) tick(100000 + i * 16);
    expect(cat.dataset.sequence).toBe('idle');
    const walkFacing = cat.querySelector('image[href$="walk-body.webp"]').parentElement.parentElement;
    expect(walkFacing.getAttribute('transform')).toBe('translate(1600 0) scale(-1 1)');
    render(31);
    for (let i = 0; i < 60; i++) tick(103000 + i * 16);
    expect(cat.dataset.sequence).toBe('walk-left');
    expect(walkFacing.getAttribute('transform')).toBe('');
    const turningPosition = cat.style.left;
    render(69);
    expect(walkFacing.getAttribute('transform')).toBe('');
    let satDuringTurn = false;
    for (let i = 0; i < 75; i++) {
      tick(104000 + i * 16);
      if (i < 12) expect(cat.style.left).toBe(turningPosition);
      satDuringTurn ||= cat.dataset.mode === 'sit';
    }
    expect(satDuringTurn).toBe(true);
    expect(walkFacing.getAttribute('transform')).toBe('translate(1600 0) scale(-1 1)');
  } finally {
    act(() => root.unmount()); host.remove(); clearRigAssetCache();
    global.Image = originals.Image; global.requestAnimationFrame = originals.request; global.cancelAnimationFrame = originals.cancel;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});

test.each(['clean', 'pounce', 'yawn'])('%s plays once, freezes on pause, and restarts for a new action without image requests', async reaction => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const originals = { Image: global.Image, request: global.requestAnimationFrame, cancel: global.cancelAnimationFrame };
  const images = [], frames = new Map(); let nextFrame = 0, clock = 0;
  global.Image = class { constructor() { this.naturalWidth = 256; this.naturalHeight = 256; images.push(this); } };
  global.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  global.cancelAnimationFrame = id => frames.delete(id);
  clearRigAssetCache();
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  const snapshot = { pet: { name: 'Піксель', trust: 10, stats: { mood: 80, energy: 80 }, inventory: { equipped: {} } }, catalog: { items: [] } };
  const render = (name, key, paused = false) => act(() => root.render(<PetCatSprite pose="sit" snapshot={snapshot} reaction={name} actionKey={key} paused={paused} />));
  const tick = () => act(() => { clock += 1000 / 60; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(clock)); });
  try {
    render('idle', 0);
    await act(async () => images.forEach(image => image.onload?.()));
    tick(); render(reaction, 1);
    for (let i = 0; i < 45; i++) tick();
    render(reaction, 1, true);
    const cat = host.querySelector('[data-testid="play-cat"]'), frozen = cat.querySelector('svg').innerHTML, age = cat.dataset.actionAge;
    for (let i = 0; i < 60; i++) tick();
    expect(cat.dataset.actionAge).toBe(age); expect(cat.querySelector('svg').innerHTML).toBe(frozen);
    render(reaction, 1);
    for (let i = 0; i < 260; i++) tick();
    expect(cat.dataset.mode).toBe('sit');
    expect(Number(cat.querySelector('image[href$="yawn-mouth.webp"]').getAttribute('opacity'))).toBe(0);
    const count = images.length;
    render(reaction, 2);
    expect(Number(cat.dataset.actionAge)).toBe(0);
    for (let i = 0; i < 50; i++) tick();
    if (reaction === 'yawn') expect(Number(cat.querySelector('image[href$="yawn-mouth.webp"]').getAttribute('opacity'))).toBeGreaterThan(.8);
    else expect(cat.dataset.mode).toBe(reaction === 'clean' ? 'groom' : 'walk');
    expect(images).toHaveLength(count);
  } finally {
    act(() => root.unmount()); host.remove(); clearRigAssetCache();
    global.Image = originals.Image; global.requestAnimationFrame = originals.request; global.cancelAnimationFrame = originals.cancel;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
