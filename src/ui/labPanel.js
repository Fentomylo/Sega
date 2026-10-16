// Interfaz arcade minimalista: la pantalla inicial solo muestra PRESS START.
export function createLabPanel({ onToggleSound }) {
  const intro = document.createElement('div');
  intro.className = 'press-screen';
  intro.innerHTML = '<div class="press-start">PRESS START</div>';
  document.body.append(intro);

  // Filtro retro (líneas de barrido, viñeta y leve parpadeo) sobre toda la experiencia.
  const crt = document.createElement('div');
  crt.className = 'crt';
  crt.setAttribute('aria-hidden', 'true');
  document.body.append(crt);

  // Líneas de velocidad: se intensifican cuando el taxi va cerca de su velocidad máxima.
  const speedLines = document.createElement('div');
  speedLines.className = 'speed-lines';
  document.body.append(speedLines);

  // Cronómetro grande y central, estilo arcade.
  const timer = document.createElement('div');
  timer.className = 'timer hud-hidden';
  timer.innerHTML = `
    <div class="timer-label">TIEMPO</div>
    <div class="timer-value" id="timer-value">10.0</div>
    <div class="timer-bar"><span id="timer-fill"></span></div>
  `;
  document.body.append(timer);

  const hud = document.createElement('aside');
  hud.className = 'hud hud-hidden';
  hud.innerHTML = `
    <div class="hud-level"><span id="letter-name">LETRA S</span><span id="letter-index">01 / 04</span></div>
    <div class="word" id="word" aria-label="Progreso de la palabra SEGA"><span>S</span><span>E</span><span>G</span><span>A</span></div>
    <div class="ring-line"><span>ANILLOS</span><strong id="ring-count">0 / 3</strong></div>
    <div class="ring-line"><span>PINTADO</span><strong id="paint-value">0% / 0%</strong></div>
    <div class="ring-line"><span>VELOCIDAD</span><strong id="speed-value">0 KM/H</strong></div>
    <div class="hud-status" id="status">ESCAPA</div>
    <div class="hud-help">WASD / FLECHAS · SPACE: DERRAPE · M: SONIDO</div>
    <button class="sound-button" id="sound-toggle" type="button">SONIDO: ON</button>
  `;
  document.body.append(hud);

  const end = document.createElement('div');
  end.className = 'end-screen';
  end.innerHTML = `
    <div class="end-card">
      <div class="end-title" id="end-title">FIN DE LA PARTIDA</div>
      <p id="end-copy">Inténtalo otra vez.</p>
      <div class="press-start end-restart">PRESS SPACE TO RETRY</div>
    </div>
  `;
  document.body.append(end);

  let soundEnabled = true;
  hud.querySelector('#sound-toggle').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    setSoundButton();
    onToggleSound?.(soundEnabled);
  });

  function setSoundButton() {
    const button = hud.querySelector('#sound-toggle');
    button.textContent = `SONIDO: ${soundEnabled ? 'ON' : 'OFF'}`;
    button.setAttribute('aria-pressed', String(soundEnabled));
  }

  return {
    showIntro() {
      intro.classList.remove('press-hidden');
      hud.classList.add('hud-hidden');
      timer.classList.add('hud-hidden');
      speedLines.style.opacity = '0';
      end.classList.remove('visible');
    },
    hideIntro() {
      intro.classList.add('press-hidden');
      hud.classList.remove('hud-hidden');
      timer.classList.remove('hud-hidden');
    },
    hideEnd() { end.classList.remove('visible'); },
    showEnd(won, title, copy) {
      end.classList.add('visible');
      speedLines.style.opacity = '0';
      end.querySelector('#end-title').textContent = title || (won ? 'YOU ESCAPED' : 'TRY AGAIN');
      end.querySelector('#end-copy').textContent = copy || (won
        ? 'La ruta está completa.'
        : 'Pulsa espacio para volver a empezar.');
      end.querySelector('.end-restart').textContent = 'PRESS SPACE TO RETRY';
    },
    // Actualiza el cronómetro: texto, barra y estado de alerta en los últimos segundos.
    setTime(seconds, total, warningTime = 3) {
      const safe = Math.max(0, seconds);
      timer.querySelector('#timer-value').textContent = safe.toFixed(1);
      timer.querySelector('#timer-fill').style.width = `${Math.min(100, (safe / total) * 100)}%`;
      timer.classList.toggle('danger', safe <= warningTime);
    },
    // fraction: 0..1 de la velocidad máxima; display: valor mostrado en el HUD.
    setSpeed(fraction, display) {
      hud.querySelector('#speed-value').textContent = `${Math.round(display)} KM/H`;
      const intensity = Math.max(0, (fraction - 0.45) / 0.55);
      speedLines.style.opacity = String(Math.min(0.55, intensity * 0.55));
    },
    setLetter(name, index, total) {
      hud.querySelector('#letter-name').textContent = `LETRA ${name}`;
      hud.querySelector('#letter-index').textContent = `${String(index).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
      // La palabra se va "encendiendo" a medida que completas letras.
      hud.querySelectorAll('#word span').forEach((letter, i) => {
        letter.classList.toggle('done', i < index - 1);
        letter.classList.toggle('active', i === index - 1);
      });
    },
    // fraction: parte de la letra pintada (0..1); required: la que hace falta para abrir la salida.
    setPaint(fraction, required) {
      const value = hud.querySelector('#paint-value');
      value.textContent = `${Math.round(fraction * 100)}% / ${Math.round(required * 100)}%`;
      value.style.color = fraction >= required ? '#55ff9b' : '';
    },
    setCount(n, total) { hud.querySelector('#ring-count').textContent = `${n} / ${total}`; },
    setStatus(text) { hud.querySelector('#status').textContent = text; },
    setSoundEnabled(enabled) { soundEnabled = enabled; setSoundButton(); },
    isSoundEnabled() { return soundEnabled; }
  };
}

//