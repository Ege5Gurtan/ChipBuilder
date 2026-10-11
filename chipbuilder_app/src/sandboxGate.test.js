import levels from './levels.js';
import { advanceCircuit, applyTerrainProcess, circuitPorts, createGame, dropCargoBit, fabricateCell, gateInputPosition, gateOutputPosition, placeSandboxGate, setPinRole } from './gameRules.js';
import { cellPosition } from './circuit.js';
import { terrainCell } from './terrain.js';

const sandbox = levels.find((item) => item.sandbox);


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
  expect(state.gateState[gate.id].pendingOutput).toMatchObject({ value: 1 });
  expect(state.gateState[gate.id].activations).toBe(1);
  expect(state.message).toMatch(/NOT consumed IN=0 and produced 1 at OUT/);
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
  expect(state.gateState[gate.id].pendingOutput).toMatchObject({ value: 0 });
  expect(state.gateState[gate.id].activations).toBe(1);
  expect(state.worldBits.some((bit) => bit.id === 'and-zero')).toBe(false);
  expect(state.message).toMatch(/AND consumed A=1, B=0 and produced 0 at OUT/);
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
  expect(state.gateState[gate.id].pendingOutput).toMatchObject({ value: 1 });

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
