import levels from './levels.js';
import { advanceCircuit, applyTerrainProcess, circuitConnections, circuitPorts, createGame, depositCargo, dropCargoBit, fabricateCell, gateInputPosition, gateOutputPosition, placeSandboxGate, setPinRole } from './gameRules.js';
import { cellPosition } from './circuit.js';
import { BASE_HEIGHT, terrainCell } from './terrain.js';

const sandbox = levels.find((item) => item.sandbox);

function pathCells(from, to, viaRow = null) {
  const cells = [];
  let col = from.col;
  let row = from.row;
  const add = () => cells.push({ col, row });
  add();
  const moveRow = (target) => {
    while (row !== target) {
      row += Math.sign(target - row);
      add();
    }
  };
  const moveCol = (target) => {
    while (col !== target) {
      col += Math.sign(target - col);
      add();
    }
  };
  if (viaRow !== null) {
    moveRow(viaRow);
    moveCol(to.col);
    moveRow(to.row);
  } else {
    moveCol(to.col);
    moveRow(to.row);
  }
  return cells;
}

function addCopper(state, cells) {
  const terrain = state.terrain.map((row) => row.map((cell) => ({ ...cell })));
  cells.forEach(({ col, row }) => {
    terrain[row][col] = {
      ...terrain[row][col],
      height: BASE_HEIGHT,
      material: 'copper',
      contact: null,
      masked: false,
    };
  });
  return { ...state, terrain };
}

function buildNotFeedback(count) {
  const xs = count === 3 ? [-3, 0, 3] : [-2, 2];
  let state = createGame(sandbox);
  xs.forEach((x) => {
    state = placeSandboxGate(sandbox, state, 'NOT', { x, y: 0 });
  });
  const gates = state.placedGates;
  const activeLevel = { ...sandbox, gates: [...(sandbox.gates || []), ...gates] };
  const cells = [];
  for (let index = 0; index < gates.length - 1; index += 1) {
    const from = terrainCell(gateOutputPosition(gates[index]).x, gateOutputPosition(gates[index]).y);
    const to = terrainCell(gateInputPosition(gates[index + 1], 'in').x, gateInputPosition(gates[index + 1], 'in').y);
    cells.push(...pathCells(from, to));
  }
  const lastOutput = gateOutputPosition(gates[gates.length - 1]);
  const firstInput = gateInputPosition(gates[0], 'in');
  const from = terrainCell(lastOutput.x, lastOutput.y);
  const to = terrainCell(firstInput.x, firstInput.y);
  const viaRow = Math.min(10, Math.max(from.row, to.row) + 4);
  cells.push(...pathCells(from, to, viaRow));
  state = addCopper(state, cells);
  return { state, activeLevel, gates };
}


test('sandbox NOT uses one input pin and produces the inverted bit at OUT', () => {
  let state = placeSandboxGate(sandbox, createGame(sandbox), 'NOT', { x: 0, y: 0 });
  const gate = state.placedGates[0];
  const activeLevel = {
    ...sandbox,
    gates: [...(sandbox.gates || []), ...state.placedGates],
  };

  expect(gate.inputs).toEqual([{ id: 'in', label: 'IN' }]);
  const input = gateInputPosition(gate, 'in');
  const output = gateOutputPosition(gate);
  const gatePorts = circuitPorts(activeLevel, state).filter((port) => port.gateId === gate.id);
  expect(gatePorts.find((port) => port.inputId === 'in')).toMatchObject({ role: 'receiver', x: input.x, y: input.y });
  expect(gatePorts.find((port) => port.kind === 'gateOutput')).toMatchObject({ role: 'driver', x: output.x, y: output.y });

  state = {
    ...state,
    cargo: [{ id: 'not-zero', value: 0 }],
    player: { x: input.x + 0.45, y: input.y },
  };
  state = dropCargoBit(activeLevel, state, 'not-zero');

  expect(state.cargo).toHaveLength(0);
  expect(state.gateState[gate.id].inputs).toEqual({});
  expect(state.gateState[gate.id].pendingOutput).toBeNull();
  expect(state.gateState[gate.id].processing).toMatchObject({ value: 1, duration: 0.8 });
  expect(state.gateState[gate.id].activations).toBe(1);
  expect(state.message).toMatch(/NOT consumed IN=0 and is processing/);

  state = advanceCircuit(activeLevel, state, 0.4);
  expect(state.gateState[gate.id].pendingOutput).toBeNull();
  expect(state.gateState[gate.id].processing.remaining).toBeCloseTo(0.4);
  state = advanceCircuit(activeLevel, state, 0.5);
  expect(state.gateState[gate.id].processing).toBeNull();
  expect(state.gateState[gate.id].pendingOutput).toMatchObject({ value: 1 });
  expect(state.message).toMatch(/propagation delay complete/);
});

test('physical drops onto sandbox AND inputs are captured and produce an output', () => {
  let state = placeSandboxGate(sandbox, createGame(sandbox), 'AND', { x: 0, y: 0 });
  const gate = state.placedGates[0];
  const activeLevel = {
    ...sandbox,
    gates: [...(sandbox.gates || []), ...state.placedGates],
  };

  state = {
    ...state,
    cargo: [
      { id: 'and-one', value: 1 },
      { id: 'and-zero', value: 0 },
    ],
  };

  const inputA = gateInputPosition(gate, 'a');
  state = dropCargoBit(activeLevel, {
    ...state,
    player: { x: inputA.x + 0.45, y: inputA.y },
  }, 'and-one');

  expect(state.gateState[gate.id].inputs.a).toMatchObject({ id: 'and-one', value: 1 });
  expect(state.worldBits.some((bit) => bit.id === 'and-one')).toBe(false);

  const inputB = gateInputPosition(gate, 'b');
  state = dropCargoBit(activeLevel, {
    ...state,
    player: { x: inputB.x + 0.45, y: inputB.y },
  }, 'and-zero');

  expect(state.gateState[gate.id].inputs).toEqual({});
  expect(state.gateState[gate.id].pendingOutput).toBeNull();
  expect(state.gateState[gate.id].processing).toMatchObject({ value: 0, duration: 1 });
  expect(state.gateState[gate.id].activations).toBe(1);
  expect(state.worldBits.some((bit) => bit.id === 'and-zero')).toBe(false);
  expect(state.message).toMatch(/AND consumed A=1, B=0 and is processing/);

  state = advanceCircuit(activeLevel, state, 1.05);
  expect(state.gateState[gate.id].processing).toBeNull();
  expect(state.gateState[gate.id].pendingOutput).toMatchObject({ value: 0 });
});


test('sandbox gate contacts use fixed roles and Drive can carry a 0 into an input', () => {
  let state = placeSandboxGate(sandbox, createGame(sandbox), 'AND', { x: 1, y: 0 });
  const gate = state.placedGates[0];
  const activeLevel = {
    ...sandbox,
    gates: [...(sandbox.gates || []), ...state.placedGates],
  };

  const inputA = gateInputPosition(gate, 'a');
  const output = gateOutputPosition(gate);
  expect(inputA).toEqual(cellPosition(terrainCell(inputA.x, inputA.y)));
  expect(output).toEqual(cellPosition(terrainCell(output.x, output.y)));

  const gatePorts = circuitPorts(activeLevel, state).filter((port) => port.gateId === gate.id);
  expect(gatePorts.find((port) => port.inputId === 'a')?.role).toBe('receiver');
  expect(gatePorts.find((port) => port.inputId === 'b')?.role).toBe('receiver');
  expect(gatePorts.find((port) => port.kind === 'gateOutput')?.role).toBe('driver');

  const inputCell = terrainCell(inputA.x, inputA.y);
  const sourceCell = { col: 2, row: inputCell.row };
  for (let col = sourceCell.col; col <= inputCell.col; col += 1) {
    state = fabricateCell(state, 'lithography', col, inputCell.row, col === sourceCell.col);
  }
  state = applyTerrainProcess(state, 'etch');
  state = applyTerrainProcess(state, 'copper');

  state = fabricateCell(state, 'lithography', sourceCell.col, sourceCell.row, true);
  state = applyTerrainProcess(state, 'tungsten');
  const sourceId = `pin-${sourceCell.col}-${sourceCell.row}`;
  state = setPinRole(activeLevel, state, sourceId, 'drive');
  expect(circuitPorts(activeLevel, state).find((port) => port.id === sourceId)?.role).toBe('driver');

  const sourcePosition = cellPosition(sourceCell);
  state = {
    ...state,
    worldBits: [...state.worldBits, { id: 'wire-zero', value: 0, ...sourcePosition, armed: true }],
  };

  for (let i = 0; i < 100; i += 1) state = advanceCircuit(activeLevel, state, 0.05);

  expect(state.worldBits.some((bit) => bit.id === 'wire-zero')).toBe(false);
  expect(state.gateState[gate.id].inputs.a).toMatchObject({ value: 0 });
  expect(state.message).toMatch(/A loaded with 0/);
});


test('K drop beside a sandbox Drive contact injects onto copper and reaches the gate input', () => {
  let state = placeSandboxGate(sandbox, createGame(sandbox), 'AND', { x: 1, y: 0 });
  const gate = state.placedGates[0];
  const activeLevel = {
    ...sandbox,
    gates: [...(sandbox.gates || []), ...state.placedGates],
  };

  const inputA = gateInputPosition(gate, 'a');
  const inputCell = terrainCell(inputA.x, inputA.y);
  const sourceCell = { col: 2, row: inputCell.row };
  for (let col = sourceCell.col; col <= inputCell.col; col += 1) {
    state = fabricateCell(state, 'lithography', col, inputCell.row, col === sourceCell.col);
  }
  state = applyTerrainProcess(state, 'etch');
  state = applyTerrainProcess(state, 'copper');
  state = fabricateCell(state, 'lithography', sourceCell.col, sourceCell.row, true);
  state = applyTerrainProcess(state, 'tungsten');

  const sourceId = `pin-${sourceCell.col}-${sourceCell.row}`;
  state = setPinRole(activeLevel, state, sourceId, 'drive');
  const adjacentCell = { col: sourceCell.col, row: sourceCell.row + 1 };
  const adjacentPosition = cellPosition(adjacentCell);
  expect(state.terrain[adjacentCell.row][adjacentCell.col].material).not.toBe('copper');

  state = {
    ...state,
    player: adjacentPosition,
    cargo: [{ id: 'drop-zero', value: 0 }],
  };
  state = dropCargoBit(activeLevel, state, 'drop-zero');

  expect(state.cargo).toHaveLength(0);
  expect(state.worldBits.some((bit) => bit.id === 'drop-zero')).toBe(false);
  expect(state.circuit.packets).toHaveLength(1);
  expect(state.circuit.packets[0].driverId).toBe(sourceId);

  for (let i = 0; i < 100; i += 1) state = advanceCircuit(activeLevel, state, 0.05);

  expect(state.circuit.packets).toHaveLength(0);
  expect(state.gateState[gate.id].inputs.a).toMatchObject({ value: 0 });
  expect(state.message).toMatch(/A loaded with 0/);
});


test('copper ending beside a sandbox gate input connects through the pad edge', () => {
  let state = placeSandboxGate(sandbox, createGame(sandbox), 'AND', { x: 1, y: 0 });
  const gate = state.placedGates[0];
  const activeLevel = {
    ...sandbox,
    gates: [...(sandbox.gates || []), ...state.placedGates],
  };

  const inputA = gateInputPosition(gate, 'a');
  const inputCell = terrainCell(inputA.x, inputA.y);
  const edgeCell = { col: inputCell.col - 1, row: inputCell.row };
  const sourceCell = { col: Math.max(1, edgeCell.col - 3), row: edgeCell.row };

  for (let col = sourceCell.col; col <= edgeCell.col; col += 1) {
    state = fabricateCell(state, 'lithography', col, edgeCell.row, col === sourceCell.col);
  }
  state = applyTerrainProcess(state, 'etch');
  state = applyTerrainProcess(state, 'copper');

  expect(state.terrain[inputCell.row][inputCell.col].material).not.toBe('copper');
  expect(state.terrain[edgeCell.row][edgeCell.col].material).toBe('copper');

  state = fabricateCell(state, 'lithography', sourceCell.col, sourceCell.row, true);
  state = applyTerrainProcess(state, 'tungsten');
  const sourceId = `pin-${sourceCell.col}-${sourceCell.row}`;
  state = setPinRole(activeLevel, state, sourceId, 'drive');

  const sourcePosition = cellPosition(sourceCell);
  state = {
    ...state,
    worldBits: [...state.worldBits, { id: 'edge-connected-zero', value: 0, ...sourcePosition, armed: true }],
  };

  for (let i = 0; i < 100; i += 1) state = advanceCircuit(activeLevel, state, 0.05);

  expect(state.worldBits.some((bit) => bit.id === 'edge-connected-zero')).toBe(false);
  expect(state.gateState[gate.id].inputs.a).toMatchObject({ value: 0 });
  expect(state.message).toMatch(/A loaded with 0/);
});


test('sandbox gate OUT drives copper that starts beside the output pad', () => {
  let state = placeSandboxGate(sandbox, createGame(sandbox), 'AND', { x: 0, y: 0 });
  const gate = state.placedGates[0];
  const activeLevel = {
    ...sandbox,
    gates: [...(sandbox.gates || []), ...state.placedGates],
  };

  state = {
    ...state,
    cargo: [
      { id: 'out-one-a', value: 1 },
      { id: 'out-one-b', value: 1 },
    ],
  };
  const inputA = gateInputPosition(gate, 'a');
  const inputB = gateInputPosition(gate, 'b');
  state = dropCargoBit(activeLevel, { ...state, player: { x: inputA.x + 0.45, y: inputA.y } }, 'out-one-a');
  state = dropCargoBit(activeLevel, { ...state, player: { x: inputB.x + 0.45, y: inputB.y } }, 'out-one-b');
  expect(state.gateState[gate.id].pendingOutput).toBeNull();
  expect(state.gateState[gate.id].processing).toMatchObject({ value: 1 });

  const output = gateOutputPosition(gate);
  const outputCell = terrainCell(output.x, output.y);
  const edgeCell = { col: outputCell.col + 1, row: outputCell.row };
  const receiveCell = { col: Math.min(16, edgeCell.col + 3), row: edgeCell.row };

  for (let col = edgeCell.col; col <= receiveCell.col; col += 1) {
    state = fabricateCell(state, 'lithography', col, edgeCell.row, col === edgeCell.col);
  }
  state = applyTerrainProcess(state, 'etch');
  state = applyTerrainProcess(state, 'copper');

  expect(state.terrain[outputCell.row][outputCell.col].material).not.toBe('copper');
  expect(state.terrain[edgeCell.row][edgeCell.col].material).toBe('copper');

  state = fabricateCell(state, 'lithography', receiveCell.col, receiveCell.row, true);
  state = applyTerrainProcess(state, 'tungsten');
  const receiveId = `pin-${receiveCell.col}-${receiveCell.row}`;
  state = setPinRole(activeLevel, state, receiveId, 'receive');

  for (let i = 0; i < 100; i += 1) state = advanceCircuit(activeLevel, state, 0.05);

  expect(state.gateState[gate.id].pendingOutput).toBeNull();
  expect(state.circuit.pinOutputs[receiveId]).toMatchObject({ value: 1 });
});



test('three NOT gates in a simple sandbox feedback loop form a seeded ring oscillator', () => {
  let { state, activeLevel, gates } = buildNotFeedback(3);
  const outputConnections = circuitConnections(activeLevel, state).filter((port) => port.kind === 'gateOutput');
  expect(outputConnections).toHaveLength(3);
  expect(outputConnections.every((port) => /Ring oscillator: 3 NOT stages/.test(port.reason))).toBe(true);

  state = {
    ...state,
    cargo: [{ id: 'ring-seed', value: 0 }],
    player: { x: 0, y: -4 },
  };
  state = depositCargo(activeLevel, state, 'ring-seed', { kind: 'gate', gateId: gates[0].id, inputId: 'in' });
  expect(state.gateState[gates[0].id].processing).toMatchObject({ value: 1 });

  for (let i = 0; i < 500; i += 1) state = advanceCircuit(activeLevel, state, 0.05);

  expect(state.gateState[gates[0].id].activations).toBeGreaterThan(1);
  expect(state.gateState[gates[1].id].activations).toBeGreaterThan(0);
  expect(state.gateState[gates[2].id].activations).toBeGreaterThan(0);
  const liveSignals = state.circuit.packets.length
    + gates.filter((gate) => state.gateState[gate.id].processing).length
    + gates.filter((gate) => state.gateState[gate.id].pendingOutput).length;
  expect(liveSignals).toBe(1);
});

test('an even two-NOT feedback loop stays blocked as unsupported feedback', () => {
  let { state, activeLevel, gates } = buildNotFeedback(2);
  const outputConnections = circuitConnections(activeLevel, state).filter((port) => port.kind === 'gateOutput');
  expect(outputConnections).toHaveLength(2);
  expect(outputConnections.every((port) => /Feedback loop/.test(port.reason))).toBe(true);

  state = {
    ...state,
    cargo: [{ id: 'even-seed', value: 0 }],
    player: { x: 0, y: -4 },
  };
  state = depositCargo(activeLevel, state, 'even-seed', { kind: 'gate', gateId: gates[0].id, inputId: 'in' });
  for (let i = 0; i < 100; i += 1) state = advanceCircuit(activeLevel, state, 0.05);

  expect(state.gateState[gates[0].id].pendingOutput).toMatchObject({ value: 1 });
  expect(state.gateState[gates[1].id].activations).toBe(0);
  expect(state.circuit.packets).toHaveLength(0);
});


test('sandbox gate contacts are prefabricated and skip tungsten deposition', () => {
  let state = placeSandboxGate(sandbox, createGame(sandbox), 'AND', { x: 1, y: 0 });
  const gate = state.placedGates[0];
  const inputA = gateInputPosition(gate, 'a');
  const cell = terrainCell(inputA.x, inputA.y);

  state = fabricateCell(state, 'lithography', cell.col, cell.row, true);
  const before = state.cost;
  const processed = applyTerrainProcess(state, 'tungsten');

  expect(processed.cost).toEqual(before);
  expect(processed.terrain[cell.row][cell.col].contact).toBeUndefined();
  expect(processed.message).toMatch(/supplied pads|already have contacts/i);
});
