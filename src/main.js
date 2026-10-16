import * as THREE from 'three/webgpu';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import './styles.css';
import segaLogoUrl from './LOGO SEGA/SEGA LOGO.png';
import { createParameters } from './simulation/parameters.js';
import { createSimulation } from './simulation/createSimulation.js';
import { createLabPanel } from './ui/labPanel.js';

async function main() {
  const mount = document.querySelector('#app');
  if (!mount) throw new Error('No se encontró el elemento #app en index.html.');
  if (!WebGPU.isAvailable()) {
    mount.appendChild(WebGPU.getErrorMessage());
    throw new Error('Se necesita un navegador compatible con WebGPU.');
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#030509');

  const camera = new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 100);
  camera.position.set(0, 0, 25);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  mount.appendChild(renderer.domElement);
  await renderer.init();

  scene.add(new THREE.AmbientLight('#ffffff', 1.2));

  const params = createParameters();
  let soundEnabled = true;
  let audioContext = null;
  let started = false;
  let ended = false;
  let lastTime = 0;
  let simulation;
  let finaleTimer = null;
  let finaleOverlay = null;
  let lastWarningSecond = null;
  const gameUI = createLabPanel({ onToggleSound: enabled => { soundEnabled = enabled; if (enabled) beep(620, 0.07, 'triangle', 0.035); } });

  function beep(frequency = 440, duration = 0.12, type = 'sine', volume = 0.035) {
    if (!soundEnabled) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
      gain.gain.setValueAtTime(volume, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch (error) {
      // El juego sigue funcionando aunque el navegador bloquee el audio.
    }
  }

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
      gameUI.setStatus('¡SE ACABÓ EL TIEMPO!');
      gameUI.showEnd(false, 'TIME UP', `Se acabó el tiempo en la letra ${value}. Pulsa espacio para volver a intentarlo.`);
      [330, 247, 196, 147].forEach((frequency, i) => setTimeout(() => beep(frequency, 0.16, 'sawtooth', 0.045), i * 120));
    } else if (type === 'pickup') {
      gameUI.setCount(value, extra || params.ringsPerLetter);
      gameUI.setStatus(value >= params.ringsPerLetter ? `¡SALIDA ABIERTA! +${params.ringTimeBonus} S` : `ANILLO +${params.ringTimeBonus} S`);
      beep(740, 0.08, 'triangle', 0.04);
      setTimeout(() => beep(980, 0.12, 'triangle', 0.035), 70);
    } else if (type === 'exitOpen') {
      gameUI.setStatus('¡SALIDA ABIERTA! LLEGA AL PORTAL VERDE');
      beep(520, 0.16, 'square', 0.025);
    } else if (type === 'crash') {
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
      gameUI.setStatus(`¡${params.timePerLetter} S! RECOGE ${params.ringsPerLetter} ANILLOS Y SAL`);
      [520, 660, 820].forEach((frequency, i) => setTimeout(() => beep(frequency, 0.08, 'triangle', 0.025), i * 55));
    } else if (type === 'win') {
      started = false;
      ended = true;
      gameUI.hideEnd();
      playFinale(value, saveBestTime(value));
      [523, 659, 784, 1046, 1318].forEach((frequency, i) => setTimeout(() => beep(frequency, 0.18, 'triangle', 0.04), i * 145));
    }
  }


  function ensureFinale() {
    if (finaleOverlay) return finaleOverlay;
    const style = document.createElement('style');
    style.textContent = `
      .finale-overlay{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;overflow:hidden;background:#030509;opacity:0;pointer-events:none;transition:opacity .55s ease;font-family:monospace}
      .finale-overlay.active{opacity:1;pointer-events:auto}
      .finale-streaks{position:absolute;inset:0;opacity:0;background:repeating-linear-gradient(112deg,transparent 0 8%,rgba(255,255,255,.18) 8.2% 8.45%,transparent 8.7% 15%);transform:translateX(-120%);}
      .finale-overlay.run .finale-streaks{animation:finale-streak 1s ease-out forwards}
      .finale-taxi{position:absolute;left:50%;bottom:-18%;width:58px;height:32px;background:#d8aa12;border:4px solid #090b10;box-shadow:0 0 0 2px #e9c33e,0 0 24px #e6bb24;transform:translate(-50%,0) rotate(-12deg);border-radius:3px;z-index:2}
      .finale-taxi:before{content:'';position:absolute;inset:5px 12px;background:#090f18;border:2px solid #06080b}
      .finale-taxi:after{content:'';position:absolute;left:22px;top:-7px;width:10px;height:6px;background:#fff;box-shadow:-24px 34px 0 #fff,24px 34px 0 #fff}
      .finale-overlay.run .finale-taxi{animation:finale-taxi-escape 1.65s cubic-bezier(.25,.7,.25,1) forwards}
      .finale-logo{position:relative;z-index:1;width:min(78vw,1000px);max-height:65vh;object-fit:contain;opacity:0;transform:scale(.72);filter:blur(18px);transition:opacity 1s ease,transform 1.2s cubic-bezier(.16,1,.3,1),filter 1s ease}
      .finale-overlay.reveal .finale-logo{opacity:1;transform:scale(1);filter:blur(0)}
      .finale-caption{position:absolute;bottom:8%;left:0;right:0;text-align:center;color:#f5f7ff;letter-spacing:.28em;font-size:clamp(11px,1.5vw,16px);opacity:0;transition:opacity .6s ease .5s}
      .finale-overlay.reveal .finale-caption{opacity:.8}
      @keyframes finale-taxi-escape{0%{left:50%;bottom:-18%;transform:translate(-50%,0) rotate(-12deg) scale(1)}45%{left:56%;bottom:45%;transform:translate(-50%,0) rotate(18deg) scale(1.25)}75%{left:67%;bottom:72%;transform:translate(-50%,0) rotate(35deg) scale(.8)}100%{left:120%;bottom:120%;transform:translate(-50%,0) rotate(55deg) scale(.12)}}
      @keyframes finale-streak{0%{opacity:0;transform:translateX(-120%)}35%{opacity:.85}100%{opacity:0;transform:translateX(120%)}}
      @media(prefers-reduced-motion:reduce){.finale-overlay.run .finale-taxi,.finale-overlay.run .finale-streaks{animation-duration:.2s}.finale-logo{transition-duration:.2s}}
    `;
    document.head.append(style);
    finaleOverlay = document.createElement('div');
    finaleOverlay.className = 'finale-overlay';
    finaleOverlay.setAttribute('aria-label', 'Final de la experiencia');
    finaleOverlay.innerHTML = `
      <div class="finale-streaks"></div>
      <div class="finale-taxi" aria-hidden="true"></div>
      <img class="finale-logo" alt="SEGA" />
      <div class="finale-caption">RUTA COMPLETADA</div>
    `;
    finaleOverlay.querySelector('.finale-logo').src = segaLogoUrl;
    document.body.append(finaleOverlay);
    return finaleOverlay;
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
    if (finaleTimer) clearTimeout(finaleTimer);
    overlay.classList.remove('run', 'reveal', 'active');
    // Reinicia la animación para que pueda reproducirse de nuevo sin recargar la página.
    void overlay.offsetWidth;
    overlay.classList.add('active', 'run');
    finaleTimer = setTimeout(() => {
      overlay.classList.add('reveal');
      beep(1046, 0.28, 'triangle', 0.045);
    }, 1450);
  }

  function hideFinale() {
    if (finaleTimer) clearTimeout(finaleTimer);
    if (finaleOverlay) finaleOverlay.classList.remove('active', 'run', 'reveal');
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
    gameUI.setStatus(`¡CORRE! ${params.timePerLetter} S POR LETRA`);
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
      gameUI.setSoundEnabled(soundEnabled);
      if (soundEnabled) beep(620, 0.07, 'triangle', 0.035);
    }
    if (event.code === 'Escape' && started && !ended) {
      started = false;
      gameUI.showIntro();
      gameUI.setStatus('ESCAPA');
      simulation.reset();
    }
  });

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const halfHeight = 6;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  });

  renderer.setAnimationLoop(time => {
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.035) : 0.016;
    lastTime = time;
    if (started && !ended) simulation.update(dt);
    simulation.animateDecor(time, dt);
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