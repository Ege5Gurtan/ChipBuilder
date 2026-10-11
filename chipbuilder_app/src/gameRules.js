import { SIGNAL_SPEED, cellKey, wireNets, wirePins, wireRoute } from './circuit.js';
import { BASE_HEIGHT, createTerrain, FAB_TOOLS, MAX_HEIGHT, MIN_HEIGHT, terrainCell, terrainHeight } from './terrain.js';

export const PLAYER_RADIUS = 0.34;
export const PICKUP_RADIUS = 0.62;
export const DESTINATION_RADIUS = 0.72;
export const GATE_INPUT_INTERACTION_RADIUS = 0.92;
const DROP_DISTANCE = 0.45;

// Unary gates transform carried cargo automatically when the carrier crosses them.
const PASS_THROUGH_GATES = { NOT: (value) => (value === 0 ? 1 : 0) };
const GATE_FOOTPRINTS = { NOT: { width: 1.75, height: 1.35 }, AND: { width: 2.15, height: 1.35 }, OR: { width: 2.15, height: 1.35 } };

export const SANDBOX_GATE_TYPES = ['NOT', 'AND', 'OR'];

const SANDBOX_GATE_BLUEPRINTS = {
  NOT: { type: 'NOT' },
  AND: { type: 'AND', inputs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
  OR: { type: 'OR', inputs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
};

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
  return !gate.wired && Boolean(PASS_THROUGH_GATES[gate.type]);
}

export function applyGateToCargo(gateType, cargo) {
  const transform = PASS_THROUGH_GATES[gateType];
  if (!transform) return cargo;
  return cargo.map((item) => ({ ...item, value: transform(item.value) }));
}

export function placeSandboxGate(level, state, type, position) {
  const blueprint = SANDBOX_GATE_BLUEPRINTS[type];
  if (!level.sandbox || state.status !== 'playing' || !blueprint || !position) return state;

  const sequence = state.nextGateId || 1;
  const gate = {
    id: `sandbox-${type.toLowerCase()}-${sequence}`,
    type: blueprint.type,
    ...(blueprint.inputs ? { inputs: blueprint.inputs.map((input) => ({ ...input })) } : {}),
    x: Math.round(position.x * 4) / 4,
    y: Math.round(position.y * 4) / 4,
  };
  const { width, height } = gateFootprint(gate);
  const portMargin = 0.55;
  const outsideWafer = gate.x - width / 2 - portMargin < -5.65
    || gate.x + width / 2 + portMargin > 5.65
    || gate.y - height / 2 - portMargin < -4.15
    || gate.y + height / 2 + portMargin > 4.15;
  if (outsideWafer) {
    return { ...state, message: `Move the ${type} gate farther inside the wafer so its body and ports fit.` };
  }

  const existing = [...(level.gates || []), ...(state.placedGates || [])];
  const overlaps = existing.some((other) => {
    const otherSize = gateFootprint(other);
    return Math.abs(gate.x - other.x) < (width + otherSize.width) / 2 + 0.35
      && Math.abs(gate.y - other.y) < (height + otherSize.height) / 2 + 0.35;
  });
  if (overlaps) {
    return { ...state, message: `That spot overlaps another gate. Drop the ${type} gate somewhere else.` };
  }

  return {
    ...state,
    placedGates: [...(state.placedGates || []), gate],
    nextGateId: sequence + 1,
    gateState: {
      ...state.gateState,
      [gate.id]: { inputs: {}, output: null, pendingOutput: null, inside: false, activations: 0 },
    },
    message: type === 'NOT'
      ? 'NOT gate placed. Carry a bit through it to invert the cargo.'
      : `${type} gate placed. Load A and B from cargo, then collect the result at OUT.`,
  };
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
    placedGates: [],
    nextGateId: 1,
    gateState: Object.fromEntries(
      level.gates.map((gate) => [gate.id, { inputs: {}, output: null, pendingOutput: null, inside: false, activations: 0 }])
    ),
    fabrication: { patterned: false, etched: false },
    terrain: level.fabrication?.terrain
      ? createTerrain(level.fabrication.terrain === true ? {} : level.fabrication.terrain)
      : null,
    terrainHistory: [],
    circuit: {
      sources: Object.fromEntries((level.circuit?.sources || []).map((source) => [source.id, null])), packets: [],
      pinOutputs: {}, pinTransfers: 0, pinVoltages: {},
      prebuiltPinCells: circuitPorts(level).map((port) => cellKey(terrainCell(port.x, port.y))),
    },
    cost: { processSteps: 0, energy: 0, manufacturing: 0 },
    status: 'playing',
    message: level.sandbox
      ? 'Sandbox online. Every process is unlocked; experiment freely and restart whenever you want a clean wafer.'
      : 'Carrier online. Follow the goal and deliver the exact target signal.',
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
  const next = applyPassThroughGates(level, collectPinOutputs(level, collectGateOutputs(level, collectBits({ ...state, player }))));
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
  if (level.circuit?.requirePinTransfer && !state.circuit.pinTransfers) {
    return { ...state, message: 'Send the bit through copper to a tungsten output pin before delivering it.' };
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
  const sandboxComplete = complete && level.sandbox;
  const nextTargetSlots = sandboxComplete
    ? targetSlots.map((slot) => ({ ...slot, delivered: false }))
    : targetSlots;
  const rejected = Math.min(state.cargo.length, openSlots.length) - acceptedIds.size;
  const signal = targetSlots.map((slot) => (slot.delivered ? slot.value : '_')).join(' ');

  return {
    ...state,
    cargo,
    targetSlots: nextTargetSlots,
    feedback: { kind: complete || !rejected ? 'accept' : 'partial', seq },
    cost: { ...state.cost, energy: state.cost.energy + acceptedIds.size },
    status: complete && !level.sandbox ? 'success' : state.status,
    message: sandboxComplete
      ? `Sandbox check passed: signal ${level.target} is correct. Target reset so you can keep experimenting.`
      : complete
        ? `Signal ${level.target} complete. Every target slot received the correct bit.`
        : `Accepted ${acceptedIds.size} bit${acceptedIds.size === 1 ? '' : 's'}. Signal: ${signal}.${rejected ? ` ${rejected} mismatching bit${rejected === 1 ? '' : 's'} stayed in cargo.` : ''}`,
  };
}

export function dropCargoBit(level, state, cargoId) {
  if (state.status !== 'playing' || !state.cargo.length) return state;
  const item = state.cargo.find((bit) => bit.id === cargoId) || state.cargo[state.cargo.length - 1];

  // K always drops the bit physically. If that drop lands on a simple two-port copper net,
  // the copper accepts the bit immediately and transports it toward the valid opposite socket.
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const spot = directions
    .map(([dx, dy]) => {
      const length = Math.hypot(dx, dy);
      return clampToWafer({ x: state.player.x + dx / length * DROP_DISTANCE, y: state.player.y + dy / length * DROP_DISTANCE });
    })
    .find((position) => isWalkable(level, state, position)) || { ...state.player };

  const playerCell = terrainCell(state.player.x, state.player.y);
  const spotCell = terrainCell(spot.x, spot.y);
  const playerOnCopper = state.terrain?.[playerCell.row]?.[playerCell.col]?.material === 'copper'
    && state.terrain[playerCell.row][playerCell.col].height === BASE_HEIGHT;
  const spotOnCopper = state.terrain?.[spotCell.row]?.[spotCell.col]?.material === 'copper'
    && state.terrain[spotCell.row][spotCell.col].height === BASE_HEIGHT;
  const injected = injectDroppedBitOnCopper(level, state, item, playerOnCopper ? state.player : spotOnCopper ? spot : null);
  if (injected) return injected;

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
  if (type === 'NOT') return values[0] === 0 ? 1 : 0;
  if (type === 'OR') return values.some((value) => value === 1) ? 1 : 0;
  if (type === 'AND') return values.every((value) => value === 1) ? 1 : 0;
  return null;
}

export function depositCargo(level, state, cargoId, target) {
  if (state.status !== 'playing') return state;
  const cargo = state.cargo.find((item) => item.id === cargoId);
  if (!cargo) return state;

  if (target.kind === 'source') return loadCircuitSource(level, state, cargoId, target.sourceId);
  const gate = level.gates.find((item) => item.id === target.gateId);
  if (!gate || isPassThroughGate(gate) || (gate.wired && !target.viaWire)) return state;
  const input = gate.inputs?.find((item) => item.id === target.inputId);
  const currentGate = state.gateState[gate.id];
  if (!input || currentGate.inputs[input.id] !== undefined) return state;

  if (currentGate.pendingOutput) {
    return { ...state, message: gate.wired ? `${gate.type} OUT is occupied. Collect the waiting bit or complete its copper connection before sending another bit.` : `${gate.type} OUT is occupied. Collect the output bit before loading another pair.` };
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
    message: `${gate.type} consumed ${gate.inputs.map((item) => `${item.label}=${inputs[item.id].value}`).join(', ')} and produced ${output} at OUT. ${gate.wired ? 'Walk over OUT to collect it, or complete a copper route for automatic forwarding.' : 'Walk over the output bit to collect it.'}`,
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
    cost: { processSteps: state.cost.processSteps, manufacturing: state.cost.manufacturing },
  };
}

function pushTerrainHistory(state) {
  return [...state.terrainHistory.slice(-39), terrainSnapshot(state)];
}

// Fabrication must never destroy a queued or received finite token.
function reconcilePinTokens(state) {
  const pins = new Set(wirePins(state.terrain).map((pin) => pin.id));
  const sources = { ...state.circuit.sources }, pinOutputs = { ...state.circuit.pinOutputs };
  const pinVoltages = Object.fromEntries(
    Object.entries(state.circuit.pinVoltages || {}).filter(([id]) => pins.has(id))
  );
  const returned = [];
  Object.keys(sources).filter((id) => id.startsWith('pin-') && !pins.has(id)).forEach((id) => {
    if (sources[id]) returned.push(sources[id]);
    delete sources[id];
  });
  Object.keys(pinOutputs).filter((id) => !pins.has(id)).forEach((id) => {
    if (pinOutputs[id]) returned.push(pinOutputs[id]);
    delete pinOutputs[id];
  });
  return { ...state, cargo: [...state.cargo, ...returned], circuit: { ...state.circuit, sources, pinOutputs, pinVoltages },
    message: returned.length ? `${state.message} Removed pin's bit returned to cargo.` : state.message };
}

export function undoTerrainEdit(state) {
  if (state.status !== 'playing' || !state.terrainHistory?.length) return state;
  if (state.circuit.packets.length) return { ...state, message: 'Wait for the signal to arrive before undoing fabrication.' };
  const previous = state.terrainHistory[state.terrainHistory.length - 1];
  return reconcilePinTokens({
    ...state,
    terrain: previous.terrain,
    cost: { ...state.cost, ...previous.cost },
    terrainHistory: state.terrainHistory.slice(0, -1),
    message: 'Undid the last fabrication action.',
  });
}

export function fabricateCell(state, action, col, row, newStroke) {
  if (!canFabricateCell(state, action, col, row)) return state;
  if (state.circuit.packets.length) return { ...state, message: 'Wait for the signal to arrive before editing its route.' };
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
  const next = processTerrain(state, action, cmpHeight);
  return next.terrain !== state.terrain ? reconcilePinTokens(next) : next;
}

function processTerrain(state, action, cmpHeight) {
  if (state.status !== 'playing' || !state.terrain || !FAB_TOOLS[action]) return state;
  if (state.circuit.packets.length) return { ...state, message: 'Wait for the signal to arrive before editing its route.' };
  if (action === 'copper') return fillCopper(state);
  if (action === 'tungsten') return depositTungsten(state);
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
        contact: null,
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
        contact: null,
        material: height <= BASE_HEIGHT ? 'silicon' : cell.material,
        masked: false,
      };
    }
    return {
      ...cell,
      height: Math.min(MAX_HEIGHT, cell.height + 1),
      material: 'deposit',
      contact: null,
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

export function circuitPorts(level, state) {
  if (!level.circuit && !level.sandbox) return [];
  const staticPorts = level.circuit ? [
    ...(level.circuit.sources || []).map((source) => ({ ...source, role: 'driver', kind: 'source', label: source.label || 'SRC' })),
    ...level.gates.filter((gate) => gate.wired).flatMap((gate) => [
      ...gate.inputs.map((input) => ({
        id: `${gate.id}:${input.id}`, role: 'receiver', kind: 'gate', gateId: gate.id, inputId: input.id,
        label: `${gate.type} ${input.label}`, ...gateInputPosition(gate, input.id),
      })),
      { id: `${gate.id}:out`, role: 'driver', kind: 'gateOutput', gateId: gate.id, label: `${gate.type} OUT`, ...gateOutputPosition(gate) },
    ]),
    { id: 'destination', role: 'receiver', kind: 'destination', label: 'DEST', ...level.destination },
  ] : [];

  return [
    ...staticPorts,
    ...wirePins(state?.terrain).map((pin) => {
      const hint = level.circuit?.pinHints?.find((item) => cellKey(terrainCell(item.x, item.y)) === cellKey(pin));
      const voltage = state?.circuit?.pinVoltages?.[pin.id] || null;
      const driving = state?.circuit?.sources?.[pin.id] || state?.circuit?.packets?.some((packet) => packet.driverId === pin.id);
      const role = level.sandbox
        ? voltage === 'high' ? 'driver' : voltage === 'low' ? 'receiver' : 'neutral'
        : driving ? 'driver' : 'receiver';
      return { ...pin, kind: 'pin', role, voltage, label: hint?.label || `W (${pin.col + 1}, ${pin.row + 1})` };
    }),
  ];
}

export function setPinVoltage(level, state, pinId, voltage) {
  if (!level.sandbox || !['high', 'low'].includes(voltage) || state.status !== 'playing') return state;
  const pin = wirePins(state.terrain).find((item) => item.id === pinId);
  if (!pin) return { ...state, message: 'That tungsten contact no longer exists.' };
  if (state.circuit.packets.some((packet) => packet.driverId === pinId || packet.receiver.id === pinId)) {
    return { ...state, message: 'Wait for the moving bit to arrive before changing this contact voltage.' };
  }
  return {
    ...state,
    circuit: {
      ...state.circuit,
      pinVoltages: { ...(state.circuit.pinVoltages || {}), [pinId]: voltage },
    },
    message: `${pinId} set to ${voltage === 'high' ? 'High' : 'Low'} voltage. A bit on a connected High contact will move toward a Low contact.`,
  };
}

function circuitDriverActive(state, port) {
  const inFlight = state.circuit.packets.some((packet) => packet.driverId === port.id);
  if (port.kind === 'source' || port.kind === 'pin') return Boolean(state.circuit.sources[port.id]) || inFlight;
  if (port.kind === 'gateOutput') return Boolean(state.gateState[port.gateId]?.pendingOutput) || inFlight;
  return false;
}

function circuitNets(level, state) {
  const nets = wireNets(state.terrain, circuitPorts(level, state));
  const edges = new Map();
  nets.forEach((net) => {
    const driver = net.drivers.length === 1 && net.drivers[0];
    if (driver?.kind !== 'gateOutput') return;
    edges.set(driver.gateId, net.receivers.filter((port) => port.kind === 'gate').map((port) => port.gateId));
  });
  const reaches = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (edges.get(from) || []).some((gateId) => reaches(gateId, target, seen));
  };
  return nets.map((net) => {
    const fixedDrivers = net.drivers.filter((port) => port.kind !== 'pin');
    const activeDrivers = net.ports.filter((port) => circuitDriverActive(state, port));
    const fixedConflict = fixedDrivers.length > 1;
    return {
      ...net,
      activeDrivers,
      fixedConflict,
      conflict: fixedConflict || activeDrivers.length > 1,
      cycle: net.drivers.some((driver) => driver.kind === 'gateOutput'
        && net.receivers.some((port) => port.kind === 'gate' && reaches(port.gateId, driver.gateId))),
    };
  });
}

function wireDropEndpoints(net, state, position) {
  if (net.ports.length !== 2 || net.conflict || net.cycle || net.activeDrivers.length) return null;
  const [a, b] = net.ports;
  const sourceOnly = (port) => ['source', 'gateOutput'].includes(port.kind);
  const receiverOnly = (port) => ['gate', 'destination'].includes(port.kind);
  const pin = (port) => port.kind === 'pin';
  let entry = null, receiver = null;

  if (sourceOnly(a) && (receiverOnly(b) || pin(b))) { entry = a; receiver = b; }
  else if (sourceOnly(b) && (receiverOnly(a) || pin(a))) { entry = b; receiver = a; }
  else if (pin(a) && receiverOnly(b)) { entry = a; receiver = b; }
  else if (pin(b) && receiverOnly(a)) { entry = b; receiver = a; }
  else if (pin(a) && pin(b)) {
    const distanceA = Math.hypot(position.x - a.x, position.y - a.y);
    const distanceB = Math.hypot(position.x - b.x, position.y - b.y);
    entry = distanceA <= distanceB ? a : b;
    receiver = entry.id === a.id ? b : a;
  }

  if (!entry || !receiver || !receiverAvailable(state, receiver)) return null;
  if (entry.kind === 'pin' && state.circuit.pinOutputs[entry.id]) return null;
  return { entry, receiver };
}

function sandboxVoltageEndpoints(net, state) {
  const pins = net.ports.filter((port) => port.kind === 'pin');
  const high = pins.filter((port) => state.circuit.pinVoltages?.[port.id] === 'high');
  const low = pins.filter((port) => state.circuit.pinVoltages?.[port.id] === 'low');
  if (high.length !== 1 || low.length !== 1) return null;
  if (!receiverAvailable(state, low[0])) return null;
  return { entry: high[0], receiver: low[0] };
}

function sandboxPacketForBit(level, state, bit, position) {
  if (!level.sandbox || !position || !state.terrain) return null;
  const cell = terrainCell(position.x, position.y);
  const net = circuitNets(level, state).find((item) => item.cells.has(cellKey(cell)));
  if (!net) return null;
  const endpoints = sandboxVoltageEndpoints(net, state);
  if (!endpoints) return null;
  const route = wireRoute(net, position, endpoints.receiver);
  if (!route.length) return null;
  return {
    id: `${bit.id}->${endpoints.receiver.id}`,
    bit: { id: `${bit.id}->${endpoints.receiver.id}`, value: bit.value },
    driverId: endpoints.entry.id,
    receiver: endpoints.receiver,
    route,
    progress: 0,
  };
}

function injectDroppedBitOnCopper(level, state, bit, position) {
  if (!position || (!level.circuit && !level.sandbox) || !state.terrain) return null;

  if (level.sandbox) {
    const packet = sandboxPacketForBit(level, state, bit, position);
    if (!packet) return null;
    return {
      ...state,
      cargo: state.cargo.filter((item) => item.id !== bit.id),
      circuit: { ...state.circuit, packets: [...state.circuit.packets, packet] },
      cost: { ...state.cost, energy: state.cost.energy + 1 },
      message: `Bit ${bit.value} is moving along copper toward the Low voltage contact.`,
    };
  }

  const cell = terrainCell(position.x, position.y);
  const net = circuitNets(level, state).find((item) => item.cells.has(cellKey(cell)));
  if (!net) return null;
  const endpoints = wireDropEndpoints(net, state, position);
  if (!endpoints) return null;
  const route = wireRoute(net, position, endpoints.receiver);
  if (!route.length) return null;

  const packet = {
    id: `${bit.id}->${endpoints.receiver.id}`,
    bit: { id: `${bit.id}->${endpoints.receiver.id}`, value: bit.value },
    driverId: endpoints.entry.id,
    receiver: endpoints.receiver,
    route,
    progress: 0,
  };
  return {
    ...state,
    cargo: state.cargo.filter((item) => item.id !== bit.id),
    circuit: { ...state.circuit, packets: [...state.circuit.packets, packet] },
    cost: { ...state.cost, energy: state.cost.energy + 1 },
    message: `Dropped ${bit.value} onto copper. The wire accepted it and is carrying it toward ${endpoints.receiver.label}.`,
  };
}

function energizeSandboxWorldBits(level, state) {
  if (!level.sandbox || !state.worldBits.length) return state;
  return [...state.worldBits].reduce((current, bit) => {
    if (!current.worldBits.some((item) => item.id === bit.id)) return current;
    const packet = sandboxPacketForBit(level, current, bit, bit);
    if (!packet) return current;
    return {
      ...current,
      worldBits: current.worldBits.filter((item) => item.id !== bit.id),
      circuit: { ...current.circuit, packets: [...current.circuit.packets, packet] },
      cost: { ...current.cost, energy: current.cost.energy + 1 },
      message: `Bit ${bit.value} is moving along copper toward the Low voltage contact.`,
    };
  }, state);
}

export function circuitConnections(level, state) {
  const ports = circuitPorts(level, state);
  const nets = circuitNets(level, state);
  return ports.filter((port) => port.role === 'driver' || port.kind === 'pin').map((port) => {
    const net = nets.find((item) => item.ports.some((entry) => entry.id === port.id));
    const activeOtherDrivers = (net?.activeDrivers || []).filter((driver) => driver.id !== port.id);
    const receiving = port.kind === 'pin' && port.role === 'receiver' && activeOtherDrivers.length === 1;
    const receivers = (net?.receivers || []).filter((receiver) => receiver.id !== port.id);
    const ready = Boolean(net && !net.conflict && !net.cycle && (receiving || receivers.length));
    const busy = Boolean(state.circuit.sources[port.id] || state.circuit.pinOutputs[port.id]
      || state.circuit.packets.some((packet) => packet.driverId === port.id || packet.receiver.id === port.id));
    return {
      ...port, ready, canSend: ready && !receiving && !busy,
      reason: port.kind === 'pin' && state.circuit.pinOutputs[port.id]
        ? `Holding bit ${state.circuit.pinOutputs[port.id].value}. Walk over this tungsten pin to collect it.`
        : !net ? 'Open: copper has not reached this pad.'
        : net.fixedConflict ? 'Short: multiple built-in output drivers share this copper. Separate the traces.'
          : net.conflict ? 'Short: more than one active driver is sending onto this copper. Wait, reclaim a bit, or separate the traces.'
            : net.cycle ? 'Feedback loop: route the output forward to another component or DEST.'
            : receiving ? `Receives from ${activeOtherDrivers[0].label}. Walk over this pin to collect a waiting bit.`
              : !receivers.length ? 'Open: this trace does not reach another receiving pin or input.'
                : `Connected to ${receivers.map((receiver) => receiver.label).join(', ')}.`,
    };
  });
}

export function loadCircuitSource(level, state, cargoId, sourceId) {
  if (state.status !== 'playing') return state;
  const port = circuitPorts(level, state).find((entry) => entry.id === sourceId && ['source', 'pin'].includes(entry.kind));
  if (!port) return { ...state, message: 'This wire has no pin yet. Pattern a copper tile and Deposit Tungsten. Bit stays in cargo.' };
  const bit = state.cargo.find((item) => item.id === cargoId);
  if (!bit) return state;
  const connection = circuitConnections(level, state).find((entry) => entry.id === sourceId);
  if (!connection.canSend) return { ...state, message: `${connection.reason} This pin cannot send now. Bit stays in cargo.` };
  return {
    ...state,
    cargo: state.cargo.filter((item) => item.id !== cargoId),
    circuit: { ...state.circuit, sources: { ...state.circuit.sources, [sourceId]: bit } },
    message: `${port.label} loaded with ${bit.value}. The pin drives copper toward connected inputs.`,
  };
}

export function reclaimCircuitSource(state, sourceId) {
  const bit = state.circuit.sources[sourceId];
  if (!bit || state.status !== 'playing') return state;
  return {
    ...state, cargo: [...state.cargo, bit],
    circuit: { ...state.circuit, sources: { ...state.circuit.sources, [sourceId]: null } },
    message: `SRC bit ${bit.value} returned to cargo.`,
  };
}

function depositTungsten(state) {
  const masked = state.terrain.flatMap((cells, row) => cells.flatMap((cell, col) => cell.masked ? [{ cell, col, row }] : []));
  if (!masked.length) return { ...state, message: 'Pattern any wafer tile first, then Deposit Tungsten. Only tungsten on flush copper becomes an electrical pin.' };
  const supplied = new Set(state.circuit.prebuiltPinCells);
  const candidates = masked.filter((tile) => !supplied.has(cellKey(tile)) && tile.cell.contact !== 'tungsten');
  if (!candidates.length) return { ...state, message: 'These locations already have contacts or supplied pads. No tungsten deposited and no process cost charged.' };
  const functional = candidates.filter(({ cell }) => cell.material === 'copper' && cell.height === BASE_HEIGHT);
  const functionalKeys = new Set(functional.map(cellKey));
  const keys = new Set(candidates.map(cellKey));
  const tool = FAB_TOOLS.tungsten, credits = tool.base + candidates.length * tool.cell;
  const badCount = candidates.length - functional.length;
  const result = functional.length
    ? `${functional.length} functional pin${functional.length === 1 ? '' : 's'} created`
    : 'No functional pins created';
  const warning = badCount
    ? ` ${badCount} tungsten deposit${badCount === 1 ? '' : 's'} landed on non-copper or non-flush material and are electrically inactive.`
    : '';
  return {
    ...state,
    terrain: state.terrain.map((cells, row) => cells.map((cell, col) => {
      const key = cellKey({ col, row });
      if (!cell.masked) return cell;
      if (!keys.has(key)) return { ...cell, masked: false };
      return { ...cell, contact: 'tungsten', contactFunctional: functionalKeys.has(key), masked: false };
    })),
    terrainHistory: pushTerrainHistory(state),
    cost: { ...state.cost, processSteps: state.cost.processSteps + 1, manufacturing: state.cost.manufacturing + credits },
    message: `Deposited tungsten on ${candidates.length} tile${candidates.length === 1 ? '' : 's'}: ${result}.${warning} +${credits} credits.`,
  };
}

function collectPinOutputs(level, state) {
  return wirePins(state.terrain).reduce((current, pin) => {
    const bit = current.circuit.pinOutputs[pin.id];
    if (!bit || Math.hypot(current.player.x - pin.x, current.player.y - pin.y) > PICKUP_RADIUS) return current;
    const pinOutputs = { ...current.circuit.pinOutputs }; delete pinOutputs[pin.id];
    return { ...current, cargo: [...current.cargo, bit], circuit: { ...current.circuit, pinOutputs },
      cost: { ...current.cost, energy: current.cost.energy + 1 },
      message: level.sandbox
        ? `Collected bit ${bit.value} from the Low voltage tungsten contact.`
        : `Collected tungsten pin output ${bit.value}. Carry it to DEST or send it into another wire.` };
  }, state);
}

function fillCopper(state) {
  const count = state.terrain.flat().filter((cell) => cell.height === MIN_HEIGHT).length;
  if (!count) return { ...state, message: 'Copper needs etched trenches at height 0. Paint a connected route and Etch it first. No cost charged.' };
  const tool = FAB_TOOLS.copper, credits = tool.base + count * tool.cell;
  return {
    ...state,
    terrain: state.terrain.map((row) => row.map((cell) => cell.height === MIN_HEIGHT
      ? { ...cell, height: BASE_HEIGHT, material: 'copper', contact: null, masked: false } : cell)),
    terrainHistory: pushTerrainHistory(state),
    cost: { ...state.cost, processSteps: state.cost.processSteps + 1, manufacturing: state.cost.manufacturing + credits },
    message: `Filled ${count} trench tiles with copper. Contacts connect automatically where copper reaches a pad. +${credits} credits.`,
  };
}

function receiverAvailable(state, port) {
  if (state.circuit.packets.some((packet) => packet.receiver.id === port.id)) return false;
  if (port.kind === 'destination') return state.targetSlots.some((slot) => !slot.delivered);
  if (port.kind === 'pin') return !state.circuit.pinOutputs[port.id];
  const gate = state.gateState[port.gateId];
  return Boolean(gate && !gate.pendingOutput && !gate.inputs[port.inputId]);
}

function receiveCircuitBit(level, state, packet) {
  const { receiver, bit } = packet;
  if (receiver.kind === 'pin') return { ...state,
    circuit: { ...state.circuit, pinOutputs: { ...state.circuit.pinOutputs, [receiver.id]: bit }, pinTransfers: state.circuit.pinTransfers + 1 },
    message: level.sandbox
      ? `Bit ${bit.value} reached the Low voltage tungsten contact.`
      : `${receiver.label} received ${bit.value}. Walk over this tungsten pin to collect it.` };

  if (receiver.kind === 'gate') {
    return depositCargo(level, { ...state, cargo: [...state.cargo, bit] }, bit.id, { ...receiver, viaWire: true });
  }
  const index = state.targetSlots.findIndex((slot) => !slot.delivered);
  const accepted = index >= 0 && state.targetSlots[index].value === bit.value;
  const targetSlots = state.targetSlots.map((slot, i) => i === index && accepted ? { ...slot, delivered: true } : slot);
  const complete = targetSlots.every((slot) => slot.delivered);
  const sandboxComplete = complete && level.sandbox;
  const nextTargetSlots = sandboxComplete
    ? targetSlots.map((slot) => ({ ...slot, delivered: false }))
    : targetSlots;
  return {
    ...state,
    targetSlots: nextTargetSlots,
    cargo: accepted ? state.cargo : [...state.cargo, bit],
    status: complete && !level.sandbox ? 'success' : state.status,
    feedback: { kind: accepted ? 'accept' : 'reject', seq: (state.feedback?.seq || 0) + 1 },
    cost: { ...state.cost, energy: state.cost.energy + 1 },
    message: sandboxComplete ? `Sandbox check passed: signal ${level.target} arrived through copper. Target reset for another test.`
      : complete ? `Signal ${level.target} delivered through copper. Route complete.`
        : accepted ? `DEST accepted ${bit.value}. Complete the remaining target slots.`
          : `DEST expected ${state.targetSlots[index]?.value ?? 'no more bits'}, received ${bit.value}. Rejected bit returned to cargo.`,
  };
}

// Called independently of carrier movement. State owns transport; Three.js only draws packets.
export function advanceCircuit(level, state, delta) {
  if ((!level.circuit && !level.sandbox) || state.status !== 'playing' || !Number.isFinite(delta) || delta <= 0) return state;
  let energized = level.sandbox ? energizeSandboxWorldBits(level, state) : state;
  const pendingDriver = Object.values(energized.circuit.sources).some(Boolean)
    || level.gates.some((gate) => gate.wired && energized.gateState[gate.id].pendingOutput);
  if (!energized.circuit.packets.length && !pendingDriver) return collectPinOutputs(level, energized);
  const packets = energized.circuit.packets.map((packet) => ({ ...packet, progress: packet.progress + delta * SIGNAL_SPEED }));
  const arriving = packets.filter((packet) => packet.progress >= Math.max(1, packet.route.length - 1));
  let next = energized.circuit.packets.length
    ? { ...energized, circuit: { ...energized.circuit, packets: packets.filter((packet) => !arriving.includes(packet)) } }
    : energized;
  arriving.forEach((packet) => { next = receiveCircuitBit(level, next, packet); });
  if (next.status !== 'playing') return next;

  const nets = circuitNets(level, next);
  nets.forEach((net) => {
    if (net.conflict || net.cycle || net.activeDrivers.length !== 1 || !net.receivers.length) return;
    const driver = net.activeDrivers[0];
    const bit = ['source', 'pin'].includes(driver.kind) ? next.circuit.sources[driver.id] : next.gateState[driver.gateId].pendingOutput;
    if (!bit || !net.receivers.every((receiver) => receiverAvailable(next, receiver))) return;
    // Fan-out creates one copy per connected input, exactly once for this finite source token.
    const outgoing = net.receivers.map((receiver) => ({
      id: `${bit.id}->${receiver.id}`,
      bit: { id: `${bit.id}->${receiver.id}`, value: bit.value },
      driverId: driver.id, receiver, route: wireRoute(net, driver, receiver), progress: 0,
    }));
    next = {
      ...next,
      circuit: {
        ...next.circuit,
        sources: ['source', 'pin'].includes(driver.kind) ? { ...next.circuit.sources, [driver.id]: null } : next.circuit.sources,
        packets: [...next.circuit.packets, ...outgoing],
      },
      gateState: driver.kind === 'gateOutput'
        ? { ...next.gateState, [driver.gateId]: { ...next.gateState[driver.gateId], pendingOutput: null } } : next.gateState,
      cost: { ...next.cost, energy: next.cost.energy + outgoing.length },
      message: `${driver.label} sent ${bit.value} through copper to ${net.receivers.map((port) => port.label).join(', ')}.`,
    };
  });
  return collectPinOutputs(level, collectGateOutputs(level, next));
}
