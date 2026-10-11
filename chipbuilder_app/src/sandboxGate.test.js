import levels from './levels.js';
import { advanceCircuit, applyTerrainProcess, circuitPorts, createGame, dropCargoBit, fabricateCell, gateInputPosition, gateOutputPosition, placeSandboxGate, setPinRole } from './gameRules.js';
import { cellPosition } from './circuit.js';
import { terrainCell } from './terrain.js';

const sandbox = levels.find((item) => item.sandbox);

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
