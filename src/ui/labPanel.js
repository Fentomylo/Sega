// Interfaz del juego. Conservamos el nombre del módulo para encajar con el repositorio original.
export function createLabPanel({ onStart, onReset, onToggleSound }) {
  const panel = document.createElement('section');
  panel.className = 'game-ui';
  panel.innerHTML = `
    <div class="brand">SEGA<span> TAXI</span></div>
    <p class="eyebrow">TYPOGRAPHIC PURSUIT</p>
    <h1>ESCAPA DEL LOGO</h1>
    <p class="intro-copy">Las letras son tu mapa. Recoge los tres anillos y evita que la policía te alcance.</p>
    <div class="controls"><span>WASD / FLECHAS</span><span>CONDUCIR</span></div>
    <button class="primary" id="start-game">COMENZAR PERSECUCIÓN ↗</button>
    <button class="secondary" id="sound-toggle">SONIDO: ACTIVADO</button>
    <p class="small">Proyecto experimental de tipografía jugable</p>
  `;
  document.body.append(panel);
  panel.querySelector('#start-game').addEventListener('click', onStart);
  panel.querySelector('#sound-toggle').addEventListener('click', (e) => {
    const button = e.currentTarget;
    const enabled = button.dataset.enabled !== 'false';
    button.dataset.enabled = String(!enabled);
    button.textContent = `SONIDO: ${enabled ? 'DESACTIVADO' : 'ACTIVADO'}`;
    onToggleSound(!enabled);
  });

  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.innerHTML = `<div class="hud-brand">SEGA TAXI</div><div id="collect-count">ANILLOS <b>0 / 3</b></div><div id="status">PULSA ENTER PARA EMPEZAR</div><div class="hud-help">WASD / FLECHAS · R REINICIAR</div>`;
  document.body.append(hud);

  const overlay = document.createElement('div');
  overlay.className = 'message-overlay';
  overlay.innerHTML = `<div class="message-card"><p class="eyebrow">PERSECUCIÓN TERMINADA</p><h2 id="message-title">TE HAN ATRAPADO</h2><p id="message-copy">Inténtalo otra vez.</p><button id="retry">VOLVER A JUGAR</button></div>`;
  document.body.append(overlay);
  overlay.querySelector('#retry').addEventListener('click', onReset);

  return {
    element: panel,
    hideIntro() { panel.classList.add('is-hidden'); },
    showIntro() { panel.classList.remove('is-hidden'); },
    setCount(n,total) { hud.querySelector('#collect-count').innerHTML = `ANILLOS <b>${n} / ${total}</b>`; },
    setStatus(text) { hud.querySelector('#status').textContent = text; },
    showEnd(won) {
      overlay.classList.add('visible');
      overlay.querySelector('#message-title').textContent = won ? 'ESCAPASTE' : 'TE HAN ATRAPADO';
      overlay.querySelector('#message-copy').textContent = won ? 'Las letras vuelven a formar el logo. SEGA!' : 'La persecución terminó. Reintenta y usa los caminos tipográficos.';
    },
    hideEnd() { overlay.classList.remove('visible'); },
    setSoundLabel(enabled) {
      const b = panel.querySelector('#sound-toggle');
      b.dataset.enabled = String(enabled);
      b.textContent = `SONIDO: ${enabled ? 'ACTIVADO' : 'DESACTIVADO'}`;
    }
  };
}
