// Parámetros de conducción arcade.
export function createParameters() {
  return {
    // Velocidad estilo arcade SEGA: más empuje, más punta y menos fricción.
    acceleration: 15,
    maxSpeed: 8.6,
    friction: 0.97,
    turnSpeed: 3.4,
    // Contrarreloj: segundos por letra y segundos que devuelve cada anillo (sin pasar del máximo).
    // Rebalanceo: la salida pide anillos EN ORDEN y pintar parte de la letra, así que hay más tiempo.
    timePerLetter: 12,
    ringTimeBonus: 1.5,
    // Pintar la letra: radio del "pincel" del taxi (unidades de mundo) y fracción de la letra
    // que hay que cubrir para abrir la salida (se limita sola a lo alcanzable por la ruta de cada letra).
    paintBrushRadius: 0.5,
    paintRequired: 0.45,
    // Chocar contra el borde blanco cuesta tiempo: la velocidad sin control se paga.
    crashTimePenalty: 0.5,
    warningTime: 3,
    // Filtro retro: el render se hace a 1/pixelSize de la resolución de pantalla (1 = sin pixelar).
    pixelSize: 3,
    // Factor para mostrar la velocidad en el HUD como "KM/H".
    speedDisplayFactor: 30,
    driftTurnBoost: 1.55,
    normalLateralGrip: 0.76,
    driftLateralGrip: 0.985,
    driftMinSpeed: 1.15,
    policeSpeed: 1.95,
    catchDistance: 0.78,
    carHalfLength: 0.23,
    carHalfWidth: 0.14,
    ringsPerLetter: 3,
    transitionDuration: 0.72,
    crashCooldown: 0.55
  };
}