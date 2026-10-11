import yaml from 'js-yaml';
import { cellPosition } from './circuit.js';
import { BASE_HEIGHT, TERRAIN_COLUMNS, TERRAIN_ROWS, terrainCell } from './terrain.js';

export const SCGL_FORMAT = 'semicon-game-level';
export const SCGL_VERSION = 1;

const CURRENT_MATERIALS = new Set(['silicon', 'oxide', 'deposit', 'copper']);
const CURRENT_GATES = new Set(['NOT', 'AND', 'OR']);
const CURRENT_PROCESSES = new Set(['lithography', 'etch', 'deposit', 'copper', 'tungsten', 'cmp']);
const GATE_INPUTS = {
  NOT: [{ id: 'in', label: 'IN' }],
  AND: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  OR: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
};

function fail(message) {
  throw new Error('SCGL: ' + message);
}

function integer(value, label) {
  const result = Number(value);
  if (!Number.isInteger(result)) fail(label + ' must be an integer');
  return result;
}

function ensureCell(cell, label) {
  if (!cell || typeof cell !== 'object') fail(label + ' requires a cell');
  const col = integer(cell.col, label + '.col');
  const row = integer(cell.row, label + '.row');
  if (col < 0 || col >= TERRAIN_COLUMNS || row < 0 || row >= TERRAIN_ROWS) {
    fail(label + ' cell (' + col + ', ' + row + ') is outside the ' + TERRAIN_COLUMNS + 'x' + TERRAIN_ROWS + ' wafer');
  }
  return { col, row };
}

function positionAt(spec, label) {
  if (!spec || typeof spec !== 'object') fail(label + ' requires a position');
  if (spec.cell) return cellPosition(ensureCell(spec.cell, label));
  if (spec.world) {
    const x = Number(spec.world.x);
    const y = Number(spec.world.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) fail(label + '.world requires numeric x and y');
    ensureCell(terrainCell(x, y), label + '.world');
    return { x, y };
  }
  fail(label + ' must use cell or world coordinates');
}

function manhattanCells(from, to) {
  const result = [{ ...from }];
  let col = from.col;
  let row = from.row;
  while (col !== to.col) {
    col += Math.sign(to.col - col);
    result.push({ col, row });
  }
  while (row !== to.row) {
    row += Math.sign(to.row - row);
    result.push({ col, row });
  }
  return result;
}

function areaCells(area, label) {
  if (!area || typeof area !== 'object') fail(label + ' requires an area');
  if (area.cell) return [ensureCell(area.cell, label + '.cell')];
  if (area.cells) {
    if (!Array.isArray(area.cells) || !area.cells.length) fail(label + '.cells must be a non-empty list');
    return area.cells.map((cell, index) => ensureCell(cell, label + '.cells[' + index + ']'));
  }
  if (area.rect) {
    const cols = area.rect.cols;
    const rows = area.rect.rows;
    if (!Array.isArray(cols) || cols.length !== 2 || !Array.isArray(rows) || rows.length !== 2) {
      fail(label + '.rect requires cols: [start, end] and rows: [start, end]');
    }
    const from = ensureCell({ col: Math.min(Number(cols[0]), Number(cols[1])), row: Math.min(Number(rows[0]), Number(rows[1])) }, label + '.rect');
    const to = ensureCell({ col: Math.max(Number(cols[0]), Number(cols[1])), row: Math.max(Number(rows[0]), Number(rows[1])) }, label + '.rect');
    const result = [];
    for (let row = from.row; row <= to.row; row += 1) {
      for (let col = from.col; col <= to.col; col += 1) result.push({ col, row });
    }
    return result;
  }
  if (area.path) {
    const points = area.path.points || (area.path.from && area.path.to ? [area.path.from, area.path.to] : null);
    if (!Array.isArray(points) || points.length < 2) fail(label + '.path requires from/to or at least two points');
    const checked = points.map((point, index) => ensureCell(point, label + '.path[' + index + ']'));
    const result = [];
    checked.slice(1).forEach((point, index) => {
      const segment = manhattanCells(checked[index], point);
      result.push.apply(result, result.length ? segment.slice(1) : segment);
    });
    return result;
  }
  fail(label + '.area supports cell, cells, rect, or path');
}

function processName(item, index) {
  if (typeof item === 'string') {
    if (!CURRENT_PROCESSES.has(item)) fail('fabrication.allowed_processes[' + index + '] uses unsupported process ' + item);
    return item;
  }
  if (!item || typeof item !== 'object' || !item.process) {
    fail('fabrication.allowed_processes[' + index + '] must be a process name or process object');
  }
  const process = String(item.process);
  if (process === 'deposit') {
    if (!item.material) return 'deposit';
    if (item.material === 'copper') return 'copper';
    if (item.material === 'tungsten') return 'tungsten';
    fail('deposit material ' + item.material + ' is not supported yet');
  }
  if (!CURRENT_PROCESSES.has(process)) fail('process ' + process + ' is not supported yet');
  return process;
}

function gateDelay(value, label) {
  if (value === undefined || value === null) return undefined;
  const numeric = typeof value === 'string' && value.endsWith('s') ? Number(value.slice(0, -1)) : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) fail(label + ' must be a non-negative number of seconds');
  return numeric;
}

function targetFromMission(document) {
  const objective = document.mission && document.mission.objective;
  if (!objective) return '1';
  if (objective.type !== 'deliver_signal') fail('mission objective type ' + objective.type + ' is not supported in SCGL v1');
  if (!Array.isArray(objective.signal) || !objective.signal.length || objective.signal.some((bit) => bit !== 0 && bit !== 1)) {
    fail('deliver_signal objective requires signal: [0, 1, ...]');
  }
  return objective.signal.join('');
}

export function compileSCGL(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) fail('top level must be a mapping');
  if (document.format !== SCGL_FORMAT) fail('format must be ' + SCGL_FORMAT);
  if (Number(document.version) !== SCGL_VERSION) fail('unsupported version ' + document.version + '; this build supports version ' + SCGL_VERSION);

  const meta = document.level;
  if (!meta || typeof meta !== 'object') fail('level section is required');
  if (!meta.id || !meta.title) fail('level.id and level.title are required');

  const grid = (document.world && document.world.grid) || {};
  if ((grid.columns !== undefined && Number(grid.columns) !== TERRAIN_COLUMNS)
    || (grid.rows !== undefined && Number(grid.rows) !== TERRAIN_ROWS)) {
    fail('this build currently supports a ' + TERRAIN_COLUMNS + 'x' + TERRAIN_ROWS + ' grid');
  }

  const substrate = (document.world && document.world.substrate) || { material: 'silicon', height: BASE_HEIGHT };
  const baseMaterial = String(substrate.material || 'silicon');
  const baseHeight = Number(substrate.height === undefined ? BASE_HEIGHT : substrate.height);
  if (!CURRENT_MATERIALS.has(baseMaterial)) fail('substrate material ' + baseMaterial + ' is not supported yet');
  if (!Number.isInteger(baseHeight) || baseHeight < 0 || baseHeight > 3) fail('substrate height must be an integer from 0 to 3');

  const cellMap = new Map();
  (((document.world || {}).structures) || []).forEach((structure, index) => {
    if (!structure || typeof structure !== 'object') fail('world.structures[' + index + '] must be a mapping');
    const material = String(structure.material || baseMaterial);
    if (!CURRENT_MATERIALS.has(material)) fail('world.structures[' + index + '] material ' + material + ' is not supported yet');
    const height = Number(structure.height === undefined ? baseHeight : structure.height);
    if (!Number.isInteger(height) || height < 0 || height > 3) fail('world.structures[' + index + '].height must be an integer from 0 to 3');
    areaCells(structure.area, 'world.structures[' + index + ']').forEach(({ col, row }) => {
      cellMap.set(col + ':' + row, { col, row, material, height, ...(structure.mask === true ? { masked: true } : {}) });
    });
  });

  const contactIds = {};
  const initialPinRoles = {};
  (document.contacts || []).forEach((contact, index) => {
    if (!contact || contact.type !== 'tungsten') fail('contacts[' + index + '] only supports type: tungsten in SCGL v1');
    const position = positionAt(contact.at, 'contacts[' + index + '].at');
    const cell = ensureCell(terrainCell(position.x, position.y), 'contacts[' + index + '].at');
    const key = cell.col + ':' + cell.row;
    const current = cellMap.get(key) || { col: cell.col, row: cell.row, material: baseMaterial, height: baseHeight };
    cellMap.set(key, { ...current, contact: 'tungsten' });
    const pinId = 'pin-' + cell.col + '-' + cell.row;
    contactIds[pinId] = contact.id || 'contact-' + cell.col + '-' + cell.row;
    if (contact.role !== undefined) {
      if (!['drive', 'receive'].includes(contact.role)) fail('contacts[' + index + '].role must be drive or receive');
      if (current.material !== 'copper' || current.height !== BASE_HEIGHT) {
        fail('contacts[' + index + '] can only assign a role when tungsten sits on flush copper');
      }
      initialPinRoles[pinId] = contact.role;
    }
  });

  const ids = new Set();
  const gates = (document.devices || []).map((device, index) => {
    if (!device || device.type !== 'logic_gate') {
      fail('devices[' + index + '] type ' + (device && device.type) + ' is not supported yet; SCGL v1 currently supports logic_gate');
    }
    const model = String(device.model || '').toUpperCase();
    if (!CURRENT_GATES.has(model)) fail('devices[' + index + '] logic gate ' + model + ' is not supported yet');
    if (!device.id) fail('devices[' + index + '].id is required');
    if (ids.has(device.id)) fail('duplicate object/device id ' + device.id);
    ids.add(device.id);
    if (device.orientation && device.orientation !== 'east') {
      fail('devices[' + index + '].orientation ' + device.orientation + ' is not supported yet; gates currently face east');
    }
    const position = positionAt(device.at, 'devices[' + index + '].at');
    const inputs = device.ports
      ? Object.entries(device.ports).filter(([, port]) => port && port.role === 'input').map(([id, port]) => ({ id, label: port.label || id.toUpperCase() }))
      : GATE_INPUTS[model].map((input) => ({ ...input }));
    if (model === 'NOT' && inputs.length !== 1) fail('devices[' + index + '] NOT requires exactly one input port');
    if (['AND', 'OR'].includes(model) && inputs.length !== 2) fail('devices[' + index + '] ' + model + ' requires exactly two input ports');
    const propagationDelay = gateDelay(device.propagation_delay, 'devices[' + index + '].propagation_delay');
    return {
      id: device.id,
      type: model,
      x: position.x,
      y: position.y,
      inputs,
      ...(device.wired === true ? { wired: true } : {}),
      ...(propagationDelay !== undefined ? { propagationDelay } : {}),
    };
  });

  const pickups = [];
  (document.objects || []).forEach((object, index) => {
    if (!object || object.type !== 'bit') fail('objects[' + index + '] type ' + (object && object.type) + ' is not supported yet; SCGL v1 currently supports bit');
    if (!object.id) fail('objects[' + index + '].id is required');
    if (ids.has(object.id)) fail('duplicate object/device id ' + object.id);
    ids.add(object.id);
    if (object.value !== 0 && object.value !== 1) fail('objects[' + index + '].value must be 0 or 1');
    const position = positionAt(object.at, 'objects[' + index + '].at');
    pickups.push({ id: object.id, value: object.value, ...position });
  });

  const actors = document.actors || [];
  const player = actors.find((actor) => actor && (actor.controller === 'player' || actor.id === 'player'));
  if (!player) fail('actors must include a player actor');
  if (player.type && player.type !== 'carrier') fail('SCGL v1 player actor type must be carrier');
  if (player.species && player.species !== 'electron') fail('player carrier species ' + player.species + ' is not supported yet');
  const start = positionAt(player.spawn, 'player.spawn');
  const initialCargo = (player.inventory || []).map((item, index) => {
    if (!item || item.type !== 'bit' || (item.value !== 0 && item.value !== 1)) {
      fail('player.inventory[' + index + '] must be a bit with value 0 or 1');
    }
    const id = item.id || 'cargo-' + (index + 1);
    if (ids.has(id)) fail('duplicate object/device id ' + id);
    ids.add(id);
    return { id, value: item.value };
  });

  if (!document.destination || !document.destination.at) fail('destination.at is required');
  const destination = positionAt(document.destination.at, 'destination.at');
  const target = targetFromMission(document);
  const allowedProcesses = (((document.fabrication || {}).allowed_processes) || ['lithography', 'etch', 'deposit', 'copper', 'tungsten', 'cmp']).map(processName);
  const terrainRegions = [...cellMap.values()].map((cell) => ({
    rows: [cell.row, cell.row],
    cols: [cell.col, cell.col],
    height: cell.height,
    material: cell.material,
    ...(cell.masked ? { masked: true } : {}),
    ...(cell.contact !== undefined ? { contact: cell.contact } : {}),
  }));

  const obstacles = ((((document.world || {}).obstacles) || [])).map((obstacle, index) => {
    if (!obstacle || !obstacle.id || !obstacle.at || !obstacle.size) fail('world.obstacles[' + index + '] requires id, at, and size');
    const position = positionAt(obstacle.at, 'world.obstacles[' + index + '].at');
    const width = Number(obstacle.size.width);
    const height = Number(obstacle.size.height);
    if (!(width > 0) || !(height > 0)) fail('world.obstacles[' + index + '].size must have positive width and height');
    return { id: obstacle.id, ...position, width, height, permanent: obstacle.permanent !== false, fabricationTarget: Boolean(obstacle.fabrication_target) };
  });

  return {
    id: meta.id,
    number: 'SB',
    title: meta.title,
    sandbox: true,
    goal: meta.goal || 'Experiment with this SCGL level in the Process Sandbox.',
    lesson: meta.lesson || 'Imported from a single SCGL level file. Edit the wafer, then export it again.',
    target,
    start,
    destination,
    pickups,
    initialCargo,
    obstacles,
    gates,
    initialPinRoles,
    fabrication: {
      terrain: { baseHeight, baseMaterial, regions: terrainRegions },
      allowedProcesses: [...new Set(allowedProcesses)],
    },
    scglMeta: {
      author: meta.author,
      destinationId: document.destination.id || 'dest',
      substrate: { material: baseMaterial, height: baseHeight },
      contactIds,
      scoring: document.scoring,
    },
  };
}

export function parseSCGL(text) {
  let document;
  try {
    document = yaml.safeLoad(String(text || ''), { json: false });
  } catch (error) {
    fail('invalid YAML: ' + error.message);
  }
  return compileSCGL(document);
}

function positionSpec(position) {
  const cell = terrainCell(position.x, position.y);
  const centered = cellPosition(cell);
  if (Math.abs(centered.x - position.x) < 1e-6 && Math.abs(centered.y - position.y) < 1e-6) return { cell };
  return { world: { x: Number(position.x.toFixed(4)), y: Number(position.y.toFixed(4)) } };
}

function terrainStructureCells(terrain, baseMaterial, baseHeight) {
  const runs = [];
  for (let row = 0; row < terrain.length; row += 1) {
    let start = 0;
    while (start < terrain[row].length) {
      const cell = terrain[row][start];
      const signature = cell.material + '|' + cell.height + '|' + Boolean(cell.masked);
      let end = start;
      while (end + 1 < terrain[row].length) {
        const next = terrain[row][end + 1];
        if (next.material + '|' + next.height + '|' + Boolean(next.masked) !== signature) break;
        end += 1;
      }
      if (cell.material !== baseMaterial || cell.height !== baseHeight || cell.masked) {
        runs.push({ rowStart: row, rowEnd: row, colStart: start, colEnd: end, material: cell.material, height: cell.height, mask: Boolean(cell.masked) });
      }
      start = end + 1;
    }
  }
  const merged = [];
  runs.forEach((run) => {
    const previous = merged.find((item) => item.rowEnd === run.rowStart - 1
      && item.colStart === run.colStart && item.colEnd === run.colEnd
      && item.material === run.material && item.height === run.height && item.mask === run.mask);
    if (previous) previous.rowEnd = run.rowEnd;
    else merged.push({ ...run });
  });
  return merged.map((run, index) => ({
    id: 'structure-' + (index + 1),
    material: run.material,
    height: run.height,
    ...(run.mask ? { mask: true } : {}),
    area: run.rowStart === run.rowEnd && run.colStart === run.colEnd
      ? { cell: { col: run.colStart, row: run.rowStart } }
      : { rect: { cols: [run.colStart, run.colEnd], rows: [run.rowStart, run.rowEnd] } },
  }));
}

function contactDocuments(level, game) {
  const semanticIds = (level.scglMeta && level.scglMeta.contactIds) || {};
  const roles = (game.circuit && game.circuit.pinRoles) || {};
  const contacts = [];
  if (!game.terrain) return contacts;
  game.terrain.forEach((row, rowIndex) => row.forEach((cell, col) => {
    if (cell.contact !== 'tungsten') return;
    const pinId = 'pin-' + col + '-' + rowIndex;
    contacts.push({
      id: semanticIds[pinId] || 'contact-' + col + '-' + rowIndex,
      type: 'tungsten',
      at: { cell: { col, row: rowIndex } },
      ...(roles[pinId] ? { role: roles[pinId] } : {}),
    });
  }));
  return contacts;
}

function gateDocument(gate) {
  const ports = Object.fromEntries((gate.inputs || []).map((input) => [input.id, { role: 'input', label: input.label }]));
  ports.out = { role: 'output', label: 'OUT' };
  return {
    id: gate.id,
    type: 'logic_gate',
    model: gate.type,
    at: positionSpec(gate),
    orientation: 'east',
    ports,
    ...(gate.wired ? { wired: true } : {}),
    ...(gate.propagationDelay !== undefined ? { propagation_delay: String(gate.propagationDelay) + 's' } : {}),
  };
}

function processDocument(process) {
  if (process === 'copper') return { process: 'deposit', material: 'copper' };
  if (process === 'tungsten') return { process: 'deposit', material: 'tungsten' };
  return process;
}

export function sandboxToSCGLDocument(level, activeLevel, game) {
  if (!level || !level.sandbox) fail('export is only available from the Process Sandbox');
  if (!game || !game.terrain) fail('sandbox has no terrain to export');
  const transientGate = Object.values(game.gateState || {}).some((gate) => gate && (gate.processing || gate.pendingOutput || Object.keys(gate.inputs || {}).length));
  const transientCircuit = Boolean(game.circuit && game.circuit.packets && game.circuit.packets.length)
    || Object.values((game.circuit && game.circuit.sources) || {}).some(Boolean)
    || Object.values((game.circuit && game.circuit.pinOutputs) || {}).some(Boolean);
  if (transientGate || transientCircuit) {
    fail('finish or reclaim in-flight, gate-loaded, and pending-output bits before exporting a level');
  }

  const substrate = (level.scglMeta && level.scglMeta.substrate) || (level.fabrication && level.fabrication.terrain) || {};
  const baseMaterial = substrate.material || substrate.baseMaterial || 'silicon';
  const baseHeight = Number(substrate.height === undefined ? (substrate.baseHeight === undefined ? BASE_HEIGHT : substrate.baseHeight) : substrate.height);
  const target = String(level.target || '1').split('').map(Number);
  const actors = [{
    id: 'player',
    type: 'carrier',
    controller: 'player',
    species: 'electron',
    spawn: positionSpec(game.player),
    ...(game.cargo.length ? { inventory: game.cargo.map((item) => ({ id: item.id, type: 'bit', value: item.value })) } : {}),
  }];
  const obstacles = (activeLevel.obstacles || []).map((obstacle) => ({
    id: obstacle.id,
    at: positionSpec(obstacle),
    size: { width: obstacle.width, height: obstacle.height },
    permanent: obstacle.permanent !== false,
    ...(obstacle.fabricationTarget ? { fabrication_target: true } : {}),
  }));

  return {
    format: SCGL_FORMAT,
    version: SCGL_VERSION,
    level: {
      id: level.id || 'sandbox-level',
      title: level.title || 'Sandbox Level',
      ...((level.scglMeta && level.scglMeta.author) ? { author: level.scglMeta.author } : {}),
      goal: level.goal,
      lesson: level.lesson,
    },
    world: {
      grid: { columns: TERRAIN_COLUMNS, rows: TERRAIN_ROWS },
      substrate: { material: baseMaterial, height: baseHeight },
      structures: terrainStructureCells(game.terrain, baseMaterial, baseHeight),
      ...(obstacles.length ? { obstacles } : {}),
    },
    devices: (activeLevel.gates || []).map(gateDocument),
    contacts: contactDocuments(level, game),
    objects: (game.worldBits || []).map((bit) => ({ id: bit.id, type: 'bit', value: bit.value, at: positionSpec(bit) })),
    actors,
    destination: { id: (level.scglMeta && level.scglMeta.destinationId) || 'dest', at: positionSpec(level.destination) },
    fabrication: { allowed_processes: ((level.fabrication && level.fabrication.allowedProcesses) || []).map(processDocument) },
    mission: { objective: { type: 'deliver_signal', destination: (level.scglMeta && level.scglMeta.destinationId) || 'dest', signal: target } },
    scoring: (level.scglMeta && level.scglMeta.scoring) || { track: ['process_steps', 'manufacturing', 'energy'] },
  };
}

export function exportSandboxSCGL(level, activeLevel, game) {
  return yaml.safeDump(sandboxToSCGLDocument(level, activeLevel, game), {
    noRefs: true,
    lineWidth: 120,
    sortKeys: false,
  });
}

export function scglDownloadName(level) {
  const slug = String((level && level.id) || 'sandbox-level').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sandbox-level';
  return slug + '.scgl.yaml';
}
