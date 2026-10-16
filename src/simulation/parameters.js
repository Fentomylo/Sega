// Parámetros de conducción arcade.
export function createParameters() {
  return {
    // Velocidad estilo arcade SEGA: más empuje, más punta y menos fricción.
    acceleration: 15,
    maxSpeed: 8.6,
    friction: 0.97,
    turnSpeed: 3.4,
    // Contrarreloj: segundos por letra y segundos que devuelve cada anillo (sin pasar del máximo).
    timePerLetter: 10,
    ringTimeBonus: 1,
    // Chocar contra el borde blanco cuesta tiempo: la velocidad sin control se paga.
    crashTimePenalty: 0.5,
    warningTime: 3,
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