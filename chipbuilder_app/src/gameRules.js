import { BASE_HEIGHT, createTerrain, FAB_TOOLS, MAX_HEIGHT, MIN_HEIGHT, terrainHeight } from './terrain.js';

export const PLAYER_RADIUS = 0.34;
export const PICKUP_RADIUS = 0.62;
export const DESTINATION_RADIUS = 0.72;
export const GATE_INPUT_INTERACTION_RADIUS = 0.92;
const DROP_DISTANCE = 0.45;

// Unary gates transform carried cargo automatically when the carrier crosses them.
const PASS_THROUGH_GATES = { NOT: (value) => (value === 0 ? 1 : 0) };
const GATE_FOOTPRINTS = { NOT: { width: 1.75, height: 1.35 }, AND: { width: 2.15, height: 1.35 } };

export function gateFootprint(gate) {
  return GATE_FOOTPRINTS[gate.type] || { width: 1.6, height: 1.3 };
}

export function gateInputPosition(gate, inputId) {
  const { width, height } = gateFootprint(gate);
  const count = Math.max(1, gate.inputs?.length || 1);
  const index = Math.max(0, gate.inputs?.findIndex((input) => input.id === inputId) ?? 0);
  const offset = count === 1 ? 0 : (0.5 - index / (count - 1)) * height * 0.82;
  return { x: gate.x - width / 2 - 0.42, y: gate.y + offset };
}

export function gateOutputPosition(gate) {
  const { width } = gateFootprint(gate);
  return { x: gate.x + width / 2 + 0.48, y: gate.y };
}

export function isPassThroughGate(gate) {
  return Boolean(PASS_THROUGH_GATES[gate.type]);
}

export function applyGateToCargo(gateType, cargo) {
  const transform = PASS_THROUGH_GATES[gateType];
  if (!transform) return cargo;
  return cargo.map((item) => ({ ...item, value: transform(item.value) }));
}

function isInsideGate(gate, position) {
  const { width, height } = gateFootprint(gate);
  return Math.abs(position.x - gate.x) <= width / 2 && Math.abs(position.y - gate.y) <= height / 2;
}

export function createGame(level) {
  return {
    levelId: level.id,
    player: { ...level.start },
    cargo: [],
    targetSlots: level.target.split('').map((bit) => ({ value: Number(bit), delivered: false })),
    // armed=false marks a freshly dropped bit that cannot be collected until the carrier leaves it.
    worldBits: level.pickups.map(({ id, value, x, y }) => ({ id, value, x, y, armed: true })),
    atDestination: false,
    feedback: null,
    gateEvent: null,
    gateState: Object.fromEntries(
      level.gates.map((gate) => [gate.id, { inputs: {}, output: null, pendingOutput: null, inside: false, activations: 0 }])
    ),
    fabrication: { patterned: false, etched: false },
    terrain: level.fabrication?.terrain ? createTerrain() : null,
    terrainHistory: [],
    cost: { processSteps: 0, energy: 0, manufacturing: 0 },
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

const clampToWafer = (position) => ({
  x: Math.max(-5.65, Math.min(5.65, position.x)),
  y: Math.max(-4.15, Math.min(4.15, position.y)),
});

function isWalkable(level, state, position) {
  const blocked = state.terrain && terrainHeight(state.terrain, position.x, position.y) !== BASE_HEIGHT;
  return !blocked && !activeObstacles(level, state).some((obstacle) => overlapsObstacle(position, obstacle));
}

export function isAtDestination(level, state) {
  return Math.hypot(state.player.x - level.destination.x, state.player.y - level.destination.y) <= DESTINATION_RADIUS;
}

export function collectBits(state) {
  const distanceTo = (bit) => Math.hypot(state.player.x - bit.x, state.player.y - bit.y);
  const worldBits = state.worldBits.map((bit) => (
    !bit.armed && distanceTo(bit) > PICKUP_RADIUS ? { ...bit, armed: true } : bit
  ));
  const newlyCollected = worldBits.filter((bit) => bit.armed && distanceTo(bit) <= PICKUP_RADIUS);

  if (!newlyCollected.length) {
    return worldBits.some((bit, index) => bit !== state.worldBits[index]) ? { ...state, worldBits } : state;
  }

  const cargo = [...state.cargo, ...newlyCollected.map(({ id, value }) => ({ id, value }))];
  return {
    ...state,
    cargo,
    worldBits: worldBits.filter((bit) => !newlyCollected.includes(bit)),
    cost: { ...state.cost, energy: state.cost.energy + newlyCollected.length },
    message: `Collected ${newlyCollected.map(({ value }) => value).join(', ')}. Cargo order: ${cargo.map(({ value }) => value).join(' ')}.`,
  };
}

// Fires once on entry; the gate re-arms only after the carrier leaves its footprint.
function applyPassThroughGates(level, state) {
  return level.gates.filter(isPassThroughGate).reduce((current, gate) => {
    const entry = current.gateState[gate.id];
    const inside = isInsideGate(gate, current.player);
    if (inside === entry.inside) return current;

    const cargo = inside ? applyGateToCargo(gate.type, current.cargo) : current.cargo;
    const changed = cargo.filter((item, index) => item.value !== current.cargo[index].value);
    const next = {
      ...current,
      cargo,
      gateState: { ...current.gateState, [gate.id]: { ...entry, inside, output: changed.length ? changed[changed.length - 1].value : entry.output } },
    };
    if (!inside) return next;
    if (!changed.length) {
      return { ...next, message: `${gate.type} gate crossed with empty cargo. Collect a bit first.` };
    }
    return {
      ...next,
      gateEvent: {
        seq: (current.gateEvent?.seq || 0) + 1,
        gateId: gate.id,
        gateType: gate.type,
        ids: changed.map((item) => item.id),
      },
      cost: { ...current.cost, energy: current.cost.energy + changed.length },
      message: `${gate.type}: ${changed.map((item) => `${item.value === 0 ? 1 : 0} → ${item.value}`).join(', ')}. Cargo: ${cargo.map(({ value }) => value).join(' ')}.`,
    };
  }, state);
}

function collectGateOutputs(level, state) {
  return level.gates.filter((gate) => !isPassThroughGate(gate)).reduce((current, gate) => {
    const gateState = current.gateState[gate.id];
    const pending = gateState?.pendingOutput;
    if (!pending) return current;

    const position = gateOutputPosition(gate);
    const distance = Math.hypot(current.player.x - position.x, current.player.y - position.y);
    if (distance > PICKUP_RADIUS) return current;

    const cargo = [...current.cargo, { id: pending.id, value: pending.value }];
    return {
      ...current,
      cargo,
      gateState: {
        ...current.gateState,
        [gate.id]: { ...gateState, pendingOutput: null },
      },
      cost: { ...current.cost, energy: current.cost.energy + 1 },
      message: `Collected ${gate.type} output ${pending.value}. Cargo: ${cargo.map(({ value }) => value).join(' ')}.`,
    };
  }, state);
}

export function movePlayer(level, state, movement) {
  if (state.status !== 'playing') return state;

  const candidate = clampToWafer({ x: state.player.x + movement.x, y: state.player.y + movement.y });
  const player = isWalkable(level, state, candidate) ? candidate : state.player;
  const next = applyPassThroughGates(level, collectGateOutputs(level, collectBits({ ...state, player })));
  const atDestination = isAtDestination(level, next);
  if (atDestination === state.atDestination) return next;
  return {
    ...next,
    atDestination,
    message: atDestination
      ? 'At DEST. Press Enter to submit cargo left → right.'
      : next.message,
  };
}

export function attemptSignalDelivery(level, state) {
  if (state.status !== 'playing') return state;
  if (!isAtDestination(level, state)) {
    return { ...state, message: 'Delivery needs the carrier at DEST. Nothing was deposited.' };
  }
  if (!state.cargo.length) {
    return { ...state, message: 'Cargo is empty. Collect bits before delivering.' };
  }

  // Pair cargo[i] with the i-th undelivered slot; decide everything before mutating.
  const openSlots = state.targetSlots
    .map((slot, index) => ({ ...slot, index }))
    .filter((slot) => !slot.delivered);
  const acceptedIds = new Set();
  const acceptedSlots = new Set();
  state.cargo.forEach((item, i) => {
    const slot = openSlots[i];
    if (slot && slot.value === item.value) {
      acceptedIds.add(item.id);
      acceptedSlots.add(slot.index);
    }
  });

  const seq = (state.feedback?.seq || 0) + 1;
  if (!acceptedIds.size) {
    return {
      ...state,
      feedback: { kind: 'reject', seq },
      message: `No match: open slots expect ${openSlots.map(({ value }) => value).join(' ')}, cargo is ${state.cargo.map(({ value }) => value).join(' ')}. Bits stay in cargo.`,
    };
  }

  const targetSlots = state.targetSlots.map((slot, index) => (
    acceptedSlots.has(index) ? { ...slot, delivered: true } : slot
  ));
  const cargo = state.cargo.filter((item) => !acceptedIds.has(item.id));
  const complete = targetSlots.every((slot) => slot.delivered);
  const rejected = Math.min(state.cargo.length, openSlots.length) - acceptedIds.size;
  const signal = targetSlots.map((slot) => (slot.delivered ? slot.value : '_')).join(' ');

  return {
    ...state,
    cargo,
    targetSlots,
    feedback: { kind: complete || !rejected ? 'accept' : 'partial', seq },
    cost: { ...state.cost, energy: state.cost.energy + acceptedIds.size },
    status: complete ? 'success' : state.status,
    message: complete
      ? `Signal ${level.target} complete. Every target slot received the correct bit.`
      : `Accepted ${acceptedIds.size} bit${acceptedIds.size === 1 ? '' : 's'}. Signal: ${signal}.${rejected ? ` ${rejected} mismatching bit${rejected === 1 ? '' : 's'} stayed in cargo.` : ''}`,
  };
}

function nearestOpenGateInput(level, state) {
  let nearest = null;
  level.gates.filter((gate) => !isPassThroughGate(gate)).forEach((gate) => {
    const currentGate = state.gateState[gate.id];
    if (!currentGate || currentGate.pendingOutput) return;
    gate.inputs?.forEach((input) => {
      if (currentGate.inputs[input.id] !== undefined) return;
      const position = gateInputPosition(gate, input.id);
      const distance = Math.hypot(state.player.x - position.x, state.player.y - position.y);
      if (distance <= GATE_INPUT_INTERACTION_RADIUS && (!nearest || distance < nearest.distance)) {
        nearest = { gateId: gate.id, inputId: input.id, distance };
      }
    });
  });
  return nearest;
}

export function dropCargoBit(level, state, cargoId) {
  if (state.status !== 'playing' || !state.cargo.length) return state;
  const item = state.cargo.find((bit) => bit.id === cargoId) || state.cargo[state.cargo.length - 1];
  const gateTarget = nearestOpenGateInput(level, state);
  if (gateTarget) {
    return depositCargo(level, state, item.id, { kind: 'gate', gateId: gateTarget.gateId, inputId: gateTarget.inputId });
  }

  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const spot = directions
    .map(([dx, dy]) => {
      const length = Math.hypot(dx, dy);
      return clampToWafer({ x: state.player.x + dx / length * DROP_DISTANCE, y: state.player.y + dy / length * DROP_DISTANCE });
    })
    .find((position) => isWalkable(level, state, position)) || { ...state.player };

  return {
    ...state,
    cargo: state.cargo.filter((bit) => bit.id !== item.id),
    worldBits: [...state.worldBits, { id: item.id, value: item.value, ...spot, armed: false }],
    message: `Dropped ${item.value} onto the wafer. Move away and return to collect it again.`,
  };
}

export function reorderCargo(state, cargoId, toIndex) {
  const fromIndex = state.cargo.findIndex((item) => item.id === cargoId);
  if (fromIndex < 0 || fromIndex === toIndex) return state;
  const cargo = state.cargo.slice();
  const [item] = cargo.splice(fromIndex, 1);
  cargo.splice(Math.max(0, Math.min(toIndex, cargo.length)), 0, item);
  return { ...state, cargo, message: `Cargo order: ${cargo.map(({ value }) => value).join(' ')}.` };
}

function gateOutput(type, values) {
  if (type === 'AND') return values.every((value) => value === 1) ? 1 : 0;
  return null;
}

export function depositCargo(level, state, cargoId, target) {
  if (state.status !== 'playing') return state;
  const cargo = state.cargo.find((item) => item.id === cargoId);
  if (!cargo) return state;

  const gate = level.gates.find((item) => item.id === target.gateId);
  if (!gate || isPassThroughGate(gate)) return state;
  const input = gate.inputs?.find((item) => item.id === target.inputId);
  const currentGate = state.gateState[gate.id];
  if (!input || currentGate.inputs[input.id] !== undefined) return state;

  if (currentGate.pendingOutput) {
    return { ...state, message: `${gate.type} OUT is occupied. Collect the output bit before loading another pair.` };
  }

  const inputs = { ...currentGate.inputs, [input.id]: { id: cargo.id, value: cargo.value } };
  const complete = gate.inputs.every((item) => inputs[item.id] !== undefined);
  const cargoWithoutInput = state.cargo.filter((item) => item.id !== cargoId);

  if (!complete) {
    return {
      ...state,
      cargo: cargoWithoutInput,
      gateState: {
        ...state.gateState,
        [gate.id]: { ...currentGate, inputs },
      },
      cost: { ...state.cost, energy: state.cost.energy + 1 },
      message: `${input.label} loaded with ${cargo.value}. Click the loaded port to take it back, or load the remaining input.`,
    };
  }

  const values = gate.inputs.map((item) => inputs[item.id].value);
  const output = gateOutput(gate.type, values);
  const activation = currentGate.activations + 1;
  const outputId = `${gate.id}-output-${activation}`;
  return {
    ...state,
    cargo: cargoWithoutInput,
    gateState: {
      ...state.gateState,
      [gate.id]: {
        ...currentGate,
        inputs: {},
        output,
        pendingOutput: { id: outputId, value: output },
        activations: activation,
      },
    },
    gateEvent: {
      seq: (state.gateEvent?.seq || 0) + 1,
      gateId: gate.id,
      gateType: gate.type,
      ids: [outputId],
    },
    cost: { ...state.cost, energy: state.cost.energy + 2 },
    message: `${gate.type} consumed ${gate.inputs.map((item) => `${item.label}=${inputs[item.id].value}`).join(', ')} and produced ${output} at OUT. Walk over the output bit to collect it.`,
  };
}

export function reclaimGateInput(level, state, gateId, inputId) {
  if (state.status !== 'playing') return state;
  const gate = level.gates.find((item) => item.id === gateId);
  if (!gate || isPassThroughGate(gate)) return state;
  const currentGate = state.gateState[gate.id];
  const loaded = currentGate?.inputs?.[inputId];
  if (!loaded) return state;

  const input = gate.inputs?.find((item) => item.id === inputId);
  const inputs = { ...currentGate.inputs };
  delete inputs[inputId];
  return {
    ...state,
    cargo: [...state.cargo, loaded],
    gateState: {
      ...state.gateState,
      [gate.id]: { ...currentGate, inputs },
    },
    message: `${input?.label || inputId} returned to cargo. The gate has not consumed it.`,
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

export function canFabricateCell(state, action, col, row) {
  if (state.status !== 'playing' || !state.terrain || action !== 'lithography') return false;
  const cell = state.terrain[row]?.[col];
  return Boolean(cell && !cell.masked);
}

function terrainSnapshot(state) {
  return {
    terrain: state.terrain,
    cost: state.cost,
  };
}

function pushTerrainHistory(state) {
  return [...state.terrainHistory.slice(-39), terrainSnapshot(state)];
}

export function undoTerrainEdit(state) {
  if (state.status !== 'playing' || !state.terrainHistory?.length) return state;
  const previous = state.terrainHistory[state.terrainHistory.length - 1];
  return {
    ...state,
    terrain: previous.terrain,
    cost: previous.cost,
    terrainHistory: state.terrainHistory.slice(0, -1),
    message: 'Undid the last fabrication action.',
  };
}

export function fabricateCell(state, action, col, row, newStroke) {
  if (!canFabricateCell(state, action, col, row)) return state;
  const cell = state.terrain[row][col];
  const alreadyPatterned = state.terrain.some((cells) => cells.some((item) => item.masked));
  const terrain = state.terrain.map((cells, index) => index === row ? cells.slice() : cells);
  terrain[row][col] = { ...cell, masked: true };

  const tool = FAB_TOOLS.lithography;
  const startsPattern = newStroke && !alreadyPatterned;
  const strokeCost = tool.cell + (startsPattern ? tool.base : 0);
  return {
    ...state,
    terrain,
    terrainHistory: newStroke ? pushTerrainHistory(state) : state.terrainHistory,
    cost: {
      ...state.cost,
      processSteps: state.cost.processSteps + Number(startsPattern),
      manufacturing: state.cost.manufacturing + strokeCost,
    },
    message: `Lithography pattern: tile added. ${startsPattern ? `+${tool.base} setup + ` : '+'}${tool.cell} credits.`,
  };
}

export function applyTerrainProcess(state, action, cmpHeight = BASE_HEIGHT) {
  if (state.status !== 'playing' || !state.terrain || !FAB_TOOLS[action]) return state;
  if (!['etch', 'deposit', 'cmp'].includes(action)) return state;

  if (action === 'cmp') {
    const target = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Number(cmpHeight)));
    let changed = 0;
    const terrain = state.terrain.map((row) => row.map((cell) => {
      if (cell.height <= target) return cell;
      changed += 1;
      return {
        ...cell,
        height: target,
        material: target <= BASE_HEIGHT ? 'silicon' : cell.material,
      };
    }));
    if (!changed) {
      return { ...state, message: `CMP found no terrain above height ${target}. No cost charged.` };
    }
    const tool = FAB_TOOLS.cmp;
    const processCost = tool.base + tool.cell * changed;
    return {
      ...state,
      terrain,
      terrainHistory: pushTerrainHistory(state),
      cost: {
        ...state.cost,
        processSteps: state.cost.processSteps + 1,
        manufacturing: state.cost.manufacturing + processCost,
      },
      message: `CMP flattened ${changed} tile${changed === 1 ? '' : 's'} to height ${target}. +${processCost} credits.`,
    };
  }

  const maskedCount = state.terrain.reduce(
    (count, row) => count + row.filter((cell) => cell.masked).length,
    0
  );
  if (!maskedCount) {
    return { ...state, message: `${FAB_TOOLS[action].label} needs a lithography pattern first. Paint tiles on the wafer.` };
  }

  const canChange = action === 'etch'
    ? (cell) => cell.height > MIN_HEIGHT
    : (cell) => cell.height < MAX_HEIGHT;
  const changeCount = state.terrain.reduce(
    (count, row) => count + row.filter((cell) => cell.masked && canChange(cell)).length,
    0
  );
  if (!changeCount) {
    return {
      ...state,
      message: `${FAB_TOOLS[action].label} cannot change the current patterned tiles at their present heights. The mask is still active.`,
    };
  }

  const terrain = state.terrain.map((row) => row.map((cell) => {
    if (!cell.masked) return cell;
    if (action === 'etch') {
      const height = Math.max(MIN_HEIGHT, cell.height - 1);
      return {
        ...cell,
        height,
        material: height <= BASE_HEIGHT ? 'silicon' : cell.material,
        masked: false,
      };
    }
    return {
      ...cell,
      height: Math.min(MAX_HEIGHT, cell.height + 1),
      material: 'deposit',
      masked: false,
    };
  }));

  const tool = FAB_TOOLS[action];
  const processCost = tool.base + tool.cell * maskedCount;
  return {
    ...state,
    terrain,
    terrainHistory: pushTerrainHistory(state),
    cost: {
      ...state.cost,
      processSteps: state.cost.processSteps + 1,
      manufacturing: state.cost.manufacturing + processCost,
    },
    message: `${tool.label} processed ${maskedCount} patterned tile${maskedCount === 1 ? '' : 's'}; ${changeCount} changed height. Lithography pattern cleared. +${processCost} credits.`,
  };
}
