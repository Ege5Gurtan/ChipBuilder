import { createGame } from './gameRules.js';
import { exportSandboxSCGL, parseSCGL } from './scgl.js';

const example = [
  "",
  "format: semicon-game-level",
  "version: 1",
  "level:",
  "  id: roundtrip-example",
  "  title: Roundtrip Example",
  "world:",
  "  grid: { columns: 18, rows: 12 }",
  "  substrate: { material: silicon, height: 1 }",
  "  structures:",
  "    - id: input-wire",
  "      material: copper",
  "      height: 1",
  "      area:",
  "        path:",
  "          from: { col: 3, row: 5 }",
  "          to: { col: 7, row: 5 }",
  "contacts:",
  "  - id: driver",
  "    type: tungsten",
  "    at: { cell: { col: 3, row: 5 } }",
  "    role: drive",
  "devices:",
  "  - id: inverter",
  "    type: logic_gate",
  "    model: NOT",
  "    at: { cell: { col: 9, row: 5 } }",
  "    propagation_delay: 0.6s",
  "objects:",
  "  - id: zero",
  "    type: bit",
  "    value: 0",
  "    at: { cell: { col: 2, row: 8 } }",
  "actors:",
  "  - id: player",
  "    type: carrier",
  "    controller: player",
  "    species: electron",
  "    spawn: { cell: { col: 1, row: 9 } }",
  "destination:",
  "  id: dest",
  "  at: { cell: { col: 16, row: 5 } }",
  "fabrication:",
  "  allowed_processes:",
  "    - lithography",
  "    - etch",
  "    - { process: deposit, material: copper }",
  "    - { process: deposit, material: tungsten }",
  "mission:",
  "  objective:",
  "    type: deliver_signal",
  "    destination: dest",
  "    signal: [1]",
].join('\n');

test('SCGL imports semantic terrain, contacts, gates, bits and mission into sandbox', () => {
  const level = parseSCGL(example);
  const game = createGame(level);

  expect(level.sandbox).toBe(true);
  expect(level.target).toBe('1');
  expect(level.gates[0]).toMatchObject({ id: 'inverter', type: 'NOT', propagationDelay: 0.6 });
  expect(level.fabrication.allowedProcesses).toEqual(['lithography', 'etch', 'copper', 'tungsten']);
  expect(game.terrain[5][3]).toMatchObject({ material: 'copper', height: 1, contact: 'tungsten' });
  expect(game.terrain[5][7]).toMatchObject({ material: 'copper', height: 1 });
  expect(game.circuit.pinRoles['pin-3-5']).toBe('drive');
  expect(game.worldBits[0]).toMatchObject({ id: 'zero', value: 0 });
});

test('sandbox SCGL export can be imported again without losing semantic level state', () => {
  const level = parseSCGL(example);
  let game = createGame(level);
  game = {
    ...game,
    cargo: [{ id: 'held-one', value: 1 }],
    terrain: game.terrain.map((row, rowIndex) => row.map((cell, col) => (
      rowIndex === 4 && col === 4 ? { ...cell, masked: true } : cell
    ))),
  };

  const exported = exportSandboxSCGL(level, { ...level, gates: level.gates }, game);
  const imported = parseSCGL(exported);
  const importedGame = createGame(imported);

  expect(imported.gates.map((gate) => gate.id)).toEqual(['inverter']);
  expect(importedGame.terrain[5][3]).toMatchObject({ material: 'copper', contact: 'tungsten' });
  expect(importedGame.terrain[4][4].masked).toBe(true);
  expect(importedGame.circuit.pinRoles['pin-3-5']).toBe('drive');
  expect(importedGame.cargo).toEqual([{ id: 'held-one', value: 1 }]);
  expect(imported.target).toBe('1');
});

test('SCGL reports unsupported future devices clearly instead of silently ignoring them', () => {
  expect(() => parseSCGL(example.replace('type: logic_gate\n    model: NOT', 'type: transistor\n    model: nmos')))
    .toThrow(/type transistor is not supported yet/);
});

test('SCGL export refuses transient signal state that would otherwise be lost', () => {
  const level = parseSCGL(example);
  const game = createGame(level);
  const busy = {
    ...game,
    gateState: {
      ...game.gateState,
      inverter: { ...game.gateState.inverter, inputs: { in: { id: 'zero', value: 0 } } },
    },
  };
  expect(() => exportSandboxSCGL(level, { ...level, gates: level.gates }, busy)).toThrow(/finish or reclaim/);
});
