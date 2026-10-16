import * as THREE from 'three/webgpu';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import './styles.css';
import segaLogoUrl from './LOGO SEGA/SEGA LOGO.png';
import fondoUrl from './FONDO.png';
import bgmUrl from './MUSICA/green-hill-zone.mp3';
import segaJingleUrl from './MUSICA/SEGA.mp3';
import ringSfxUrl from './MUSICA/Sonic Ring - Sound Effect (HD).mp3';
import { createParameters } from './simulation/parameters.js';
import { createSimulation } from './simulation/createSimulation.js';
import { createLabPanel } from './ui/labPanel.js';

const BGM_VOLUME = 0.4;
const RING_VOLUME = 0.8;

// Letras de tu propio juego (capa blanca + relleno azul) que arman la palabra en el final.
// Rutas literales para que Vite incluya los PNG. "from" es de dónde llega cada letra.
const WORD_LETTERS = [
  {
    name: 'S',
    white: new URL('./letras blancas/S_blanco.png', import.meta.url).href,
    blue: new URL('./letras azules/S_azul.png', import.meta.url).href,
    from: ['-60vw', '0vh'], rotation: '-28deg', delay: '0s'
  },
  {
    name: 'E',
    white: new URL('./letras blancas/E_blanco.png', import.meta.url).href,
    blue: new URL('./letras azules/E_azul.png', import.meta.url).href,
    from: ['0vw', '-70vh'], rotation: '22deg', delay: '.14s'
  },
  {
    name: 'G',
    white: new URL('./letras blancas/G_blanco.png', import.meta.url).href,
    blue: new URL('./letras azules/G_azul.png', import.meta.url).href,
    from: ['0vw', '70vh'], rotation: '-22deg', delay: '.28s'
  },
  {
    name: 'A',
    white: new URL('./letras blancas/A_blanco.png', import.meta.url).href,
    blue: new URL('./letras azules/A_azul.png', import.meta.url).href,
    from: ['60vw', '0vh'], rotation: '28deg', delay: '.42s'
  }
];

async function main() {
  const mount = document.querySelector('#app');
  if (!mount) throw new Error('No se encontró el elemento #app en index.html.');
  if (!WebGPU.isAvailable()) {
    mount.appendChild(WebGPU.getErrorMessage());
    throw new Error('Se necesita un navegador compatible con WebGPU.');
  }

  const params = createParameters();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#030509');

  const camera = new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 100);
  camera.position.set(0, 0, 25);
  camera.lookAt(0, 0, 0);

  // Sin antialias a propósito: queremos píxeles duros, estilo retro.
  const renderer = new THREE.WebGPURenderer({ antialias: false, alpha: false });
  mount.appendChild(renderer.domElement);

  // Render a baja resolución (params.pixelSize) y el navegador lo escala con píxeles nítidos.
  function resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixel = Math.max(1, params.pixelSize || 1);
    renderer.setPixelRatio(1);
    renderer.setSize(Math.ceil(width / pixel), Math.ceil(height / pixel), false);
    const aspect = width / height;
    const halfHeight = 6;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }
  resize();
  await renderer.init();

  scene.add(new THREE.AmbientLight('#ffffff', 1.2));

  let soundEnabled = true;
  let audioContext = null;
  let started = false;
  let ended = false;
  let lastTime = 0;
  let simulation;
  let finaleTimers = [];
  let finaleOverlay = null;
  let lastWarningSecond = null;
  let shake = 0;

  // ---------- Audio ----------
  const bgm = new Audio(bgmUrl);
  bgm.loop = true;
  bgm.volume = BGM_VOLUME;
  bgm.preload = 'auto';
  const jingle = new Audio(segaJingleUrl);
  jingle.preload = 'auto';
  const ringSfx = new Audio(ringSfxUrl);
  ringSfx.preload = 'auto';
  let jingleAnalyser = null;
  let analyserData = null;
  let bgmFadeTimer = null;
  let logoFrame = null;
  // 0 = logo hecho con tus letras, 1 = logo original. El botón del final alterna entre ambos.
  let logoMorphTarget = 0;
  let logoMorph = 0;
  let morphParticles = null;
  let finaleTrails = [];

  const gameUI = createLabPanel({
    onToggleSound: enabled => {
      soundEnabled = enabled;
      applySoundState();
      if (enabled) beep(620, 0.07, 'triangle', 0.035);
    }
  });

  function getAudioContext() {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    return audioContext;
  }

  function applySoundState() {
    bgm.muted = !soundEnabled;
    jingle.muted = !soundEnabled;
    ringSfx.muted = !soundEnabled;
  }

  function beep(frequency = 440, duration = 0.12, type = 'sine', volume = 0.035) {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + duration);
    } catch (error) {
      // El juego sigue funcionando aunque el navegador bloquee el audio.
    }
  }

  function playBgm() {
    clearInterval(bgmFadeTimer);
    bgm.volume = BGM_VOLUME;
    bgm.currentTime = 0;
    bgm.play().catch(() => {});
  }

  function stopBgm(fade = true) {
    clearInterval(bgmFadeTimer);
    if (!fade || bgm.paused) {
      bgm.pause();
      bgm.volume = BGM_VOLUME;
      return;
    }
    bgmFadeTimer = setInterval(() => {
      bgm.volume = Math.max(0, bgm.volume - 0.06);
      if (bgm.volume <= 0.001) {
        clearInterval(bgmFadeTimer);
        bgm.pause();
        bgm.volume = BGM_VOLUME;
      }
    }, 40);
  }

  // Cada anillo usa una copia del audio para que puedan solaparse si recoges varios seguidos.
  function playRing() {
    if (!soundEnabled) return;
    const sfx = ringSfx.cloneNode();
    sfx.volume = RING_VOLUME;
    sfx.play().catch(() => {});
  }

  // El jingle pasa por un analizador para que el logo final reaccione al sonido.
  function ensureJingleAnalyser() {
    if (jingleAnalyser) return;
    try {
      const ctx = getAudioContext();
      const source = ctx.createMediaElementSource(jingle);
      jingleAnalyser = ctx.createAnalyser();
      jingleAnalyser.fftSize = 256;
      jingleAnalyser.smoothingTimeConstant = 0.55;
      analyserData = new Uint8Array(jingleAnalyser.frequencyBinCount);
      source.connect(jingleAnalyser);
      jingleAnalyser.connect(ctx.destination);
    } catch (error) {
      jingleAnalyser = null;
    }
  }

  function playJingle() {
    jingle.currentTime = 0;
    jingle.volume = 1;
    jingle.play().catch(() => {});
  }

  // ---------- Eventos del juego ----------
  function eventHandler(type, value, extra) {
    if (type === 'tick') {
      // value = segundos restantes, extra = velocidad actual del taxi.
      gameUI.setTime(value, params.timePerLetter, params.warningTime);
      gameUI.setSpeed(extra / params.maxSpeed, extra * params.speedDisplayFactor);
      // Pitido cada segundo en los últimos segundos.
      if (value > params.warningTime) {
        lastWarningSecond = null;
      } else if (value > 0) {
        const second = Math.ceil(value);
        if (second !== lastWarningSecond) {
          lastWarningSecond = second;
          beep(880, 0.07, 'square', 0.03);
        }
      }
    } else if (type === 'timeout') {
      started = false;
      ended = true;
      lastWarningSecond = null;
      stopBgm(true);
      gameUI.setStatus('¡SE ACABÓ EL TIEMPO!');
      gameUI.showEnd(false, 'TIME UP', `Se acabó el tiempo en la letra ${value}. Pulsa espacio para volver a intentarlo.`);
      [330, 247, 196, 147].forEach((frequency, i) => setTimeout(() => beep(frequency, 0.16, 'sawtooth', 0.045), i * 120));
    } else if (type === 'pickup') {
      gameUI.setCount(value, extra || params.ringsPerLetter);
      gameUI.setStatus(value >= params.ringsPerLetter ? `ANILLOS COMPLETOS +${params.ringTimeBonus} S` : `ANILLO +${params.ringTimeBonus} S`);
      playRing();
    } else if (type === 'paint') {
      gameUI.setPaint(value, extra);
    } else if (type === 'exitOpen') {
      gameUI.setStatus('¡SALIDA ABIERTA!');
      beep(520, 0.16, 'square', 0.025);
    } else if (type === 'crash') {
      shake = 0.3;
      gameUI.setStatus(`¡CHOQUE! -${value ?? params.crashTimePenalty} S`);
      beep(105, 0.20, 'sawtooth', 0.065);
      setTimeout(() => beep(76, 0.12, 'square', 0.035), 60);
    } else if (type === 'portal') {
      gameUI.setStatus('PORTAL: BRAZO INFERIOR');
      beep(390, 0.12, 'triangle', 0.04);
    } else if (type === 'transitionStart') {
      gameUI.setStatus(`ENTRANDO EN ${value}`);
      beep(430, 0.1, 'square', 0.025);
    } else if (type === 'newLetter') {
      gameUI.setLetter(value, extra, 4);
      gameUI.setCount(0, params.ringsPerLetter);
      gameUI.setStatus(`LETRA ${value}`);
      [520, 660, 820].forEach((frequency, i) => setTimeout(() => beep(frequency, 0.08, 'triangle', 0.025), i * 55));
    } else if (type === 'win') {
      started = false;
      ended = true;
      stopBgm(true);
      gameUI.hideEnd();
      playFinale(value, saveBestTime(value));
      [523, 659, 784, 1046, 1318].forEach((frequency, i) => setTimeout(() => beep(frequency, 0.18, 'triangle', 0.04), i * 145));
    }
  }

  // ---------- Final: taxi escapa, aparece el fondo y el logo late con el jingle ----------
  function ensureFinale() {
    if (finaleOverlay) return finaleOverlay;
    const style = document.createElement('style');
    style.textContent = `
      .finale-overlay{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;overflow:hidden;background:#030509;opacity:0;pointer-events:none;transition:opacity .55s ease;font-family:monospace}
      .finale-overlay.active{opacity:1;pointer-events:auto}
      .finale-bg{position:absolute;inset:0;z-index:0;background:#030509 url("${fondoUrl}") center/cover no-repeat;opacity:0;transition:opacity 1.2s ease;filter:brightness(calc(.7 + var(--beat,0) * .55))}
      .finale-overlay.reveal .finale-bg{opacity:1}
      .finale-streaks{position:absolute;inset:0;opacity:0;background:repeating-linear-gradient(112deg,transparent 0 8%,rgba(255,255,255,.18) 8.2% 8.45%,transparent 8.7% 15%);transform:translateX(-120%);}
      .finale-overlay.run .finale-streaks{animation:finale-streak 1s ease-out forwards}
      .finale-taxi{position:absolute;left:50%;bottom:-18%;width:58px;height:32px;background:#d8aa12;border:4px solid #090b10;box-shadow:0 0 0 2px #e9c33e,0 0 24px #e6bb24;transform:translate(-50%,0) rotate(-12deg);border-radius:3px;z-index:2}
      .finale-taxi:before{content:'';position:absolute;inset:5px 12px;background:#090f18;border:2px solid #06080b}
      .finale-taxi:after{content:'';position:absolute;left:22px;top:-7px;width:10px;height:6px;background:#fff;box-shadow:-24px 34px 0 #fff,24px 34px 0 #fff}
      .finale-overlay.run .finale-taxi{animation:finale-taxi-escape 1.65s cubic-bezier(.25,.7,.25,1) forwards}
      .finale-word{position:absolute;z-index:1;display:flex;align-items:center;justify-content:center;gap:clamp(6px,2vw,28px);max-width:94vw;transition:gap 1s cubic-bezier(.16,1,.3,1);will-change:transform,filter}
      .finale-overlay.reveal .finale-word{gap:clamp(1px,.4vw,6px)}
      .finale-overlay.reveal .finale-letter{height:min(40vh,23vw)}
      .finale-letter{position:relative;height:min(34vh,21vw);opacity:0;will-change:transform,filter;transition:height 1s cubic-bezier(.16,1,.3,1)}
      .finale-letter img{display:block;height:100%;width:auto}
      .finale-letter .letter-blue{position:absolute;inset:0;width:100%;height:100%}
      .finale-letter .letter-trail{position:absolute;inset:0;width:100%;height:100%;image-rendering:auto;pointer-events:none}
      .finale-overlay.letters .finale-letter{animation:finale-letter-in .75s cubic-bezier(.2,.8,.2,1) var(--d,0s) both}
      .finale-logo-wrap{position:relative;z-index:1;display:grid;place-items:center;opacity:0;pointer-events:none;will-change:transform,filter}
      .finale-logo{display:block;width:min(70vw,920px);max-height:60vh;object-fit:contain}
      .finale-morph{position:absolute;inset:0;z-index:2;width:100%;height:100%;pointer-events:none}
      .finale-compare{position:absolute;z-index:3;bottom:17%;left:50%;transform:translateX(-50%);padding:9px 16px;border:2px solid #2f9dff;background:rgba(0,7,15,.85);color:#e9f5ff;font:900 clamp(11px,1.3vw,15px) "Courier New",monospace;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .5s ease 1.6s,background .15s}
      .finale-overlay.reveal .finale-compare{opacity:1;pointer-events:auto}
      .finale-compare:hover{background:#0b2a45}
      .finale-caption{position:absolute;bottom:8%;left:0;right:0;text-align:center;color:#f5f7ff;letter-spacing:.28em;font-size:clamp(11px,1.5vw,16px);opacity:0;transition:opacity .6s ease .5s;text-shadow:0 0 8px #000,0 0 18px #000}
      .finale-overlay.reveal .finale-caption{opacity:.9}
      @keyframes finale-taxi-escape{0%{left:50%;bottom:-18%;transform:translate(-50%,0) rotate(-12deg) scale(1)}45%{left:56%;bottom:45%;transform:translate(-50%,0) rotate(18deg) scale(1.25)}75%{left:67%;bottom:72%;transform:translate(-50%,0) rotate(35deg) scale(.8)}100%{left:120%;bottom:120%;transform:translate(-50%,0) rotate(55deg) scale(.12)}}
      @keyframes finale-letter-in{0%{opacity:0;transform:translate(var(--fx),var(--fy)) rotate(var(--rot)) scale(.4);filter:blur(10px) brightness(2)}70%{opacity:1;transform:translate(0,0) rotate(0) scale(1.08);filter:blur(0) brightness(1.4)}100%{opacity:1;transform:translate(0,0) rotate(0) scale(1);filter:blur(0) brightness(1)}}
      @keyframes finale-streak{0%{opacity:0;transform:translateX(-120%)}35%{opacity:.85}100%{opacity:0;transform:translateX(120%)}}
      @media(prefers-reduced-motion:reduce){.finale-overlay.run .finale-taxi,.finale-overlay.run .finale-streaks{animation-duration:.2s}.finale-overlay.letters .finale-letter{animation-duration:.2s}}
    `;
    document.head.append(style);
    finaleOverlay = document.createElement('div');
    finaleOverlay.className = 'finale-overlay';
    finaleOverlay.setAttribute('aria-label', 'Final de la experiencia');
    finaleOverlay.innerHTML = `
      <div class="finale-bg"></div>
      <div class="finale-streaks"></div>
      <div class="finale-taxi" aria-hidden="true"></div>
      <div class="finale-word" aria-hidden="true">
        ${WORD_LETTERS.map(letter => `
          <div class="finale-letter" style="--fx:${letter.from[0]};--fy:${letter.from[1]};--rot:${letter.rotation};--d:${letter.delay}">
            <img class="letter-white" src="${letter.white}" alt="" />
            <img class="letter-blue" src="${letter.blue}" alt="" />
            <canvas class="letter-trail"></canvas>
          </div>`).join('')}
      </div>
      <div class="finale-logo-wrap"><img class="finale-logo" alt="SEGA" /></div>
      <canvas class="finale-morph"></canvas>
      <button class="finale-compare" type="button">VER LOGO ORIGINAL</button>
      <div class="finale-caption">RUTA COMPLETADA</div>
    `;
    finaleOverlay.querySelector('.finale-logo').src = segaLogoUrl;
    finaleOverlay.querySelector('.finale-compare').addEventListener('click', event => {
      if (logoMorph <= 0.001 || logoMorph >= 0.999) morphParticles = buildMorphParticles(finaleOverlay);
      logoMorphTarget = logoMorphTarget ? 0 : 1;
      setCompareLabel();
      event.currentTarget.blur(); // para que la barra espaciadora no dispare el botón
    });
    document.body.append(finaleOverlay);
    return finaleOverlay;
  }

  // ---------- Recorrido del carro dentro de cada letra del final ----------
  let trailFrame = null;

  // Dibuja la estela blanca (con halo azul) hasta el porcentaje "progress" del recorrido.
  function drawLetterTrail(canvas, trail, progress) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!trail || !trail.strokes.length || progress <= 0) return;
    const W = canvas.width;
    const H = canvas.height;
    const total = trail.strokes.reduce((n, stroke) => n + stroke.length, 0);
    const budget = Math.floor(total * Math.min(1, progress));
    const passes = [
      { color: 'rgba(116,186,255,.38)', width: H * 0.034 },
      { color: '#ffffff', width: H * 0.015 }
    ];
    for (const pass of passes) {
      let remaining = budget;
      ctx.strokeStyle = pass.color;
      ctx.lineWidth = pass.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const stroke of trail.strokes) {
        if (remaining < 2) break;
        const count = Math.min(stroke.length, remaining);
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const x = stroke[i][0] * W;
          const y = stroke[i][1] * H;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
        remaining -= count;
      }
    }
  }

  // Ajusta cada canvas a la proporción de su letra y lo deja vacío.
  function prepareTrails(overlay) {
    const trails = simulation.getRecordedTrails();
    const canvases = [...overlay.querySelectorAll('.letter-trail')];
    canvases.forEach((canvas, i) => {
      canvas.height = 640;
      canvas.width = Math.round(640 * (trails[i]?.aspect || 1));
    });
    return { trails, canvases };
  }

  // La estela se va dibujando sobre cada letra mientras llega volando.
  function animateTrails(overlay, prepared) {
    cancelAnimationFrame(trailFrame);
    const { trails, canvases } = prepared;
    const startedAt = performance.now();
    const tick = now => {
      const t = (now - startedAt) / 1000;
      let pending = false;
      canvases.forEach((canvas, i) => {
        const p = (t - 0.3 - parseFloat(WORD_LETTERS[i].delay)) / 0.9;
        drawLetterTrail(canvas, trails[i], p);
        if (p < 1) pending = true;
      });
      trailFrame = pending ? requestAnimationFrame(tick) : null;
    };
    trailFrame = requestAnimationFrame(tick);
  }

  // La palabra SEGA (hecha con tus letras) late con el jingle con el volumen del jingle: brillo, escala y resplandor.
  // ---------- Transformación: la estela dibujada por el carro se convierte en el logo original ----------
  const MORPH_PARTICLES = 3000;

  // Puntos repartidos a lo largo de las estelas grabadas, ya en coordenadas de pantalla.
  function sampleTrailPoints(overlay, count) {
    const letters = [...overlay.querySelectorAll('.finale-letter')];
    const pieces = letters.map((el, i) => {
      const r = el.getBoundingClientRect();
      const segs = [];
      let length = 0;
      for (const stroke of finaleTrails[i]?.strokes || []) {
        for (let j = 1; j < stroke.length; j++) {
          const x0 = r.left + stroke[j - 1][0] * r.width, y0 = r.top + stroke[j - 1][1] * r.height;
          const x1 = r.left + stroke[j][0] * r.width, y1 = r.top + stroke[j][1] * r.height;
          const len = Math.hypot(x1 - x0, y1 - y0);
          if (len > 0) { segs.push({ x0, y0, x1, y1, start: length, len }); length += len; }
        }
      }
      return { r, segs, length };
    });
    const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
    const points = [];
    for (const piece of pieces) {
      const k = total ? Math.round(count * piece.length / total) : 0;
      let seg = 0;
      for (let n = 0; n < k; n++) {
        const d = ((n + Math.random()) / k) * piece.length;
        while (seg < piece.segs.length - 1 && piece.segs[seg].start + piece.segs[seg].len < d) seg++;
        const sgm = piece.segs[seg];
        const t = Math.min(1, Math.max(0, (d - sgm.start) / sgm.len));
        points.push({ x: sgm.x0 + (sgm.x1 - sgm.x0) * t, y: sgm.y0 + (sgm.y1 - sgm.y0) * t });
      }
    }
    // Si alguna letra no tiene recorrido, se rellena con puntos de su silueta para no dejar huecos.
    while (points.length < count) {
      const r = pieces[points.length % pieces.length].r;
      points.push({ x: r.left + Math.random() * r.width, y: r.top + Math.random() * r.height });
    }
    return points;
  }

  // Puntos tomados de los píxeles reales del logo original, con su color.
  function sampleLogoPoints(overlay, count) {
    const img = overlay.querySelector('.finale-logo');
    const boxW = img.offsetWidth || 1;
    const boxH = img.offsetHeight || 1;
    const nw = img.naturalWidth || boxW;
    const nh = img.naturalHeight || boxH;
    const scale = Math.min(boxW / nw, boxH / nh);
    const dw = nw * scale;
    const dh = nh * scale;
    const left = (window.innerWidth - dw) / 2;
    const top = (window.innerHeight - dh) / 2;
    const cw = Math.max(1, Math.min(480, Math.round(dw)));
    const ch = Math.max(1, Math.round(cw * dh / dw));
    const off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    const data = ctx.getImageData(0, 0, cw, ch).data;
    const solid = [];
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 160) solid.push(i);
    const points = [];
    for (let n = 0; n < count; n++) {
      const i = solid.length ? solid[Math.floor(Math.random() * solid.length)] : 0;
      const px = (i / 4) % cw;
      const py = Math.floor(i / 4 / cw);
      points.push({ x: left + (px / cw) * dw, y: top + (py / ch) * dh, r: data[i], g: data[i + 1], b: data[i + 2] });
    }
    return points;
  }

  // Empareja cada punto de la estela con uno del logo (de izquierda a derecha, por columnas).
  function buildMorphParticles(overlay) {
    const from = sampleTrailPoints(overlay, MORPH_PARTICLES);
    const to = sampleLogoPoints(overlay, MORPH_PARTICLES);
    const order = list => {
      list.sort((a, b) => a.x - b.x);
      for (let i = 0; i < list.length; i += 60) {
        const chunk = list.slice(i, i + 60).sort((a, b) => a.y - b.y);
        list.splice(i, chunk.length, ...chunk);
      }
      return list;
    };
    order(from);
    order(to);
    const canvas = overlay.querySelector('.finale-morph');
    canvas.width = Math.max(1, Math.ceil(window.innerWidth / 2));
    canvas.height = Math.max(1, Math.ceil(window.innerHeight / 2));
    return from.map((a, i) => {
      const b = to[i];
      return { sx: a.x, sy: a.y, tx: b.x, ty: b.y, r: b.r, g: b.g, b: b.b, delay: Math.random(), swirl: (Math.random() - 0.5) * 140 };
    });
  }

  // m: 0 = letras dibujadas, 1 = logo original. Las partículas viajan entre ambos.
  function drawMorph(canvas, m, logoAlpha) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!morphParticles || m <= 0.002 || m >= 0.998) return;
    const k = canvas.width / window.innerWidth;
    ctx.globalAlpha = 1 - logoAlpha;
    for (const q of morphParticles) {
      const u = Math.min(1, Math.max(0, (m - 0.1 - q.delay * 0.2) / 0.55));
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const dx = q.tx - q.sx;
      const dy = q.ty - q.sy;
      const len = Math.hypot(dx, dy) || 1;
      const bend = Math.sin(Math.PI * u) * q.swirl;
      const x = q.sx + dx * e - (dy / len) * bend;
      const y = q.sy + dy * e + (dx / len) * bend;
      ctx.fillStyle = `rgb(${Math.round(255 + (q.r - 255) * e)},${Math.round(255 + (q.g - 255) * e)},${Math.round(255 + (q.b - 255) * e)})`;
      ctx.fillRect(Math.round(x * k), Math.round(y * k), 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function setCompareLabel() {
    if (!finaleOverlay) return;
    finaleOverlay.querySelector('.finale-compare').textContent = logoMorphTarget ? 'VER MI LOGO' : 'VER LOGO ORIGINAL';
  }

  function startLogoReaction() {
    const overlay = ensureFinale();
    const word = overlay.querySelector('.finale-word');
    const logo = overlay.querySelector('.finale-logo-wrap');
    const morphCanvas = overlay.querySelector('.finale-morph');
    const startedAt = performance.now();
    let previous = startedAt;
    cancelAnimationFrame(logoFrame);
    const tick = now => {
      const elapsed = now - startedAt;
      const dt = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      const playing = !jingle.paused && !jingle.ended;
      let level;
      if (playing && soundEnabled && jingleAnalyser) {
        jingleAnalyser.getByteFrequencyData(analyserData);
        const bins = 24;
        let sum = 0;
        for (let i = 0; i < bins; i++) sum += analyserData[i];
        level = Math.min(1, (sum / (bins * 255)) * 1.6);
      } else if (playing || elapsed < 2500) {
        // Sin sonido (o sin analizador) el logo parpadea igualmente al ritmo del jingle.
        level = 0.5 + 0.5 * Math.sin(elapsed / 95);
      } else {
        // Terminado el jingle, un latido suave para que el logo no quede congelado.
        level = 0.12 + 0.08 * Math.sin(elapsed / 420);
      }
      // Transformación rápida (~0.9 s): la estela se convierte en el logo original (o al revés).
      const gap = logoMorphTarget - logoMorph;
      logoMorph += Math.sign(gap) * Math.min(Math.abs(gap), dt / 0.9);
      const m = logoMorph;
      const glow = `drop-shadow(0 0 ${(8 + level * 46).toFixed(0)}px rgba(47,157,255,${(0.35 + level * 0.6).toFixed(2)}))`;
      const bright = (1 + level * 0.9).toFixed(2);
      const logoAlpha = Math.min(1, Math.max(0, (m - 0.86) / 0.14));
      const pulse = `scale(${(1 + level * 0.1).toFixed(3)})`;
      word.style.opacity = Math.min(1, Math.max(0, 1 - m / 0.12)).toFixed(3);
      word.style.transform = pulse;
      word.style.filter = `brightness(${bright}) ${glow}`;
      logo.style.opacity = logoAlpha.toFixed(3);
      logo.style.transform = pulse;
      logo.style.filter = `brightness(${bright}) ${glow}`;
      drawMorph(morphCanvas, m, logoAlpha);
      overlay.style.setProperty('--beat', level.toFixed(3));
      logoFrame = requestAnimationFrame(tick);
    };
    logoFrame = requestAnimationFrame(tick);
  }

  function stopLogoReaction() {
    cancelAnimationFrame(logoFrame);
    logoFrame = null;
    if (!finaleOverlay) return;
    const morphCanvas = finaleOverlay.querySelector('.finale-morph');
    morphCanvas.getContext('2d').clearRect(0, 0, morphCanvas.width, morphCanvas.height);
    for (const el of [finaleOverlay.querySelector('.finale-word'), finaleOverlay.querySelector('.finale-logo-wrap')]) {
      el.style.opacity = '';
      el.style.transform = '';
      el.style.filter = '';
    }
    finaleOverlay.style.setProperty('--beat', '0');
  }

  // Récord de tiempo total, guardado en el navegador (si el almacenamiento falla, el juego sigue).
  function saveBestTime(totalSeconds) {
    const key = 'sega-taxi-best-time';
    try {
      const previous = Number(localStorage.getItem(key));
      const isRecord = !previous || totalSeconds < previous;
      if (isRecord) localStorage.setItem(key, String(totalSeconds));
      return { isRecord, best: isRecord ? totalSeconds : previous };
    } catch (error) {
      return { isRecord: false, best: null };
    }
  }

  function playFinale(totalSeconds, record) {
    const overlay = ensureFinale();
    let caption = 'RUTA COMPLETADA';
    if (Number.isFinite(totalSeconds)) {
      caption += ` · ${totalSeconds.toFixed(2)} S`;
      if (record?.isRecord) caption += ' · ¡NUEVO RÉCORD!';
      else if (record?.best) caption += ` · MEJOR ${record.best.toFixed(2)} S`;
    }
    overlay.querySelector('.finale-caption').textContent = caption;
    clearFinaleTimers();
    stopLogoReaction();
    logoMorphTarget = 0;
    logoMorph = 0;
    morphParticles = null;
    setCompareLabel();
    jingle.pause();
    cancelAnimationFrame(trailFrame);
    const preparedTrails = prepareTrails(overlay);
    finaleTrails = preparedTrails.trails;
    overlay.classList.remove('run', 'reveal', 'active', 'letters');
    // Reinicia la animación para que pueda reproducirse de nuevo sin recargar la página.
    void overlay.offsetWidth;
    overlay.classList.add('active', 'run');
    // 1) El taxi escapa. 2) Las letras S-E-G-A llegan volando y forman la palabra.
    finaleTimers.push(setTimeout(() => {
      overlay.classList.add('letters');
      animateTrails(overlay, preparedTrails);
      [523, 659, 784, 1046].forEach((frequency, i) => {
        finaleTimers.push(setTimeout(() => beep(frequency, 0.1, 'square', 0.035), 500 + i * 140));
      });
    }, 700));
    // 3) La palabra se funde con el logo: entra el fondo, suena SEGA y el logo reacciona.
    finaleTimers.push(setTimeout(() => {
      overlay.classList.add('reveal');
      playJingle();
      startLogoReaction();
    }, 2400));
  }

  function clearFinaleTimers() {
    finaleTimers.forEach(timer => clearTimeout(timer));
    finaleTimers = [];
  }

  function hideFinale() {
    clearFinaleTimers();
    cancelAnimationFrame(trailFrame);
    stopLogoReaction();
    jingle.pause();
    jingle.currentTime = 0;
    if (finaleOverlay) finaleOverlay.classList.remove('active', 'run', 'reveal', 'letters');
  }

  simulation = await createSimulation({ scene, params, onEvent: eventHandler });
  gameUI.setLetter('S', 1, 4);
  gameUI.setCount(0, params.ringsPerLetter);
  gameUI.setStatus('ESCAPA');

  function beginExperience() {
    if (started && !ended) return;
    if (ended) simulation.reset();
    hideFinale();
    started = true;
    ended = false;
    gameUI.hideIntro();
    gameUI.hideEnd();
    simulation.start();
    // Tras perder o ganar, el HUD debe volver a la primera letra.
    gameUI.setLetter('S', 1, 4);
    gameUI.setCount(0, params.ringsPerLetter);
    gameUI.setStatus('¡YA!');
    // Al pulsar PRESS START empieza Green Hill Zone (el gesto del usuario desbloquea el audio).
    ensureJingleAnalyser();
    applySoundState();
    playBgm();
    beep(660, 0.11, 'square', 0.03);
    setTimeout(() => beep(880, 0.15, 'square', 0.03), 100);
  }

  window.addEventListener('keydown', event => {
    if (event.code === 'Space' && (!started || ended)) {
      event.preventDefault();
      if (audioContext?.state === 'suspended') audioContext.resume();
      beginExperience();
    }
    if (event.code === 'KeyM' && !event.repeat) {
      soundEnabled = !soundEnabled;
      applySoundState();
      gameUI.setSoundEnabled(soundEnabled);
      if (soundEnabled) beep(620, 0.07, 'triangle', 0.035);
    }
    if (event.code === 'Escape' && started && !ended) {
      started = false;
      stopBgm(true);
      gameUI.showIntro();
      gameUI.setStatus('ESCAPA');
      simulation.reset();
    }
  });

  window.addEventListener('resize', resize);

  renderer.setAnimationLoop(time => {
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.035) : 0.016;
    lastTime = time;
    if (started && !ended) simulation.update(dt);
    simulation.animateDecor(time, dt);
    // Sacudida de cámara al chocar: se amortigua sola.
    if (shake > 0.003) {
      camera.position.x = (Math.random() - 0.5) * shake;
      camera.position.y = (Math.random() - 0.5) * shake;
      shake *= 0.86;
    } else if (shake > 0) {
      shake = 0;
      camera.position.x = 0;
      camera.position.y = 0;
    }
    renderer.render(scene, camera);
  });
}

main().catch(error => {
  console.error(error);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:12px;padding:16px;background:#190b10;color:#fff;white-space:pre-wrap;z-index:100;overflow:auto';
  pre.textContent = `No se pudo iniciar la experiencia.\n${error?.stack || error}`;
  document.body.append(pre);
});