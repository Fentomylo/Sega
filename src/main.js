import * as THREE from 'three/webgpu';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import './styles.css';
import { createParameters } from './simulation/parameters.js';
import { createSimulation } from './simulation/createSimulation.js';
import { createLabPanel } from './ui/labPanel.js';

async function main() {
  const mount = document.querySelector('#app');
  if (!WebGPU.isAvailable()) {
    mount.appendChild(WebGPU.getErrorMessage());
    throw new Error('Este proyecto requiere un navegador compatible con WebGPU.');
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#050912');
  const camera = new THREE.OrthographicCamera(-10.5, 10.5, 7.2, -7.2, 0.1, 100);
  camera.position.set(0, 0, 25);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  mount.appendChild(renderer.domElement);
  await renderer.init();

  const ambient = new THREE.AmbientLight('#ffffff', 1.5);
  scene.add(ambient);
  const params = createParameters();
  const simulation = createSimulation({ scene, params, onEvent: handleEvent });
  let soundEnabled = true;
  let audioContext = null;
  let started = false;
  let endShown = false;
  let lastTime = 0;
  let lastSiren = 0;
  let gameUI;

  function beep(frequency = 440, duration = 0.12, type = 'sine', volume = 0.04) {
    if (!soundEnabled) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = type; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
    } catch {}
  }

  function handleEvent(type, value) {
    if (type === 'start') {
      started = true; endShown = false;
      gameUI.hideIntro(); gameUI.hideEnd();
      gameUI.setStatus('LA POLICÍA TE PERSIGUE');
      beep(660,0.1,'square'); setTimeout(() => beep(880,0.13,'square'),100);
    } else if (type === 'pickup') {
      gameUI.setCount(value, 3); gameUI.setStatus('LETRA ACTIVADA');
      beep(720,0.08,'triangle'); setTimeout(() => beep(960,0.15,'triangle'),80);
    } else if (type === 'crash') {
      gameUI.setStatus('¡CUIDADO CON LOS TRAZOS!');
      beep(120,0.18,'sawtooth',0.055);
    } else if (type === 'caught') {
      started = false; endShown = true; gameUI.showEnd(false); gameUI.setStatus('PERSECUCIÓN TERMINADA');
      beep(190,0.4,'sawtooth',0.06);
    } else if (type === 'win') {
      started = false; endShown = true; gameUI.showEnd(true); gameUI.setStatus('¡ESCAPASTE!');
      [523,659,784,1046].forEach((f,i) => setTimeout(() => beep(f,0.22,'triangle',0.045),i*130));
    } else if (type === 'reset') {
      started = true; endShown = false; gameUI.hideEnd(); gameUI.hideIntro(); gameUI.setCount(0,3); gameUI.setStatus('LA POLICÍA TE PERSIGUE');
    }
  }

  gameUI = createLabPanel({
    onStart: () => { if (!started) { simulation.reset(); handleEvent('start'); } },
    onReset: () => { simulation.reset(); handleEvent('reset'); },
    onToggleSound: (enabled) => { soundEnabled = enabled; if (enabled) beep(600,0.08,'triangle'); }
  });

  // Inicio mediante Enter y reinicio mediante R.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && !started && !endShown) {
      if (audioContext?.state === 'suspended') audioContext.resume();
      simulation.reset(); handleEvent('start');
    }
    if (e.code === 'KeyR' && endShown) { simulation.reset(); handleEvent('reset'); }
  });

  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    const aspect = innerWidth / innerHeight;
    const h = 7.2;
    camera.left = -h * aspect; camera.right = h * aspect;
    camera.top = h; camera.bottom = -h;
    camera.updateProjectionMatrix();
  });

  renderer.setAnimationLoop((time) => {
    const dt = lastTime ? Math.min((time-lastTime)/1000, 0.04) : 0.016;
    lastTime = time;
    if (started) simulation.update(dt);
    simulation.animateDecor(time);
    const state = simulation.getState();
    if (state.collected !== undefined) gameUI.setCount(state.collected,state.total);
    renderer.render(scene,camera);
  });
}
main().catch((error) => {
  console.error(error);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:16px;padding:16px;background:#180c13;color:#fff;white-space:pre-wrap;z-index:100';
  pre.textContent = `No se pudo iniciar SEGA TAXI.\n${error?.stack || error}`;
  document.body.append(pre);
});
