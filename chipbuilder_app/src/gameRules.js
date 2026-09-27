export const PLAYER_RADIUS = 0.34;
export const PICKUP_RADIUS = 0.62;
export const DESTINATION_RADIUS = 0.72;

export function createGame(level) {
  return {
    levelId: level.id,
    player: { ...level.start },
    cargo: [],
    signal: [],
    collectedIds: [],
    gateState: Object.fromEntries(
      level.gates.map((gate) => [gate.id, { inputs: {}, output: null }])
    ),
    fabrication: { patterned: false, etched: false },
    cost: { processSteps: 0, energy: 0 },
    status: 'playing',
    message: 'Carrier online. Follow the goal and deliver the exact target signal.',
  };
}

function overlapsObstacle(position, obstacle) {
  return (
    position.x + PLAYER_RADIUS > obstacle.x - obstacle.width / 2 &&
    position.x - PLAYER_RADIUS < obstacle.x + obstacle.width / 2 &&
    position.y + PLAYER_RADIUS > obstacle.y - obstacle.height / 2 &&
    position.y - PLAYER_RADIUS < obstacle.y + obstacle.height / 2
  );
}

function activeObstacles(level, state) {
  return level.obstacles.filter(
    (obstacle) => obstacle.permanent || !state.fabrication.etched
  );
}

function collectBits(level, state) {
  const newlyCollected = level.pickups.filter((pickup) => {
    if (state.collectedIds.includes(pickup.id)) return false;
    return Math.hypot(state.player.x - pickup.x, state.player.y - pickup.y) <= PICKUP_RADIUS;
  });

  if (!newlyCollected.length) return state;

  return {
    ...state,
    cargo: [...state.cargo, ...newlyCollected.map(({ id, value }) => ({ id, value }))],
    collectedIds: [...state.collectedIds, ...newlyCollected.map(({ id }) => id)],
    cost: { ...state.cost, energy: state.cost.energy + newlyCollected.length },
    message: `Collected ${newlyCollected.map(({ value }) => value).join(', ')}. Deposit cargo by click or drag.`,
  };
}

function evaluateDestination(level, state) {
  const distance = Math.hypot(
    state.player.x - level.destination.x,
    state.player.y - level.destination.y
  );
  if (distance > DESTINATION_RADIUS || state.status !== 'playing') return state;

  const actual = state.signal.join('');
  if (actual === level.target) {
    return {
      ...state,
      status: 'success',
      message: `Signal ${actual} matches target ${level.target}. Delivery accepted.`,
    };
  }

  const explanation = actual.length === 0
    ? 'The signal bucket is empty.'
    : actual.length !== level.target.length
      ? `Expected ${level.target.length} bit${level.target.length === 1 ? '' : 's'}, received ${actual.length}.`
      : `Bit order/value mismatch: received ${actual}, expected ${level.target}.`;

  return {
    ...state,
    status: 'failed',
    message: `Delivery rejected. ${explanation}`,
  };
}

export function movePlayer(level, state, movement) {
  if (state.status !== 'playing') return state;

  const candidate = {
    x: Math.max(-5.65, Math.min(5.65, state.player.x + movement.x)),
    y: Math.max(-4.15, Math.min(4.15, state.player.y + movement.y)),
  };
  const player = activeObstacles(level, state).some((obstacle) => overlapsObstacle(candidate, obstacle))
    ? state.player
    : candidate;

  return evaluateDestination(level, collectBits(level, { ...state, player }));
}

function gateOutput(type, values) {
  if (type === 'NOT') return values[0] === 0 ? 1 : 0;
  if (type === 'AND') return values.every((value) => value === 1) ? 1 : 0;
  return null;
}

export function depositCargo(level, state, cargoId, target) {
  if (state.status !== 'playing') return state;
  const cargo = state.cargo.find((item) => item.id === cargoId);
  if (!cargo) return state;

  if (target.kind === 'signal') {
    return {
      ...state,
      cargo: state.cargo.filter((item) => item.id !== cargoId),
      signal: [...state.signal, cargo.value],
      cost: { ...state.cost, energy: state.cost.energy + 1 },
      message: `Deposited ${cargo.value}. Current signal: ${[...state.signal, cargo.value].join('')}.`,
    };
  }

  const gate = level.gates.find((item) => item.id === target.gateId);
  const input = gate?.inputs.find((item) => item.id === target.inputId);
  const currentGate = gate ? state.gateState[gate.id] : null;
  if (!gate || !input || currentGate.inputs[input.id] !== undefined) return state;

  const inputs = { ...currentGate.inputs, [input.id]: cargo.value };
  const complete = gate.inputs.every((item) => inputs[item.id] !== undefined);
  const output = complete ? gateOutput(gate.type, gate.inputs.map((item) => inputs[item.id])) : null;
  const outputCargo = complete
    ? [{ id: `${gate.id}-output`, value: output }]
    : [];
  const reason = gate.type === 'NOT'
    ? `NOT flips ${cargo.value} to ${output}.`
    : complete
      ? `AND sees ${gate.inputs.map((item) => `${item.label}=${inputs[item.id]}`).join(', ')}; output is ${output}.`
      : `${input.label} received ${cargo.value}. One distinct input remains.`;

  return {
    ...state,
    cargo: [...state.cargo.filter((item) => item.id !== cargoId), ...outputCargo],
    gateState: {
      ...state.gateState,
      [gate.id]: { inputs, output },
    },
    cost: { ...state.cost, energy: state.cost.energy + 2 },
    message: reason,
  };
}

export function fabricate(level, state, action) {
  if (state.status !== 'playing' || !level.fabrication) return state;
  if (action === 'lithography') {
    if (state.fabrication.patterned) {
      return { ...state, message: 'The highlighted channel is already patterned.' };
    }
    const cost = level.fabrication.lithography;
    return {
      ...state,
      fabrication: { ...state.fabrication, patterned: true },
      cost: {
        processSteps: state.cost.processSteps + cost.processSteps,
        energy: state.cost.energy + cost.energy,
      },
      message: 'Lithography applied immediately: the channel target is now patterned.',
    };
  }
  if (action === 'etch') {
    if (!state.fabrication.patterned) {
      return { ...state, message: 'Etch needs a patterned target. Apply Lithography first; no cost charged.' };
    }
    if (state.fabrication.etched) {
      return { ...state, message: 'The channel is already open.' };
    }
    const cost = level.fabrication.etch;
    return {
      ...state,
      fabrication: { ...state.fabrication, etched: true },
      cost: {
        processSteps: state.cost.processSteps + cost.processSteps,
        energy: state.cost.energy + cost.energy,
      },
      message: 'Etch executed immediately: the patterned barrier was removed and the route is open.',
    };
  }
  return state;
}