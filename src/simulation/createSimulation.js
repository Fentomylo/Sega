import * as THREE from 'three/webgpu';

export function createSimulation({ scene, params, onEvent = () => {} }) {
  const world = new THREE.Group();
  scene.add(world);

  const materials = {
    floor: new THREE.MeshBasicMaterial({ color: '#050608' }),
    blue: new THREE.MeshBasicMaterial({ color: '#0866a8' }),
    white: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    road: new THREE.MeshBasicMaterial({ color: '#101820' }),
    yellow: new THREE.MeshStandardMaterial({ color: '#ffd329' }),
    black: new THREE.MeshStandardMaterial({ color: '#151515' }),
    police: new THREE.MeshStandardMaterial({ color: '#dbeaff' }),
    red: new THREE.MeshBasicMaterial({ color: '#ff304f' }),
    gold: new THREE.MeshBasicMaterial({ color: '#ffe66d' })
  };

  // --------------------------------------------------
  // ESCENARIO: LAS LETRAS SON LAS MAZMORRAS
  // Cada letra tiene sus propias galerías y pasillos.
  // --------------------------------------------------

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 12),
    materials.floor
  );
  floor.position.z = -0.5;
  world.add(floor);

  const grid = new THREE.GridHelper(24, 24, '#142a3a', '#0b1721');
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.45;
  world.add(grid);

  const letterShapes = [
    {
      name: 'S',
      x: -7.5,
      paths: [
        [[-1.1, 1.5], [0.7, 1.5], [1.1, 1.1], [-0.7, 1.1],
         [-1.1, 0.7], [-1.1, 0.1], [-0.7, -0.3],
         [0.7, -0.3], [1.1, -0.7], [1.1, -1.1],
         [0.7, -1.5], [-1.1, -1.5]]
      ]
    },
    {
      name: 'E',
      x: -2.5,
      paths: [
        [[1.0, 1.5], [-1.0, 1.5], [-1.0, -1.5], [1.0, -1.5]],
        [[-1.0, 0], [0.65, 0]]
      ]
    },
    {
      name: 'G',
      x: 2.5,
      paths: [
        [[1.0, 1.5], [-0.7, 1.5], [-1.0, 1.1],
         [-1.0, -1.1], [-0.7, -1.5], [1.0, -1.5],
         [1.0, 0], [0, 0]]
      ]
    },
    {
      name: 'A',
      x: 7.5,
      paths: [
        [[-1.2, -1.5], [0, 1.5], [0.35, 1.5],
         [1.5, -1.5]],
        [[-0.65, -0.1], [0.95, -0.1]]
      ]
    }
  ];

  const lanes = [];
  const checkpoints = [];
  const letterMeshes = [];

  function createText(text, x, y, size, color, z = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 512);
    ctx.font = `900 ${size}px Arial Black, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 20;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(text, 256, 256);
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 256);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 3.6),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false
      })
    );

    mesh.position.set(x, y, -0.3 + z);
    world.add(mesh);
    return mesh;
  }

  function addSegment(a, b, radius, material, z = 0) {
    const start = new THREE.Vector3(a[0], a[1], z);
    const end = new THREE.Vector3(b[0], b[1], z);
    const distance = start.distanceTo(end);

    if (distance < 0.001) return;

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(distance, radius * 2, 0.06),
      material
    );

    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.rotation.z = Math.atan2(
      end.y - start.y,
      end.x - start.x
    );

    world.add(mesh);
  }

  function addCorridor(points, letterIndex) {
    const worldPoints = points.map(([x, y]) => [
      x + letterShapes[letterIndex].x,
      y
    ]);

    // Suelo transitable del pasillo.
    for (let i = 0; i < worldPoints.length - 1; i++) {
      addSegment(worldPoints[i], worldPoints[i + 1], 0.72, materials.road, 0.0);
      addSegment(worldPoints[i], worldPoints[i + 1], 0.045, materials.blue, 0.06);
    }

    // Los puntos de la ruta son también puntos válidos de circulación.
    for (let i = 0; i < worldPoints.length - 1; i++) {
      const a = new THREE.Vector2(...worldPoints[i]);
      const b = new THREE.Vector2(...worldPoints[i + 1]);

      const steps = Math.ceil(a.distanceTo(b) / 0.12);

      for (let j = 0; j <= steps; j++) {
        const t = j / steps;
        lanes.push(new THREE.Vector2().lerpVectors(a, b, t));
      }
    }

    return worldPoints;
  }

  letterShapes.forEach((letter, index) => {
    const label = createText(letter.name, letter.x, 0, 190, '#0866a8');
    letterMeshes.push(label);

    // Las galerías se dibujan individualmente para cada letra.
    letter.paths.forEach(path => addCorridor(path, index));

    // Conexión entre mazmorras tipográficas.
    if (index < letterShapes.length - 1) {
      const next = letterShapes[index + 1];
      const start = [letter.x + 1.0, -1.5];
      const end = [next.x - 1.0, -1.5];

      addSegment(start, end, 0.72, materials.road, 0.0);
      addSegment(start, end, 0.045, materials.blue, 0.06);

      const a = new THREE.Vector2(...start);
      const b = new THREE.Vector2(...end);
      const steps = Math.ceil(a.distanceTo(b) / 0.12);

      for (let j = 0; j <= steps; j++) {
        lanes.push(new THREE.Vector2().lerpVectors(a, b, j / steps));
      }
    }
  });

  // --------------------------------------------------
  // VEHÍCULOS
  // --------------------------------------------------

  function makeCar(bodyMaterial, isPolice = false) {
    const car = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.43, 0.24),
      bodyMaterial
    );
    body.position.z = 0.2;
    car.add(body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.31, 0.18),
      materials.black
    );
    cabin.position.set(-0.04, 0, 0.37);
    car.add(cabin);

    if (isPolice) {
      const light = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.1, 0.06),
        materials.red
      );
      light.position.z = 0.5;
      car.add(light);
    } else {
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.17, 0.07),
        materials.yellow
      );
      roof.position.z = 0.5;
      car.add(roof);
    }

    car.userData.velocity = new THREE.Vector2();
    car.userData.heading = 0;
    world.add(car);

    return car;
  }

  const taxi = makeCar(materials.yellow);
  const police = makeCar(materials.police, true);

  const taxiPosition = new THREE.Vector2(-8.6, 1.5);
  const policePosition = new THREE.Vector2(7.5, 1.5);

  taxi.position.set(taxiPosition.x, taxiPosition.y, 0.1);
  police.position.set(policePosition.x, policePosition.y, 0.1);

  // --------------------------------------------------
  // OBJETIVOS POR LETRA
  // --------------------------------------------------

  letterShapes.forEach((letter, index) => {
    const x = letter.x;
    const y = index === 0 ? 1.1 : -1.5;

    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.06, 8, 24),
      materials.gold
    );

    marker.position.set(x, y, 0.25);
    world.add(marker);

    checkpoints.push({
      letter: letter.name,
      index,
      position: new THREE.Vector2(x, y),
      mesh: marker,
      active: true
    });
  });

  let currentLetter = 0;
  let caught = false;
  let won = false;
  let intro = true;

  const keys = new Set();
  const scratch = new THREE.Vector2();

  // --------------------------------------------------
  // CONTROLES: GIRO CORREGIDO
  // Derecha gira en sentido horario; izquierda antihorario.
  // --------------------------------------------------

  function keyDown(e) {
    if ([
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'
    ].includes(e.code)) {
      e.preventDefault();
    }

    keys.add(e.code);

    if (e.code === 'Enter' && intro) {
      intro = false;
      onEvent('start');
    }

    if (e.code === 'KeyR' && (caught || won)) reset();
  }

  function keyUp(e) {
    keys.delete(e.code);
  }

  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);

  function reset() {
    taxiPosition.set(-8.6, 1.5);
    policePosition.set(7.5, 1.5);

    taxi.position.set(taxiPosition.x, taxiPosition.y, 0.1);
    police.position.set(policePosition.x, policePosition.y, 0.1);

    taxi.userData.velocity.set(0, 0);
    taxi.userData.heading = 0;
    taxi.rotation.z = 0;

    currentLetter = 0;
    caught = false;
    won = false;
    intro = false;

    checkpoints.forEach(checkpoint => {
      checkpoint.active = true;
      checkpoint.mesh.visible = true;
    });

    letterMeshes.forEach(mesh => {
      mesh.visible = true;
      mesh.scale.set(1, 1, 1);
    });

    onEvent('reset');
  }

  function nearestLaneDistance(position) {
    let min = Infinity;

    for (const lane of lanes) {
      min = Math.min(min, position.distanceTo(lane));
    }

    return min;
  }

  function update(dt) {
    if (intro || caught || won) return;

    const velocity = taxi.userData.velocity;

    const forward =
      (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0) -
      (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0);

    const steer =
      (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) -
      (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);

    const speed = velocity.length();

    // FIX: el signo negativo corrige el giro invertido.
    taxi.userData.heading -=
      steer * params.turnSpeed * dt *
      (0.25 + Math.min(speed / params.maxSpeed, 1));

    taxi.rotation.z = taxi.userData.heading;

    const direction = new THREE.Vector2(
      Math.cos(taxi.userData.heading),
      Math.sin(taxi.userData.heading)
    );

    velocity.addScaledVector(
      direction,
      forward * params.acceleration * dt
    );

    velocity.multiplyScalar(Math.pow(params.friction, dt * 60));

    if (velocity.length() > params.maxSpeed) {
      velocity.setLength(params.maxSpeed);
    }

    const previous = taxiPosition.clone();

    taxiPosition.addScaledVector(velocity, dt);

    // Los pasillos de las letras limitan el movimiento.
    if (nearestLaneDistance(taxiPosition) > 0.68) {
      taxiPosition.copy(previous);
      velocity.multiplyScalar(-0.15);
      onEvent('crash');
    }

    taxi.position.x = taxiPosition.x;
    taxi.position.y = taxiPosition.y;

    // La policía persigue al jugador por el escenario.
    scratch.set(
      taxiPosition.x - policePosition.x,
      taxiPosition.y - policePosition.y
    );

    const distance = scratch.length();

    if (distance > 0.01) {
      const step = Math.min(params.policeSpeed * dt, distance);

      policePosition.addScaledVector(
        scratch.normalize(),
        step
      );

      police.rotation.z = Math.atan2(
        taxiPosition.y - policePosition.y,
        taxiPosition.x - policePosition.x
      );

      police.position.x = policePosition.x;
      police.position.y = policePosition.y;
    }

    if (distance < params.catchDistance) {
      caught = true;
      onEvent('caught');
      return;
    }

    // Se avanza por las letras en orden: S -> E -> G -> A.
    const checkpoint = checkpoints[currentLetter];

    if (
      checkpoint &&
      taxiPosition.distanceTo(checkpoint.position) < 0.7
    ) {
      checkpoint.active = false;
      checkpoint.mesh.visible = false;

      onEvent('letter', checkpoint.letter);
      currentLetter++;

      if (checkpoint.letter === 'A') {
        won = true;
        onEvent('logoReveal');
        onEvent('win');
      }
    }
  }

  function animateDecor(time) {
    checkpoints.forEach((checkpoint, index) => {
      if (!checkpoint.active) return;

      checkpoint.mesh.rotation.z = time * 0.0015;
      checkpoint.mesh.position.z =
        0.25 + Math.sin(time * 0.003 + index) * 0.05;
    });
  }

  function dispose() {
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);

    scene.remove(world);

    world.traverse(object => {
      if (object.geometry) object.geometry.dispose();
    });
  }

  return {
    update,
    animateDecor,
    reset,
    dispose,
    getState: () => ({
      currentLetter,
      total: checkpoints.length,
      caught,
      won,
      intro
    })
  };
}