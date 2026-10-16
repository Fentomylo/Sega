import * as THREE from 'three/webgpu';

/*
 * Experiencia tipográfica jugable
 * - Solo se muestra una letra a la vez.
 * - Los PNG originales del usuario definen la forma real de cada letra.
 * - El taxi solo circula por el azul; los trazos blancos son obstáculos.
 * - La estela blanca la crea el taxi en tiempo real.
 * - Tres anillos desbloquean la salida de cada letra.
 */
export async function createSimulation({ scene, params, onEvent = () => {} }) {
  const loader = new THREE.TextureLoader();
  const world = new THREE.Group();
  scene.add(world);

  const materials = {
    taxi: new THREE.MeshStandardMaterial({ color: '#ffd32b', roughness: 0.5 }),
    taxiCabin: new THREE.MeshStandardMaterial({ color: '#17202a', roughness: 0.6 }),
    tire: new THREE.MeshStandardMaterial({ color: '#101116', roughness: 0.9 }),
    ring: new THREE.MeshBasicMaterial({ color: '#ffd447' }),
    exit: new THREE.MeshBasicMaterial({ color: '#55ff9b' }),
    trail: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    trailGlow: new THREE.MeshBasicMaterial({ color: '#74baff', transparent: true, opacity: 0.27 }),
    sparkWhite: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    sparkYellow: new THREE.MeshBasicMaterial({ color: '#ffdf56' })
  };

  // Rutas estáticas para que Vite incluya los PNG que están dentro de src/.
  const definitions = [
    {
      name: 'S',
      blueURL: new URL('../letras azules/S_azul.png', import.meta.url).href,
      whiteURL: new URL('../letras blancas/S_blanco.png', import.meta.url).href,
      entryUV: [0.13, 0.78], exitUV: [0.84, 0.22],
      ringsUV: [[0.28, 0.22], [0.76, 0.49], [0.30, 0.81]]
    },
    {
      name: 'E',
      blueURL: new URL('../letras azules/E_azul.png', import.meta.url).href,
      whiteURL: new URL('../letras blancas/E_blanco.png', import.meta.url).href,
      entryUV: [0.12, 0.52], exitUV: [0.85, 0.21],
      ringsUV: [[0.24, 0.22], [0.70, 0.49], [0.27, 0.80]],
      // Portal interior: desde la rama central hacia la rama inferior.
      // La salida normal de la E queda separada, en la rama superior, para pasar a la G.
      portalEntryUV: [0.72, 0.49], portalExitUV: [0.83, 0.80]
    },
    {
      name: 'G',
      blueURL: new URL('../letras azules/G_azul.png', import.meta.url).href,
      whiteURL: new URL('../letras blancas/G_blanco.png', import.meta.url).href,
      // La entrada a la G aparece en la zona verde marcada por el usuario,
      // junto al tramo vertical interior. La salida hacia la A queda arriba a la derecha (rojo).
      entryUV: [0.51, 0.56], exitUV: [0.85, 0.17],
      ringsUV: [[0.30, 0.20], [0.77, 0.48], [0.32, 0.80]]
    },
    {
      name: 'A',
      blueURL: new URL('../letras azules/A_azul.png', import.meta.url).href,
      whiteURL: new URL('../letras blancas/A_blanco.png', import.meta.url).href,
      // La A comienza abajo a la izquierda: el taxi entra mirando hacia arriba
      // y recorre la silueta hasta la salida inferior central marcada por el usuario.
      entryUV: [0.20, 0.91], entryHeading: 1.18,
      exitUV: [0.49, 0.87],
      ringsUV: [[0.50, 0.24], [0.31, 0.68], [0.70, 0.68]]
    }
  ];

  function imageToCanvas(image, kind) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = frame.data;
    const alpha = new Uint8Array(canvas.width * canvas.height);

    // Asegura que *_azul.png contribuya solo el relleno azul y
    // *_blanco.png solo los muros blancos, aunque el PNG tenga píxeles residuales.
    for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      let keep = false;
      if (kind === 'blue') {
        keep = a > 12 && b > r * 1.30 && b > g * 1.18 && b - g > 35;
      } else {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        keep = a > 12 && min > 155 && max - min < 85;
      }
      if (!keep) data[i + 3] = 0;
      alpha[p] = data[i + 3];
    }

    ctx.putImageData(frame, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    return { canvas, alpha, width: canvas.width, height: canvas.height, texture };
  }

  async function loadLayer(url, kind) {
    const texture = await loader.loadAsync(url);
    const image = texture.image;
    texture.dispose();
    return imageToCanvas(image, kind);
  }

  // Carga primero las imágenes reales; no se dibuja ninguna letra con fuentes por defecto.
  const loaded = await Promise.all(definitions.map(async def => {
    const [blue, white] = await Promise.all([
      loadLayer(def.blueURL, 'blue'),
      loadLayer(def.whiteURL, 'white')
    ]);
    return { ...def, blue, white };
  }));

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 60),
    new THREE.MeshBasicMaterial({ color: '#030509' })
  );
  floor.position.z = -1.0;
  world.add(floor);

  const trailGroup = new THREE.Group();
  world.add(trailGroup);
  const sparks = [];

  const taxi = makeCar();
  world.add(taxi);
  taxi.visible = false;

  const stages = loaded.map((def, index) => buildStage(def, index));
  stages.forEach((stage, index) => {
    stage.root.visible = index === 0;
    world.add(stage.root);
  });

  let currentIndex = 0;
  let ringsCollected = 0;
  let intro = true;
  let won = false;
  let portalCooldownTaxi = 0;
  let transition = null;
  let lastCrashTime = -Infinity;
  let lastTrailPoint = null;
  // Contrarreloj: cada letra tiene su propio tiempo; el total sirve para el marcador final.
  let timeLeft = params.timePerLetter;
  let totalTime = 0;
  let timedOut = false;
  const keys = new Set();
  const taxiPosition = new THREE.Vector2();
  const scratch = new THREE.Vector2();

  const activeStage = () => stages[currentIndex];

  function makeCar() {
    const car = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.66, 0.37, 0.13),
      materials.taxi
    );
    body.position.z = 0.31;
    car.add(body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(0.31, 0.27, 0.09),
      materials.taxiCabin
    );
    cabin.position.set(-0.02, 0, 0.405);
    car.add(cabin);

    for (const x of [-0.20, 0.20]) {
      for (const y of [-0.205, 0.205]) {
        const wheel = new THREE.Mesh(
          new THREE.BoxGeometry(0.15, 0.075, 0.075),
          materials.tire
        );
        wheel.position.set(x, y, 0.27);
        car.add(wheel);
      }
    }

    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.12, 0.04),
      materials.taxiCabin
    );
    sign.position.set(-0.04, 0, 0.47);
    car.add(sign);

    car.userData.velocity = new THREE.Vector2();
    car.userData.heading = 0;
    return car;
  }

  function buildStage(def, index) {
    const root = new THREE.Group();
    const mapGroup = new THREE.Group();
    root.add(mapGroup);

    const imageHeight = 9.4;
    const aspect = def.blue.width / def.blue.height;
    const imageWidth = imageHeight * aspect;
    const geometry = new THREE.PlaneGeometry(imageWidth, imageHeight);

    // Muros detrás y relleno azul delante: conservan exactamente la silueta de los PNG.
    const whiteMaterial = new THREE.MeshBasicMaterial({
      map: def.white.texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const blueMaterial = new THREE.MeshBasicMaterial({
      map: def.blue.texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const whiteMesh = new THREE.Mesh(geometry, whiteMaterial);
    whiteMesh.position.z = 0.00;
    const blueMesh = new THREE.Mesh(geometry, blueMaterial);
    blueMesh.position.z = 0.025;
    mapGroup.add(whiteMesh, blueMesh);

    const stage = {
      ...def,
      index,
      root,
      mapGroup,
      imageWidth,
      imageHeight,
      rings: [],
      ringCount: 0,
      entry: new THREE.Vector2(),
      exit: new THREE.Vector2(),
      exitMesh: null,
      portalEntry: null,
      portalExit: null,
      portalMeshes: [],
      validPoints: []
    };

    // Candidatos de navegación calculados a partir de píxeles azules reales.
    // El centro del carro no puede estar en blanco ni fuera de la letra.
    const stride = 2;
    for (let py = 3; py < def.blue.height - 3; py += stride) {
      for (let px = 3; px < def.blue.width - 3; px += stride) {
        const pi = py * def.blue.width + px;
        if (def.blue.alpha[pi] < 90 || def.white.alpha[pi] > 65) continue;
        const x = (px / (def.blue.width - 1) - 0.5) * imageWidth;
        const y = (0.5 - py / (def.blue.height - 1)) * imageHeight;
        const p = new THREE.Vector2(x, y);
        if (isSafeLocal(stage, p, 0)) stage.validPoints.push(p);
      }
    }

    if (stage.validPoints.length < 10) {
      throw new Error(`No se detectó suficiente superficie azul en ${def.name}. Revisa ${def.name}_azul.png y ${def.name}_blanco.png.`);
    }

    stage.entry.copy(nearestPoint(stage, def.entryUV, [], 0));
    stage.exit.copy(nearestPoint(stage, def.exitUV, [stage.entry], 1.0));

    // Tres anillos por letra, colocados sobre superficie transitable.
    for (let i = 0; i < params.ringsPerLetter; i++) {
      const desired = def.ringsUV[i] || [0.5, 0.5];
      const avoid = [stage.entry, stage.exit, ...stage.rings.map(r => r.position)];
      const point = nearestPoint(stage, desired, avoid, 1.15);
      const ringMaterial = materials.ring.clone();
      const ringMesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.20, 0.055, 9, 24),
        ringMaterial
      );
      ringMesh.position.set(point.x, point.y, 0.16);
      root.add(ringMesh);
      stage.rings.push({ position: point, mesh: ringMesh, active: true, offset: i * 1.7 });
    }

    const exitMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.065, 10, 28),
      materials.exit
    );
    exitMesh.position.set(stage.exit.x, stage.exit.y, 0.17);
    exitMesh.visible = false;
    root.add(exitMesh);
    stage.exitMesh = exitMesh;

    // Portal interno de la E: brazo superior derecho -> brazo inferior derecho.
    // No sustituye los anillos ni la salida que lleva a la siguiente letra.
    if (def.name === 'E') {
      stage.portalEntry = nearestPoint(stage, def.portalEntryUV || [0.83, 0.21], [stage.entry, stage.exit], 0.45);
      stage.portalExit = nearestPoint(stage, def.portalExitUV || [0.83, 0.80], [stage.entry, stage.exit, stage.portalEntry], 0.45);
      for (const point of [stage.portalEntry, stage.portalExit]) {
        const portal = new THREE.Group();
        const glow = new THREE.Mesh(new THREE.CircleGeometry(0.37, 28), materials.trailGlow);
        glow.material = materials.trailGlow.clone();
        glow.material.color.set('#35e9ff');
        glow.material.opacity = 0.38;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.065, 10, 28), materials.exit);
        portal.add(glow, ring);
        portal.position.set(point.x, point.y, 0.18);
        root.add(portal);
        stage.portalMeshes.push(portal);
      }
    }

    return stage;
  }

  function nearestPoint(stage, uv, avoid = [], minDistance = 0) {
    const targetX = (uv[0] - 0.5) * stage.imageWidth;
    const targetY = (0.5 - uv[1]) * stage.imageHeight;
    let best = null;
    let bestDistance = Infinity;

    for (const point of stage.validPoints) {
      if (avoid.some(other => point.distanceTo(other) < minDistance)) continue;
      const d = (point.x - targetX) ** 2 + (point.y - targetY) ** 2;
      if (d < bestDistance) {
        best = point;
        bestDistance = d;
      }
    }

    if (!best) {
      for (const point of stage.validPoints) {
        const d = (point.x - targetX) ** 2 + (point.y - targetY) ** 2;
        if (d < bestDistance) { best = point; bestDistance = d; }
      }
    }
    return best ? best.clone() : new THREE.Vector2(0, 0);
  }

  function isDriveableLocal(stage, point) {
    const u = point.x / stage.imageWidth + 0.5;
    const v = 0.5 - point.y / stage.imageHeight;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
    const px = Math.min(stage.blue.width - 1, Math.max(0, Math.floor(u * stage.blue.width)));
    const py = Math.min(stage.blue.height - 1, Math.max(0, Math.floor(v * stage.blue.height)));
    const idx = py * stage.blue.width + px;
    return stage.blue.alpha[idx] > 65 && stage.white.alpha[idx] < 95;
  }

  function isSafeLocal(stage, point, heading) {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const offsets = [
      [0, 0], [0.20, 0], [-0.20, 0], [0, 0.115], [0, -0.115],
      [0.15, 0.09], [0.15, -0.09], [-0.15, 0.09], [-0.15, -0.09]
    ];
    return offsets.every(([ox, oy]) => {
      const p = new THREE.Vector2(point.x + ox * c - oy * s, point.y + ox * s + oy * c);
      return isDriveableLocal(stage, p);
    });
  }

  function canDriveWorld(stage, worldPoint, heading) {
    const local = new THREE.Vector2(worldPoint.x - stage.root.position.x, worldPoint.y);
    return isSafeLocal(stage, local, heading);
  }

  function setCarPosition(car, position, heading) {
    car.position.set(position.x, position.y, 0);
    car.rotation.z = heading;
    car.userData.heading = heading;
    car.userData.velocity.set(0, 0);
  }

  function clearTrail() {
    while (trailGroup.children.length) {
      const object = trailGroup.children[trailGroup.children.length - 1];
      trailGroup.remove(object);
      if (object.geometry) object.geometry.dispose();
      // Shared materials are disposed only when the simulation is disposed.
    }
    lastTrailPoint = null;
  }

  function addTrailSegment(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.015) return;

    const angle = Math.atan2(dy, dx);
    const midpointX = (from.x + to.x) * 0.5;
    const midpointY = (from.y + to.y) * 0.5;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(distance + 0.08, 0.16), materials.trailGlow);
    glow.position.set(midpointX, midpointY, 0.19);
    glow.rotation.z = angle;
    trailGroup.add(glow);
    const core = new THREE.Mesh(new THREE.PlaneGeometry(distance + 0.035, 0.065), materials.trail);
    core.position.set(midpointX, midpointY, 0.205);
    core.rotation.z = angle;
    trailGroup.add(core);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.033, 10), materials.trail);
    cap.position.set(to.x, to.y, 0.21);
    trailGroup.add(cap);
  }

  function spawnSparks(position) {
    const geometry = new THREE.CircleGeometry(0.045, 6);
    for (let i = 0; i < 9; i++) {
      const material = (i % 2 ? materials.sparkWhite : materials.sparkYellow).clone();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(position.x, position.y, 0.48);
      world.add(mesh);
      const angle = (Math.PI * 2 * i / 9) + Math.random() * 0.3;
      sparks.push({ mesh, material, velocity: new THREE.Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(1.2 + Math.random() * 1.8), life: 0.32 + Math.random() * 0.12 });
    }
  }

  function collide(point) {
    const now = performance.now() / 1000;
    if (now - lastCrashTime < params.crashCooldown) return;
    lastCrashTime = now;
    // El rebote de la velocidad se hace en update(); aquí no se toca la orientación del taxi.
    // Consecuencia real del choque: pierdes tiempo (el siguiente frame detecta si llega a 0).
    timeLeft = Math.max(0, timeLeft - params.crashTimePenalty);
    spawnSparks(point);
    onEvent('crash', params.crashTimePenalty);
  }

  function onKeyDown(event) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) keys.add(event.code);
  }
  function onKeyUp(event) { keys.delete(event.code); }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function placeTaxiOnCurrentLetter() {
    const stage = activeStage();
    taxiPosition.copy(stage.entry);
    setCarPosition(taxi, taxiPosition, stage.entryHeading ?? 0);
    taxi.visible = true;
    clearTrail();
    timeLeft = params.timePerLetter;
    onEvent('tick', timeLeft, 0);
  }

  function start() {
    intro = false;
    won = false;
    timedOut = false;
    totalTime = 0;
    portalCooldownTaxi = 0;
    if (activeStage().root.position.x !== 0) activeStage().root.position.x = 0;
    activeStage().root.visible = true;
    placeTaxiOnCurrentLetter();
    onEvent('start', activeStage().name);
  }

  function reset() {
    currentIndex = 0;
    ringsCollected = 0;
    intro = true;
    won = false;
    timedOut = false;
    timeLeft = params.timePerLetter;
    totalTime = 0;
    portalCooldownTaxi = 0;
    transition = null;
    stages.forEach((stage, i) => {
      stage.root.position.x = 0;
      stage.root.visible = i === 0;
      stage.ringCount = 0;
      stage.rings.forEach(ring => { ring.active = true; ring.mesh.visible = true; });
      stage.exitMesh.visible = false;
      stage.exitMesh.scale.setScalar(1);
      stage.portalUsed = false;
    });
    taxi.visible = false;
    setCarPosition(taxi, new THREE.Vector2(), 0);
    clearTrail();
    onEvent('reset', 'S');
  }

  function beginTransition() {
    if (transition || ringsCollected < params.ringsPerLetter) return;
    if (currentIndex === stages.length - 1) {
      won = true;
      onEvent('logoReveal');
      onEvent('win', totalTime);
      return;
    }
    const nextIndex = currentIndex + 1;
    const from = activeStage();
    const to = stages[nextIndex];
    to.root.visible = true;
    to.root.position.x = 15.5;
    from.root.position.x = 0;
    taxi.visible = false;
    clearTrail();
    transition = { from, to, nextIndex, elapsed: 0, duration: params.transitionDuration };
    onEvent('transitionStart', to.name);
  }

  function finishTransition() {
    const t = transition;
    t.from.root.visible = false;
    t.from.root.position.x = 0;
    t.to.root.position.x = 0;
    currentIndex = t.nextIndex;
    ringsCollected = 0;
    activeStage().ringCount = 0;
    transition = null;
    placeTaxiOnCurrentLetter();
    onEvent('newLetter', activeStage().name, currentIndex + 1, stages.length);
  }

  function moveTaxiWithWallSlide(stage, delta, heading) {
    // Subpasos evitan atravesar píxeles finos; el deslizamiento lateral evita quedarse pegado al borde.
    const distance = delta.length();
    const steps = Math.max(1, Math.ceil(distance / 0.045));
    const step = delta.clone().multiplyScalar(1 / steps);
    let moved = false;
    for (let i = 0; i < steps; i++) {
      const next = taxiPosition.clone().add(step);
      if (canDriveWorld(stage, next, heading)) {
        taxiPosition.copy(next);
        moved = true;
        continue;
      }
      const xOnly = taxiPosition.clone().add(new THREE.Vector2(step.x, 0));
      const yOnly = taxiPosition.clone().add(new THREE.Vector2(0, step.y));
      const canX = canDriveWorld(stage, xOnly, heading);
      const canY = canDriveWorld(stage, yOnly, heading);
      if (canX && (!canY || Math.abs(step.x) >= Math.abs(step.y))) { taxiPosition.copy(xOnly); moved = true; }
      else if (canY) { taxiPosition.copy(yOnly); moved = true; }
      else return { moved, hitWall: true };
    }
    return { moved, hitWall: false };
  }

  function teleportThroughEPortal() {
    const stage = activeStage();
    if (stage.name !== 'E' || !stage.portalEntry || !stage.portalExit) return false;
    if (portalCooldownTaxi > 0 || taxiPosition.distanceTo(stage.portalEntry) > 0.31) return false;

    // Portal interior: transporta el taxi desde la rama central a la rama inferior.
    // Aparece justo dentro de la zona azul del portal de salida, orientado hacia la izquierda
    // para que pueda recorrer la rama inferior y volver por el circuito hasta la salida superior.
    const destination = stage.portalExit.clone();

    taxiPosition.copy(destination);
    taxi.position.x = taxiPosition.x;
    taxi.position.y = taxiPosition.y;
    taxi.userData.heading = Math.PI;
    taxi.rotation.z = Math.PI;
    const speed = Math.max(2.2, taxi.userData.velocity.length());
    taxi.userData.velocity.set(-speed, 0);
    portalCooldownTaxi = 1.25;
    lastTrailPoint = taxiPosition.clone();
    onEvent('portal', 'taxi');
    return true;
  }

  function update(dt) {
    if (intro || won || timedOut) return;

    if (transition) {
      transition.elapsed += dt;
      const raw = Math.min(1, transition.elapsed / transition.duration);
      const eased = raw * raw * (3 - 2 * raw);
      transition.from.root.position.x = -15.5 * eased;
      transition.to.root.position.x = 15.5 * (1 - eased);
      if (raw >= 1) finishTransition();
      return;
    }

    const stage = activeStage();

    // El reloj corre solo mientras se conduce (no durante la transición entre letras).
    timeLeft -= dt;
    totalTime += dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      timedOut = true;
      taxi.userData.velocity.set(0, 0);
      onEvent('tick', 0, 0);
      onEvent('timeout', stage.name);
      return;
    }

    portalCooldownTaxi = Math.max(0, portalCooldownTaxi - dt);
    const velocity = taxi.userData.velocity;
    const forward = (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0);
    const steer = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
    const speed = velocity.length();

    // Derecha gira hacia abajo en pantalla; izquierda hacia arriba.
    const drifting = keys.has('Space') && speed > (params.driftMinSpeed || 1.0);
    const turnBoost = drifting ? (params.driftTurnBoost || 1.35) : 1;
    taxi.userData.heading -= steer * params.turnSpeed * turnBoost * dt * (0.25 + Math.min(speed / params.maxSpeed, 1));
    const heading = taxi.userData.heading;
    taxi.rotation.z = heading;
    const forwardDir = new THREE.Vector2(Math.cos(heading), Math.sin(heading));
    velocity.addScaledVector(forwardDir, forward * params.acceleration * dt);
    velocity.multiplyScalar(Math.pow(params.friction, dt * 60));
    // En derrape se conserva más velocidad lateral para dibujar curvas amplias.
    if (drifting && speed > 0.01) {
      const lateral = new THREE.Vector2(-forwardDir.y, forwardDir.x);
      const lateralSpeed = velocity.dot(lateral);
      velocity.addScaledVector(lateral, lateralSpeed * ((params.driftLateralGrip || 0.95) - 0.76));
    }
    if (velocity.length() > params.maxSpeed) velocity.setLength(params.maxSpeed);

    const delta = velocity.clone().multiplyScalar(dt);
    const movedResult = moveTaxiWithWallSlide(stage, delta, heading);
    taxi.position.x = taxiPosition.x;
    taxi.position.y = taxiPosition.y;
    if (movedResult.hitWall) {
      // Rebote: el taxi sale despedido hacia atrás, pero SIN girar. Conserva su
      // orientación, así que al chocar de frente puede volver a acelerar hacia delante.
      const impact = taxiPosition.clone().add(delta);
      const incoming = velocity.clone();
      const impactSpeed = incoming.length();
      if (impactSpeed > 0.08) {
        const bounceDir = incoming.clone().normalize().multiplyScalar(-1);

        // Separar el coche del borde (con su misma orientación) para que no quede pegado.
        let escaped = false;
        for (let push = 0.045; push <= 0.54; push += 0.045) {
          const candidate = taxiPosition.clone().addScaledVector(bounceDir, push);
          if (canDriveWorld(stage, candidate, heading)) {
            taxiPosition.copy(candidate);
            escaped = true;
            break;
          }
        }

        // Rebote suave: lo justo para despegar de la pared sin mandar al taxi lejos.
        velocity.copy(bounceDir).multiplyScalar(Math.max(impactSpeed * 0.4, 1.0));
        if (!escaped) velocity.multiplyScalar(1.12);
      } else {
        velocity.set(0, 0);
      }
      taxi.position.x = taxiPosition.x;
      taxi.position.y = taxiPosition.y;
      collide(impact);
      lastTrailPoint = taxiPosition.clone();
    } else if (movedResult.moved) {
      if (!lastTrailPoint) lastTrailPoint = taxiPosition.clone();
      if (lastTrailPoint.distanceTo(taxiPosition) >= 0.055) {
        addTrailSegment(lastTrailPoint, taxiPosition);
        lastTrailPoint.copy(taxiPosition);
      }
    }

    teleportThroughEPortal();
    onEvent('tick', timeLeft, taxi.userData.velocity.length());

    // Recoger tres anillos para abrir la salida de esta letra.
    for (const ring of stage.rings) {
      if (!ring.active || taxiPosition.distanceTo(ring.position) > 0.38) continue;
      ring.active = false;
      ring.mesh.visible = false;
      ringsCollected++;
      stage.ringCount = ringsCollected;
      // Cada anillo devuelve un poco de tiempo, sin superar el máximo por letra.
      timeLeft = Math.min(params.timePerLetter, timeLeft + params.ringTimeBonus);
      onEvent('pickup', ringsCollected, params.ringsPerLetter, stage.name);
      if (ringsCollected === params.ringsPerLetter) {
        stage.exitMesh.visible = true;
        onEvent('exitOpen', stage.name);
      }
    }

    if (ringsCollected >= params.ringsPerLetter && taxiPosition.distanceTo(stage.exit) < 0.48) {
      beginTransition();
    }
  }

  function animateDecor(time, dt = 1 / 60) {
    const stage = activeStage();
    for (const ring of stage.rings) {
      if (!ring.active) continue;
      ring.mesh.rotation.z = time * 0.0015 + ring.offset;
      ring.mesh.scale.setScalar(1 + Math.sin(time * 0.005 + ring.offset) * 0.08);
    }
    if (stage.exitMesh.visible) {
      stage.exitMesh.rotation.z = -time * 0.0018;
      stage.exitMesh.scale.setScalar(1 + Math.sin(time * 0.006) * 0.1);
    }
    for (const portal of stage.portalMeshes || []) {
      portal.rotation.z = time * 0.0018;
      portal.scale.setScalar(1 + Math.sin(time * 0.006) * 0.06);
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i];
      spark.life -= dt;
      spark.mesh.position.x += spark.velocity.x * dt;
      spark.mesh.position.y += spark.velocity.y * dt;
      spark.velocity.multiplyScalar(0.92);
      spark.mesh.scale.multiplyScalar(0.96);
      if (spark.life <= 0) {
        world.remove(spark.mesh);
        spark.mesh.geometry.dispose();
        spark.material.dispose();
        sparks.splice(i, 1);
      }
    }

  }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    scene.remove(world);
    world.traverse(object => {
      if (object.geometry) object.geometry.dispose();
      if (object.material && !Array.isArray(object.material)) object.material.dispose();
    });
    loaded.forEach(def => { def.blue.texture.dispose(); def.white.texture.dispose(); });
  }

  // API consumida por main.js.
  return {
    update,
    animateDecor,
    start,
    reset,
    dispose,
    getState: () => ({
      currentLetter: activeStage().name,
      currentIndex,
      total: stages.length,
      collected: ringsCollected,
      timeLeft,
      totalTime,
      timedOut,
      ringsRequired: params.ringsPerLetter,
      won,
      intro,
      transitioning: Boolean(transition)
    })
  };
}