// Parámetros de conducción arcade.
export function createParameters() {
  return {
    acceleration: 10.5,
    maxSpeed: 6.8,
    friction: 0.965,
    turnSpeed: 3.15,
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
