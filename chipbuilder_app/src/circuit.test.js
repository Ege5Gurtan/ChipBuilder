import levels from './levels.js';
import { wireNets } from './circuit.js';
import { advanceCircuit, applyTerrainProcess, attemptSignalDelivery, circuitConnections, createGame, depositCargo, dropCargoBit, fabricateCell, gateOutputPosition, movePlayer, undoTerrainEdit } from './gameRules.js';

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

test('unconnected NOT output is collected once and can be carried to DEST', () => {
  const state = run(depositCargo(level, withCargo(fabricateRoute(routeCells.filter(([col]) => col < 8))), 'test-bit', { kind: 'source', sourceId: 'source' }));
  expect(state.gateState['wired-not'].pendingOutput.value).toBe(1);
  expect(state.gateState['wired-not'].activations).toBe(1);
  const outside = movePlayer(level, { ...state, player: { x: 2.1, y: -0.375 } }, { x: 0, y: 0 });
  expect(outside.cargo).toHaveLength(0);
  const next = movePlayer(level, { ...state, player: gateOutputPosition(level.gates[0]) }, { x: 0, y: 0 });
  expect(next.cargo).toEqual([{ id: state.gateState['wired-not'].pendingOutput.id, value: 1 }]);
  expect(next.gateState['wired-not'].pendingOutput).toBeNull();
  const again = run(movePlayer(level, next, { x: 0, y: 0 }));
  expect(again.cargo).toEqual(next.cargo);
  expect(again.cost.energy).toBe(state.cost.energy + 1);
  expect(again.gateState['wired-not'].activations).toBe(1);
  expect(attemptSignalDelivery(level, again).status).toBe('playing');
  expect(attemptSignalDelivery(level, { ...again, player: level.destination }).status).toBe('success');
});

test('a carrier already standing at OUT collects the arriving result without moving', () => {
  let state = depositCargo(level, withCargo(fabricateRoute(routeCells.filter(([col]) => col < 8))), 'test-bit', { kind: 'source', sourceId: 'source' });
  state = { ...state, player: gateOutputPosition(level.gates[0]) };
  const result = run(state);
  expect(result.cargo.map((bit) => bit.value)).toEqual([1]);
  expect(result.gateState['wired-not'].pendingOutput).toBeNull();
  expect(result.gateState['wired-not'].activations).toBe(1);
});

test('a ready copper route forwards before proximity pickup at OUT', () => {
  let state = depositCargo(level, withCargo(fabricateRoute()), 'test-bit', { kind: 'source', sourceId: 'source' });
  state = { ...state, player: gateOutputPosition(level.gates[0]) };
  const result = run(state);
  expect(result.status).toBe('success');
  expect(result.cargo).toHaveLength(0);
  expect(result.gateState['wired-not'].pendingOutput).toBeNull();
});

test('wired NOT does not flip walking cargo, accepts only wired inputs, and rejects wrong delivery', () => {
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

const sourcePinLevel = levels.find((item) => item.id === 'build-source-pin');
const twoPinLevel = levels.find((item) => item.id === 'build-wire-pins');
function makePins(state, cells) {
  cells.forEach(([col, row], i) => { state = fabricateCell(state, 'lithography', col, row, i === 0); });
  return applyTerrainProcess(state, 'tungsten');
}

test('missing SRC cannot load until tungsten creates a walkable copper contact; supplied gate pads work immediately', () => {
  let state = withCargo(createGame(sourcePinLevel));
  const absent = depositCargo(sourcePinLevel, state, 'test-bit', { kind: 'source', sourceId: 'pin-2-5' });
  expect(absent.cargo).toEqual(state.cargo);
  expect(absent.message).toMatch(/no pin yet/);
  state = makePins(state, [[2, 5]]);
  expect(state.terrain[5][2]).toMatchObject({ material: 'copper', height: 1, contact: 'tungsten', masked: false });
  expect(state.cost.manufacturing).toBe(46);
  const result = run(depositCargo(sourcePinLevel, state, 'test-bit', { kind: 'source', sourceId: 'pin-2-5' }), sourcePinLevel);
  expect(result.status).toBe('success');
  expect(result.gateState['pin-not'].activations).toBe(1);
  expect(result.terrain.flat().filter((cell) => cell.contact === 'tungsten')).toHaveLength(1);
});

test('tungsten requires a copper pattern; invalid masks and existing pins charge no deposition cost', () => {
  const bare = createGame(sourcePinLevel);
  expect(applyTerrainProcess(bare, 'tungsten').cost).toEqual(bare.cost);
  const invalid = fabricateCell(bare, 'lithography', 2, 4, true);
  const rejected = applyTerrainProcess(invalid, 'tungsten');
  expect(rejected.terrain).toBe(invalid.terrain);
  expect(rejected.cost).toEqual(invalid.cost);
  expect(rejected.message).toMatch(/need copper/);
  const supplied = fabricateCell(bare, 'lithography', 7, 5, true);
  expect(applyTerrainProcess(supplied, 'tungsten').cost).toEqual(supplied.cost);
  const pin = makePins(bare, [[2, 5]]);
  const duplicate = fabricateCell(pin, 'lithography', 2, 5, true);
  expect(applyTerrainProcess(duplicate, 'tungsten').cost).toEqual(duplicate.cost);
});

test.each([[2, 15], [15, 2]])('two tungsten pins send in either direction (%s → %s) and output pickup happens once', (from, to) => {
  let state = withCargo(makePins(createGame(twoPinLevel), [[2, 5], [15, 5]]), 1);
  expect(attemptSignalDelivery(twoPinLevel, { ...state, player: twoPinLevel.destination }).status).toBe('playing');
  state = depositCargo(twoPinLevel, state, 'test-bit', { kind: 'source', sourceId: `pin-${from}-5` });
  state = run(state, twoPinLevel);
  expect(state.circuit.pinTransfers).toBe(1);
  expect(state.circuit.pinOutputs[`pin-${to}-5`].value).toBe(1);
  expect(state.cargo).toHaveLength(0);
  const pin = circuitConnections(twoPinLevel, state).find((port) => port.id === `pin-${to}-5`);
  const collected = run({ ...state, player: pin }, twoPinLevel);
  expect(collected.cargo.map((bit) => bit.value)).toEqual([1]);
  expect(run(collected, twoPinLevel).cargo).toEqual(collected.cargo);
  expect(collected.cost.energy).toBe(state.cost.energy + 1);
  expect(attemptSignalDelivery(twoPinLevel, { ...collected, player: twoPinLevel.destination }).status).toBe('success');
});

test('output pins apply backpressure and cannot inject against another active driver', () => {
  let state = withCargo(makePins(createGame(twoPinLevel), [[2, 5], [15, 5]]), 1);
  state = depositCargo(twoPinLevel, state, 'test-bit', { kind: 'source', sourceId: 'pin-2-5' });
  const competing = depositCargo(twoPinLevel, withCargo(state), 'test-bit', { kind: 'source', sourceId: 'pin-15-5' });
  expect(competing.cargo).toHaveLength(1);
  expect(competing.circuit.sources['pin-15-5']).toBeUndefined();
  state = run(state, twoPinLevel);
  state = depositCargo(twoPinLevel, { ...state, cargo: [{ id: 'second', value: 0 }] }, 'second', { kind: 'source', sourceId: 'pin-2-5' });
  expect(run(state, twoPinLevel).circuit.sources['pin-2-5'].id).toBe('second');
  expect(state.circuit.pinTransfers).toBe(1);
});

test('undo removes tungsten, refunds fabrication only, and salvages a queued bit', () => {
  let state = withCargo(makePins(createGame(sourcePinLevel), [[2, 5]]));
  state = depositCargo(sourcePinLevel, state, 'test-bit', { kind: 'source', sourceId: 'pin-2-5' });
  const undone = undoTerrainEdit({ ...state, cost: { ...state.cost, energy: 9 } });
  expect(undone.terrain[5][2].contact).toBeUndefined();
  expect(undone.terrain[5][2].masked).toBe(true);
  expect(undone.cost).toEqual({ processSteps: 1, manufacturing: 20, energy: 9 });
  expect(undone.cargo).toEqual([{ id: 'test-bit', value: 0 }]);
  expect(undone.circuit.sources['pin-2-5']).toBeUndefined();
});

test('etching away an occupied output pin returns its bit and breaks copper continuity', () => {
  let state = withCargo(makePins(createGame(twoPinLevel), [[2, 5], [15, 5]]), 1);
  state = run(depositCargo(twoPinLevel, state, 'test-bit', { kind: 'source', sourceId: 'pin-2-5' }), twoPinLevel);
  state = fabricateCell(state, 'lithography', 15, 5, true);
  const etched = applyTerrainProcess(state, 'etch');
  expect(etched.terrain[5][15]).toMatchObject({ height: 0, contact: null });
  expect(etched.cargo.map((bit) => bit.value)).toEqual([1]);
  expect(etched.circuit.pinOutputs).toEqual({});
});

test('K loads a nearby created pin and supplied pads in a mixed mask need no extra tungsten', () => {
  let state = makePins(createGame(sourcePinLevel), [[2, 5], [7, 5], [11, 5], [15, 5]]);
  expect(state.terrain.flat().filter((cell) => cell.contact === 'tungsten')).toHaveLength(1);
  expect(state.cost.manufacturing).toBe(52); // 26 mask + 26 tungsten; supplied pads skipped.
  state = withCargo(state);
  const pin = circuitConnections(sourcePinLevel, state).find((port) => port.id === 'pin-2-5');
  const sent = dropCargoBit(sourcePinLevel, { ...state, player: pin }, 'test-bit');
  expect(sent.cargo).toHaveLength(0);
  expect(run(sent, sourcePinLevel).status).toBe('success');
});
