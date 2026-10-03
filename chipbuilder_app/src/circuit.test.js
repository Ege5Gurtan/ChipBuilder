import levels from './levels.js';
import { wireNets } from './circuit.js';
import { advanceCircuit, applyTerrainProcess, attemptSignalDelivery, circuitConnections, createGame, depositCargo, dropCargoBit, fabricateCell, movePlayer, undoTerrainEdit } from './gameRules.js';

const level = levels.find((item) => item.circuit);
const routeCells = [...Array.from({ length: 6 }, (_, i) => [i + 2, 5]), ...Array.from({ length: 5 }, (_, i) => [i + 11, 5])];
function fabricateRoute(cells = routeCells, mission = level) {
  let state = createGame(mission);
  cells.forEach(([col, row], index) => { state = fabricateCell(state, 'lithography', col, row, index === 0); });
  state = applyTerrainProcess(state, 'etch');
  return applyTerrainProcess(state, 'copper');
}
function withCargo(state, value = 0) { return { ...state, cargo: [{ id: 'test-bit', value }] }; }
function run(state, mission = level) {
  for (let i = 0; i < 200; i += 1) state = advanceCircuit(mission, state, 0.05);
  return state;
}

test('source → copper → NOT → copper → DEST completes while the carrier stays still', () => {
  let state = withCargo(fabricateRoute());
  expect(circuitConnections(level, state).every((port) => port.ready)).toBe(true);
  state = depositCargo(level, state, 'test-bit', { kind: 'source', sourceId: 'source' });
  const result = run(state);
  expect(result.status).toBe('success');
  expect(result.player).toEqual(level.start);
  expect(result.targetSlots[0].delivered).toBe(true);
  expect(result.cargo).toHaveLength(0);
  expect(result.gateState['wired-not'].activations).toBe(1);
  expect(result.cost.manufacturing).toBe(224);
});

test('a missing tile leaves a wire open and preserves cargo and costs', () => {
  const state = withCargo(fabricateRoute(routeCells.filter(([col]) => col !== 4)));
  const next = dropCargoBit(level, { ...state, player: level.circuit.sources[0] }, 'test-bit');
  expect(next.message).toMatch(/Open/);
  expect(next.cargo).toEqual(state.cargo);
  expect(next.cost).toEqual(state.cost);
});

test('diagonal copper tiles are separate nets; drawing order does not give copper direction', () => {
  const state = fabricateRoute([[2, 5], [3, 6]]);
  expect(wireNets(state.terrain, [])).toHaveLength(2);
  const backward = fabricateRoute([...routeCells].reverse());
  expect(run(depositCargo(level, withCargo(backward), 'test-bit', { kind: 'source', sourceId: 'source' })).status).toBe('success');
});

test('shorting source and gate output rejects injection without consuming the token', () => {
  const state = withCargo(fabricateRoute(Array.from({ length: 14 }, (_, i) => [i + 2, 5])));
  const next = depositCargo(level, state, 'test-bit', { kind: 'source', sourceId: 'source' });
  expect(next.message).toMatch(/Short/);
  expect(next.cargo).toEqual(state.cargo);
  expect(next.circuit.packets).toHaveLength(0);
});

test('wrong wired output is rejected and returned to cargo for retry', () => {
  const result = run(depositCargo(level, withCargo(fabricateRoute(), 1), 'test-bit', { kind: 'source', sourceId: 'source' }));
  expect(result.status).toBe('playing');
  expect(result.targetSlots[0].delivered).toBe(false);
  expect(result.feedback.kind).toBe('reject');
  expect(result.cargo.map((bit) => bit.value)).toEqual([0]);
  expect(result.message).toMatch(/returned to cargo/);
});

test('wire edits and undo cannot alter an in-flight packet route or costs', () => {
  let state = depositCargo(level, withCargo(fabricateRoute()), 'test-bit', { kind: 'source', sourceId: 'source' });
  state = advanceCircuit(level, state, 0.05);
  expect(state.circuit.packets).toHaveLength(1);
  [fabricateCell(state, 'lithography', 4, 5, true), applyTerrainProcess(state, 'etch'), undoTerrainEdit(state)].forEach((next) => {
    expect(next.terrain).toBe(state.terrain);
    expect(next.cost).toEqual(state.cost);
  });
});

test('unconnected NOT output holds one result without duplicating or letting the carrier pick it up', () => {
  const state = run(depositCargo(level, withCargo(fabricateRoute(routeCells.filter(([col]) => col < 8))), 'test-bit', { kind: 'source', sourceId: 'source' }));
  expect(state.gateState['wired-not'].pendingOutput.value).toBe(1);
  expect(state.gateState['wired-not'].activations).toBe(1);
  const next = movePlayer(level, { ...state, player: { x: 1.355, y: -0.375 } }, { x: 0, y: 0 });
  expect(next.cargo).toHaveLength(0);
  expect(next.gateState['wired-not'].pendingOutput.value).toBe(1);
});

test('wired NOT does not flip walking cargo and direct delivery cannot bypass the circuit', () => {
  const state = withCargo(createGame(level));
  const next = movePlayer(level, { ...state, player: { x: 0, y: -0.375 } }, { x: 0, y: 0 });
  expect(next.cargo[0].value).toBe(0);
  expect(attemptSignalDelivery(level, { ...next, player: level.destination }).targetSlots[0].delivered).toBe(false);
  expect(depositCargo(level, state, 'test-bit', { kind: 'gate', gateId: 'wired-not', inputId: 'in' })).toBe(state);
});

test('etch + copper creates walkable conductor, and undo refunds fabrication without refunding later pickups', () => {
  const state = fabricateRoute();
  expect(state.terrain[5][4]).toMatchObject({ height: 1, material: 'copper' });
  const next = undoTerrainEdit({ ...state, cost: { ...state.cost, energy: 7 } });
  expect(next.terrain[5][4].height).toBe(0);
  expect(next.cost.energy).toBe(7);
  expect(next.cost.manufacturing).toBe(108);
  expect(applyTerrainProcess(createGame(level), 'copper').cost.manufacturing).toBe(0);
});

test('fan-out copies one source token once per input and backpressure waits for all inputs', () => {
  const mission = { ...level, target: '11', gates: [
    { ...level.gates[0], type: 'AND', inputs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
  ] };
  const cells = [...Array.from({ length: 5 }, (_, i) => [i + 2, 5]), [6, 4], [6, 6]];
  let state = withCargo(fabricateRoute(cells, mission), 1);
  state = depositCargo(mission, state, 'test-bit', { kind: 'source', sourceId: 'source' });
  state = advanceCircuit(mission, state, 0.05);
  expect(state.circuit.packets).toHaveLength(2);
  expect(new Set(state.circuit.packets.map((packet) => packet.bit.id)).size).toBe(2);
  state = run(state, mission);
  expect(state.gateState['wired-not'].activations).toBe(1);
  expect(state.gateState['wired-not'].pendingOutput.value).toBe(1);
  state = depositCargo(mission, withCargo(state), 'test-bit', { kind: 'source', sourceId: 'source' });
  expect(run(state, mission).circuit.sources.source.value).toBe(0);
});

test('a feedback loop holds its finite output token instead of generating endless activations', () => {
  const cells = [...Array.from({ length: 5 }, (_, i) => [i + 7, 6]), [7, 5], [11, 5]];
  let state = fabricateRoute(cells);
  state = { ...state, gateState: { ...state.gateState, 'wired-not': { ...state.gateState['wired-not'], pendingOutput: { id: 'held', value: 1 } } } };
  expect(circuitConnections(level, state).find((port) => port.kind === 'gateOutput').reason).toMatch(/Feedback loop/);
  expect(run(state).gateState['wired-not'].pendingOutput.id).toBe('held');
});

test('existing pass-through NOT and normal carrier delivery still work', () => {
  const mission = levels[7], gate = mission.gates[0];
  const state = withCargo(createGame(mission));
  const flipped = movePlayer(mission, { ...state, player: { x: gate.x, y: gate.y } }, { x: 0, y: 0 });
  expect(flipped.cargo[0].value).toBe(1);
  const held = movePlayer(mission, flipped, { x: 0, y: 0 });
  expect(held.cargo[0].value).toBe(1);
  expect(attemptSignalDelivery(mission, { ...held, player: mission.destination }).status).toBe('success');
});
