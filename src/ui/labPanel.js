// Interfaz arcade minimalista: la pantalla inicial solo muestra PRESS START.
export function createLabPanel({ onToggleSound }) {
  const intro = document.createElement('div');
  intro.className = 'press-screen';
  intro.innerHTML = '<div class="press-start">PRESS START</div>';
  document.body.append(intro);

  const hud = document.createElement('aside');
  hud.className = 'hud hud-hidden';
  hud.innerHTML = `
    <div class="hud-level"><span id="letter-name">LETRA S</span><span id="letter-index">01 / 04</span></div>
    <div class="ring-line"><span>ANILLOS</span><strong id="ring-count">0 / 3</strong></div>
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
    showIntro() { intro.classList.remove('press-hidden'); hud.classList.add('hud-hidden'); end.classList.remove('visible'); },
    hideIntro() { intro.classList.add('press-hidden'); hud.classList.remove('hud-hidden'); },
    hideEnd() { end.classList.remove('visible'); },
    showEnd(won) {
      end.classList.add('visible');
      end.querySelector('#end-title').textContent = won ? 'YOU ESCAPED' : 'TRY AGAIN';
      end.querySelector('#end-copy').textContent = won
        ? 'La ruta está completa.'
        : 'Pulsa espacio para volver a empezar.';
      end.querySelector('.end-restart').textContent = 'PRESS SPACE TO RETRY';
    },
    setLetter(name, index, total) {
      hud.querySelector('#letter-name').textContent = `LETRA ${name}`;
      hud.querySelector('#letter-index').textContent = `${String(index).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    },
    setCount(n, total) { hud.querySelector('#ring-count').textContent = `${n} / ${total}`; },
    setStatus(text) { hud.querySelector('#status').textContent = text; },
    setSoundEnabled(enabled) { soundEnabled = enabled; setSoundButton(); },
    isSoundEnabled() { return soundEnabled; }
  };
}
