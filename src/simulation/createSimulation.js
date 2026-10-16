import * as THREE from 'three/webgpu';

/*
 * Experiencia tipográfica jugable
 * - Solo se muestra una letra a la vez.
 * - Los PNG originales del usuario definen la forma real de cada letra.
 * - El taxi solo circula por el azul; los trazos blancos son obstáculos.
 * - La estela blanca la crea el taxi en tiempo real.
 * - Tres anillos desbloquean la salida de cada letra.
 */
// Cola de prioridad mínima (para buscar la ruta real de cada letra).
class MinHeap {
  constructor() { this.keys = []; this.values = []; }
  get size() { return this.keys.length; }
  push(key, value) {
    const { keys, values } = this;
    let i = keys.length;
    keys.push(key); values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent]; values[i] = values[parent];
      i = parent;
    }
    keys[i] = key; values[i] = value;
  }
  pop() {
    const { keys, values } = this;
    const topKey = keys[0], topValue = values[0];
    const lastKey = keys.pop(), lastValue = values.pop();
    const n = keys.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        keys[i] = keys[c]; values[i] = values[c];
        i = c;
      }
      keys[i] = lastKey; values[i] = lastValue;
    }
    return [topKey, topValue];
  }
}

const NAV_STRIDE = 2;
const NAV_NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

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
  // Grabación del recorrido: la estela de la letra actual (trazos en coordenadas de mundo)
  // y los recorridos ya terminados de cada letra, normalizados 0..1 sobre el PNG.
  let recording = [[]];
  let recordedTrails = [];
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
    const stride = NAV_STRIDE;
    // Rejilla de navegación: cada punto válido es un nodo (su índice = índice en validPoints).
    stage.nav = { nodeAt: new Int32Array(def.blue.width * def.blue.height).fill(-1), px: [], py: [], clear: null };
    for (let py = 3; py < def.blue.height - 3; py += stride) {
      for (let px = 3; px < def.blue.width - 3; px += stride) {
        const pi = py * def.blue.width + px;
        if (def.blue.alpha[pi] < 90 || def.white.alpha[pi] > 65) continue;
        const x = (px / (def.blue.width - 1) - 0.5) * imageWidth;
        const y = (0.5 - py / (def.blue.height - 1)) * imageHeight;
        const p = new THREE.Vector2(x, y);
        if (isSafeLocal(stage, p, 0)) {
          stage.nav.nodeAt[pi] = stage.validPoints.length;
          stage.nav.px.push(px);
          stage.nav.py.push(py);
          stage.validPoints.push(p);
        }
      }
    }

    if (stage.validPoints.length < 10) {
      throw new Error(`No se detectó suficiente superficie azul en ${def.name}. Revisa ${def.name}_azul.png y ${def.name}_blanco.png.`);
    }

    stage.entry.copy(nearestPoint(stage, def.entryUV, [], 0));
    stage.exit.copy(nearestPoint(stage, def.exitUV, [stage.entry], 1.0));

    // Portal de la E (puntos): se calculan antes porque forman parte de la ruta de la letra.
    if (def.name === 'E') {
      stage.portalEntry = nearestPoint(stage, def.portalEntryUV || [0.83, 0.21], [stage.entry, stage.exit], 0.45);
      stage.portalExit = nearestPoint(stage, def.portalExitUV || [0.83, 0.80], [stage.entry, stage.exit, stage.portalEntry], 0.45);
    }

    // Ruta real de la letra (entrada -> salida) por el azul transitable, y anillos repartidos
    // a lo largo de ella (25 %, 50 %, 75 %). Si no hay ruta, se usan las posiciones a mano.
    computeClearance(stage);
    const route = planRoute(stage);
    stage.route = route;
    const ringPoints = [];
    const avoidRing = [stage.entry, stage.exit, stage.portalEntry, stage.portalExit].filter(Boolean);
    for (let i = 0; i < params.ringsPerLetter; i++) {
      let point = null;
      if (route) {
        const base = (i + 1) / (params.ringsPerLetter + 1);
        for (const offset of [0, 0.04, -0.04, 0.08, -0.08, 0.12, -0.12]) {
          const f = Math.min(0.97, Math.max(0.03, base + offset));
          point = pointAlongRoute(route, f);
          if (avoidRing.every(other => point.distanceTo(other) > 0.7)) break;
        }
      } else {
        const desired = def.ringsUV[i] || [0.5, 0.5];
        point = nearestPoint(stage, desired, [...avoidRing, ...ringPoints], 1.15);
      }
      ringPoints.push(point);
    }
    ringPoints.forEach((point, i) => {
      const ringMaterial = materials.ring.clone();
      ringMaterial.transparent = true;
      const ringMesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.20, 0.055, 9, 24),
        ringMaterial
      );
      ringMesh.position.set(point.x, point.y, 0.16);
      root.add(ringMesh);
      stage.rings.push({ position: point, mesh: ringMesh, active: true, offset: i * 1.7 });
    });

    // Pintar la letra: la salida pide cubrir parte de ella con la estela. El mínimo se limita
    // a lo que la propia ruta cubre con el pincel, para que siempre sea alcanzable.
    stage.painted = new Uint8Array(stage.validPoints.length);
    stage.paintedCount = 0;
    stage.paintFraction = 0;
    stage.paintRequired = 0;
    if (route) {
      const probe = new Uint8Array(stage.validPoints.length);
      let covered = 0;
      for (const segment of route) {
        for (let i = 0; i < segment.length; i += 5) covered += stampPaint(stage, probe, segment[i], params.paintBrushRadius);
      }
      stage.paintRequired = Math.min(params.paintRequired, (covered / stage.validPoints.length) * 0.85);
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

  function nearestNodeId(stage, point) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < stage.validPoints.length; i++) {
      const q = stage.validPoints[i];
      const d = (q.x - point.x) ** 2 + (q.y - point.y) ** 2;
      if (d < bestDistance) { best = i; bestDistance = d; }
    }
    return best;
  }

  // Distancia (en pasos de rejilla) de cada nodo al borde de la letra: sirve para que la ruta
  // vaya por el centro del camino y no pegada a las paredes.
  function computeClearance(stage) {
    const { nodeAt, px, py } = stage.nav;
    const W = stage.blue.width;
    const n = stage.validPoints.length;
    const clear = new Float32Array(n).fill(-1);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < n; i++) {
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => nodeAt[(py[i] + dy * NAV_STRIDE) * W + px[i] + dx * NAV_STRIDE] < 0);
      if (edge) { clear[i] = 0; queue[tail++] = i; }
    }
    while (head < tail) {
      const u = queue[head++];
      for (const [dx, dy] of NAV_NEIGHBORS.slice(0, 4)) {
        const v = nodeAt[(py[u] + dy * NAV_STRIDE) * W + px[u] + dx * NAV_STRIDE];
        if (v < 0 || clear[v] >= 0) continue;
        clear[v] = clear[u] + 1;
        queue[tail++] = v;
      }
    }
    for (let i = 0; i < n; i++) if (clear[i] < 0) clear[i] = 0;
    stage.nav.clear = clear;
  }

  // Dijkstra sobre la rejilla: camino corto, pero penalizando ir pegado a las paredes.
  function findRoute(stage, startId, goalId) {
    const { nodeAt, px, py, clear } = stage.nav;
    const W = stage.blue.width;
    const n = stage.validPoints.length;
    const dist = new Float32Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap = new MinHeap();
    dist[startId] = 0;
    heap.push(0, startId);
    while (heap.size) {
      const [d, u] = heap.pop();
      if (d > dist[u]) continue;
      if (u === goalId) break;
      for (const [dx, dy] of NAV_NEIGHBORS) {
        const v = nodeAt[(py[u] + dy * NAV_STRIDE) * W + px[u] + dx * NAV_STRIDE];
        if (v < 0) continue;
        const nd = d + Math.hypot(dx, dy) * (1 + 5 / (1 + clear[v]));
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); }
      }
    }
    if (!Number.isFinite(dist[goalId])) return null;
    const ids = [];
    for (let at = goalId; at !== -1; at = prev[at]) ids.push(at);
    return ids.reverse();
  }

  // Ruta de la letra como tramos de puntos. En la E, el portal parte la ruta en dos tramos
  // (entrada -> portal, y salida del portal -> salida de la letra).
  function planRoute(stage) {
    const legs = stage.portalEntry && stage.portalExit
      ? [[stage.entry, stage.portalEntry], [stage.portalExit, stage.exit]]
      : [[stage.entry, stage.exit]];
    const segments = [];
    for (const [from, to] of legs) {
      const ids = findRoute(stage, nearestNodeId(stage, from), nearestNodeId(stage, to));
      if (!ids || ids.length < 2) return null;
      segments.push(ids.map(id => stage.validPoints[id]));
    }
    return segments;
  }

  function pointAlongRoute(segments, fraction) {
    const lengths = segments.map(seg => seg.reduce((sum, p, i) => (i ? sum + p.distanceTo(seg[i - 1]) : 0), 0));
    let target = fraction * lengths.reduce((a, b) => a + b, 0);
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      if (target > lengths[s]) { target -= lengths[s]; continue; }
      for (let i = 1; i < seg.length; i++) {
        const d = seg[i].distanceTo(seg[i - 1]);
        if (target <= d) return seg[i - 1].clone().lerp(seg[i], d ? target / d : 0);
        target -= d;
      }
      return seg[seg.length - 1].clone();
    }
    const last = segments[segments.length - 1];
    return last[last.length - 1].clone();
  }

  // Marca como pintados los nodos dentro del radio del pincel; devuelve cuántos son nuevos.
  function stampPaint(stage, painted, point, radius) {
    const { nodeAt } = stage.nav;
    const W = stage.blue.width;
    const H = stage.blue.height;
    const pxPerX = (W - 1) / stage.imageWidth;
    const pxPerY = (H - 1) / stage.imageHeight;
    const cx = (point.x / stage.imageWidth + 0.5) * (W - 1);
    const cy = (0.5 - point.y / stage.imageHeight) * (H - 1);
    const kx0 = Math.max(0, Math.ceil((cx - radius * pxPerX - 3) / NAV_STRIDE));
    const kx1 = Math.floor((cx + radius * pxPerX - 3) / NAV_STRIDE);
    const ky0 = Math.max(0, Math.ceil((cy - radius * pxPerY - 3) / NAV_STRIDE));
    const ky1 = Math.floor((cy + radius * pxPerY - 3) / NAV_STRIDE);
    let added = 0;
    for (let ky = ky0; ky <= ky1; ky++) {
      const py = 3 + ky * NAV_STRIDE;
      if (py >= H - 3) break;
      for (let kx = kx0; kx <= kx1; kx++) {
        const px = 3 + kx * NAV_STRIDE;
        if (px >= W - 3) break;
        const id = nodeAt[py * W + px];
        if (id < 0 || painted[id]) continue;
        const dx = (px - cx) / pxPerX;
        const dy = (py - cy) / pxPerY;
        if (dx * dx + dy * dy > radius * radius) continue;
        painted[id] = 1;
        added++;
      }
    }
    return added;
  }

  function resetPaint(stage) {
    stage.painted.fill(0);
    stage.paintedCount = 0;
    stage.paintFraction = 0;
    onEvent('paint', 0, stage.paintRequired);
  }

  function refreshRingStates(stage) {
    stage.rings.forEach((ring, i) => {
      ring.mesh.material.opacity = ring.active && i === ringsCollected ? 1 : 0.4;
    });
  }

  function updateExit(stage) {
    if (stage.exitMesh.visible) return;
    if (ringsCollected >= params.ringsPerLetter && stage.paintFraction >= stage.paintRequired) {
      stage.exitMesh.visible = true;
      onEvent('exitOpen', stage.name);
    }
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

  function breakStroke() {
    if (recording[recording.length - 1].length) recording.push([]);
  }

  // Guarda el recorrido de la letra actual (u,v en 0..1 sobre su imagen) antes de borrar la estela.
  function recordCurrentLetter() {
    const stage = activeStage();
    const strokes = recording
      .filter(stroke => stroke.length > 1)
      .map(stroke => stroke.map(p => [p.x / stage.imageWidth + 0.5, 0.5 - p.y / stage.imageHeight]));
    recordedTrails[currentIndex] = { name: stage.name, aspect: stage.imageWidth / stage.imageHeight, strokes };
  }

  function clearTrail() {
    recording = [[]];
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

    const stroke = recording[recording.length - 1];
    if (!stroke.length) stroke.push({ x: from.x, y: from.y });
    stroke.push({ x: to.x, y: to.y });

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
    resetPaint(stage);
    stampPaintAtTaxi(stage);
    refreshRingStates(stage);
    timeLeft = params.timePerLetter;
    onEvent('tick', timeLeft, 0);
  }

  function stampPaintAtTaxi(stage) {
    const added = stampPaint(stage, stage.painted, taxiPosition, params.paintBrushRadius);
    if (!added) return;
    stage.paintedCount += added;
    const fraction = stage.paintedCount / stage.validPoints.length;
    const changed = Math.round(fraction * 100) !== Math.round(stage.paintFraction * 100);
    stage.paintFraction = fraction;
    if (changed) onEvent('paint', fraction, stage.paintRequired);
  }

  function start() {
    intro = false;
    won = false;
    timedOut = false;
    totalTime = 0;
    portalCooldownTaxi = 0;
    recordedTrails = [];
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
    recordedTrails = [];
    stages.forEach((stage, i) => {
      stage.root.position.x = 0;
      stage.root.visible = i === 0;
      stage.ringCount = 0;
      stage.rings.forEach(ring => { ring.active = true; ring.mesh.visible = true; });
      stage.exitMesh.visible = false;
      stage.exitMesh.scale.setScalar(1);
      stage.portalUsed = false;
      stage.painted.fill(0);
      stage.paintedCount = 0;
      stage.paintFraction = 0;
    });
    taxi.visible = false;
    setCarPosition(taxi, new THREE.Vector2(), 0);
    clearTrail();
    onEvent('reset', 'S');
  }

  function beginTransition() {
    if (transition || !activeStage().exitMesh.visible) return;
    // Se guarda el recorrido de esta letra antes de que la transición borre la estela.
    recordCurrentLetter();
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
    breakStroke();
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
      breakStroke();
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

    // Pintar la letra con la estela del taxi.
    if (movedResult.moved) stampPaintAtTaxi(stage);

    // Los anillos se recogen EN ORDEN a lo largo de la ruta de la letra (solo cuenta el siguiente).
    const nextRing = stage.rings[ringsCollected];
    if (nextRing && nextRing.active && taxiPosition.distanceTo(nextRing.position) <= 0.38) {
      nextRing.active = false;
      nextRing.mesh.visible = false;
      spawnSparks(nextRing.position);
      ringsCollected++;
      stage.ringCount = ringsCollected;
      refreshRingStates(stage);
      // Cada anillo devuelve un poco de tiempo, sin superar el máximo por letra.
      timeLeft = Math.min(params.timePerLetter, timeLeft + params.ringTimeBonus);
      onEvent('pickup', ringsCollected, params.ringsPerLetter, stage.name);
    }

    // La salida se abre con los anillos completos Y la letra pintada lo suficiente.
    updateExit(stage);

    if (stage.exitMesh.visible && taxiPosition.distanceTo(stage.exit) < 0.48) {
      beginTransition();
    }
  }

  function animateDecor(time, dt = 1 / 60) {
    const stage = activeStage();
    stage.rings.forEach((ring, i) => {
      if (!ring.active) return;
      ring.mesh.rotation.z = time * 0.0015 + ring.offset;
      // El siguiente anillo a recoger es más grande y brillante.
      const size = i === ringsCollected ? 1.25 : 0.85;
      ring.mesh.scale.setScalar((1 + Math.sin(time * 0.005 + ring.offset) * 0.08) * size);
    });
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
    // Recorridos grabados por letra: [{ name, aspect, strokes: [[[u,v], ...], ...] }, ...]
    getRecordedTrails: () => recordedTrails.slice(),
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