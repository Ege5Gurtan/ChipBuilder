import { SIGNAL_SPEED, cellKey, wireNets, wirePins, wireRoute } from './circuit.js';
import { BASE_HEIGHT, createTerrain, FAB_TOOLS, MAX_HEIGHT, MIN_HEIGHT, terrainCell, terrainHeight } from './terrain.js';

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
  return !gate.wired && Boolean(PASS_THROUGH_GATES[gate.type]);
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
    terrain: level.fabrication?.terrain
      ? createTerrain(level.fabrication.terrain === true ? {} : level.fabrication.terrain)
      : null,
    terrainHistory: [],
    circuit: {
      sources: Object.fromEntries((level.circuit?.sources || []).map((source) => [source.id, null])), packets: [],
      pinOutputs: {}, pinTransfers: 0,
      prebuiltPinCells: circuitPorts(level).map((port) => cellKey(terrainCell(port.x, port.y))),
    },
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
  level.gates.filter((gate) => !isPassThroughGate(gate) && !gate.wired).forEach((gate) => {
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
  const source = circuitPorts(level, state).filter((port) => ['source', 'pin'].includes(port.kind))
    .map((port) => ({ ...port, distance: Math.hypot(state.player.x - port.x, state.player.y - port.y) }))
    .filter((port) => port.distance <= GATE_INPUT_INTERACTION_RADIUS)
    .sort((a, b) => a.distance - b.distance)[0];
  if (source) return loadCircuitSource(level, state, item.id, source.id);
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
  const returned = [];
  Object.keys(sources).filter((id) => id.startsWith('pin-') && !pins.has(id)).forEach((id) => {
    if (sources[id]) returned.push(sources[id]);
    delete sources[id];
  });
  Object.keys(pinOutputs).filter((id) => !pins.has(id)).forEach((id) => {
    if (pinOutputs[id]) returned.push(pinOutputs[id]);
    delete pinOutputs[id];
  });
  return { ...state, cargo: [...state.cargo, ...returned], circuit: { ...state.circuit, sources, pinOutputs },
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
  if (!level.circuit) return [];
  return [
    ...(level.circuit.sources || []).map((source) => ({ ...source, role: 'driver', kind: 'source', label: source.label || 'SRC' })),
    ...level.gates.filter((gate) => gate.wired).flatMap((gate) => [
      ...gate.inputs.map((input) => ({
        id: `${gate.id}:${input.id}`, role: 'receiver', kind: 'gate', gateId: gate.id, inputId: input.id,
        label: `${gate.type} ${input.label}`, ...gateInputPosition(gate, input.id),
      })),
      { id: `${gate.id}:out`, role: 'driver', kind: 'gateOutput', gateId: gate.id, label: `${gate.type} OUT`, ...gateOutputPosition(gate) },
    ]),
    { id: 'destination', role: 'receiver', kind: 'destination', label: 'DEST', ...level.destination },
    ...wirePins(state?.terrain).map((pin) => {
      const hint = level.circuit.pinHints?.find((item) => cellKey(terrainCell(item.x, item.y)) === cellKey(pin));
      const driving = state.circuit.sources[pin.id] || state.circuit.packets.some((packet) => packet.driverId === pin.id);
      return { ...pin, kind: 'pin', role: driving ? 'driver' : 'receiver', label: hint?.label || `W (${pin.col + 1}, ${pin.row + 1})` };
    }),
  ];
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
    const driver = net.drivers.length === 1 && net.drivers[0];
    return { ...net, cycle: driver?.kind === 'gateOutput' && net.receivers.some((port) => port.kind === 'gate' && reaches(port.gateId, driver.gateId)) };
  });
}

export function circuitConnections(level, state) {
  const ports = circuitPorts(level, state);
  const nets = circuitNets(level, state);
  return ports.filter((port) => port.role === 'driver' || port.kind === 'pin').map((port) => {
    const net = nets.find((item) => item.ports.some((entry) => entry.id === port.id));
    const receiving = port.kind === 'pin' && port.role === 'receiver' && net?.drivers.length > 0;
    const receivers = (net?.receivers || []).filter((receiver) => receiver.id !== port.id);
    const ready = Boolean(net && !net.conflict && !net.cycle && (receiving || receivers.length));
    const busy = Boolean(state.circuit.sources[port.id] || state.circuit.pinOutputs[port.id]
      || state.circuit.packets.some((packet) => packet.driverId === port.id || packet.receiver.id === port.id));
    return {
      ...port, ready, canSend: ready && !receiving && !busy,
      reason: port.kind === 'pin' && state.circuit.pinOutputs[port.id]
        ? `Holding bit ${state.circuit.pinOutputs[port.id].value}. Walk over this tungsten pin to collect it.`
        : !net ? 'Open: copper has not reached this pad.'
        : net.conflict ? 'Short: multiple output drivers share this copper. Undo and separate the traces.'
          : net.cycle ? 'Feedback loop: route the output forward to another component or DEST.'
            : receiving ? `Receives from ${net.drivers[0].label}. Walk over this pin to collect a waiting bit.`
              : !receivers.length ? 'Open: this trace does not reach an input pad.'
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
  if (!masked.length) return { ...state, message: 'Pattern a copper tile first, then Deposit Tungsten to create a wire pin. No cost charged.' };
  const supplied = new Set(state.circuit.prebuiltPinCells);
  const candidates = masked.filter((tile) => !supplied.has(cellKey(tile)) && tile.cell.contact !== 'tungsten');
  if (candidates.some(({ cell }) => cell.material !== 'copper' || cell.height !== BASE_HEIGHT)) {
    return { ...state, message: 'Tungsten pins need copper at height 1 beneath every new patterned pin. Fill Copper first. Mask kept; no cost charged.' };
  }
  if (!candidates.length) return { ...state, message: 'These pins already exist. Supplied pads need no tungsten; no cost charged.' };
  const tool = FAB_TOOLS.tungsten, credits = tool.base + candidates.length * tool.cell;
  const keys = new Set(candidates.map(cellKey));
  return {
    ...state,
    terrain: state.terrain.map((cells, row) => cells.map((cell, col) => ({ ...cell, masked: false,
      ...(keys.has(cellKey({ col, row })) ? { contact: 'tungsten' } : {}) }))),
    terrainHistory: pushTerrainHistory(state),
    cost: { ...state.cost, processSteps: state.cost.processSteps + 1, manufacturing: state.cost.manufacturing + credits },
    message: `Created ${candidates.length} tungsten wire pin${candidates.length === 1 ? '' : 's'}. Select a cargo bit and click a pin to send; walk over a receiving pin to collect. +${credits} credits.`,
  };
}

function collectPinOutputs(level, state) {
  return wirePins(state.terrain).reduce((current, pin) => {
    const bit = current.circuit.pinOutputs[pin.id];
    if (!bit || Math.hypot(current.player.x - pin.x, current.player.y - pin.y) > PICKUP_RADIUS) return current;
    const pinOutputs = { ...current.circuit.pinOutputs }; delete pinOutputs[pin.id];
    return { ...current, cargo: [...current.cargo, bit], circuit: { ...current.circuit, pinOutputs },
      cost: { ...current.cost, energy: current.cost.energy + 1 }, message: `Collected tungsten pin output ${bit.value}. Carry it to DEST or send it into another wire.` };
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
    message: `${receiver.label} received ${bit.value}. Walk over this tungsten pin to collect it.` };

  if (receiver.kind === 'gate') {
    return depositCargo(level, { ...state, cargo: [...state.cargo, bit] }, bit.id, { ...receiver, viaWire: true });
  }
  const index = state.targetSlots.findIndex((slot) => !slot.delivered);
  const accepted = index >= 0 && state.targetSlots[index].value === bit.value;
  const targetSlots = state.targetSlots.map((slot, i) => i === index && accepted ? { ...slot, delivered: true } : slot);
  const complete = targetSlots.every((slot) => slot.delivered);
  return {
    ...state,
    targetSlots,
    cargo: accepted ? state.cargo : [...state.cargo, bit],
    status: complete ? 'success' : state.status,
    feedback: { kind: accepted ? 'accept' : 'reject', seq: (state.feedback?.seq || 0) + 1 },
    cost: { ...state.cost, energy: state.cost.energy + 1 },
    message: complete ? `Signal ${level.target} delivered through copper. Route complete.`
      : accepted ? `DEST accepted ${bit.value}. Complete the remaining target slots.`
        : `DEST expected ${state.targetSlots[index]?.value ?? 'no more bits'}, received ${bit.value}. Rejected bit returned to cargo.`,
  };
}

// Called independently of carrier movement. State owns transport; Three.js only draws packets.
export function advanceCircuit(level, state, delta) {
  if (!level.circuit || state.status !== 'playing' || !Number.isFinite(delta) || delta <= 0) return state;
  const pendingDriver = Object.values(state.circuit.sources).some(Boolean)
    || level.gates.some((gate) => gate.wired && state.gateState[gate.id].pendingOutput);
  if (!state.circuit.packets.length && !pendingDriver) return collectPinOutputs(level, state);
  const packets = state.circuit.packets.map((packet) => ({ ...packet, progress: packet.progress + delta * SIGNAL_SPEED }));
  const arriving = packets.filter((packet) => packet.progress >= Math.max(1, packet.route.length - 1));
  let next = state.circuit.packets.length
    ? { ...state, circuit: { ...state.circuit, packets: packets.filter((packet) => !arriving.includes(packet)) } }
    : state;
  arriving.forEach((packet) => { next = receiveCircuitBit(level, next, packet); });
  if (next.status !== 'playing') return next;

  const nets = circuitNets(level, next);
  nets.forEach((net) => {
    if (net.conflict || net.cycle || net.drivers.length !== 1 || !net.receivers.length) return;
    const driver = net.drivers[0];
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
