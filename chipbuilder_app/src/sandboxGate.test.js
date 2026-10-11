import levels from './levels.js';
import { createGame, dropCargoBit, gateInputPosition, placeSandboxGate } from './gameRules.js';

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
