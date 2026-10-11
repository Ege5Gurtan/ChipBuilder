import { terrainCell, TILE_WIDTH, TILE_DEPTH, TERRAIN_WIDTH, TERRAIN_DEPTH } from './terrain.js';

export const SIGNAL_SPEED = 4; // Tile edges per second; a deliberate gameplay simplification.
export const cellKey = ({ col, row }) => `${col}:${row}`;
export const cellPosition = ({ col, row }) => ({
  x: -TERRAIN_WIDTH / 2 + (col + 0.5) * TILE_WIDTH,
  y: -TERRAIN_DEPTH / 2 + (row + 0.5) * TILE_DEPTH,
});

// A contact is an overlay: the copper below stays connected and walkable.
export function wirePins(terrain) {
  return (terrain || []).flatMap((cells, row) => cells.flatMap((cell, col) =>
    cell.contact === 'tungsten' && cell.material === 'copper' && cell.height === 1
      ? [{ id: `pin-${col}-${row}`, col, row, ...cellPosition({ col, row }) }] : []));
}

const CARDINAL_OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function isGateContact(port) {
  return port?.kind === 'gate' || port?.kind === 'gateOutput';
}

function neighboringCells(cell) {
  return CARDINAL_OFFSETS.map(([dc, dr]) => ({ col: cell.col + dc, row: cell.row + dr }));
}

function portTouchesCopperCells(port, cells) {
  const contactCell = terrainCell(port.x, port.y);
  if (cells.has(cellKey(contactCell))) return true;
  if (!isGateContact(port)) return false;
  return neighboringCells(contactCell).some((cell) => cells.has(cellKey(cell)));
}

function routeEndpointCells(net, endpoint) {
  const contactCell = terrainCell(endpoint.x, endpoint.y);
  if (net.cells.has(cellKey(contactCell))) return [contactCell];
  if (!isGateContact(endpoint)) return [];
  return neighboringCells(contactCell).filter((cell) => net.cells.has(cellKey(cell)));
}

// Copper has no direction. Four-neighbour connectivity defines passive electrical nets.
// Prefabricated gate contacts also connect when copper reaches any cardinal edge of the pad.
export function wireNets(terrain, ports) {
  const remaining = new Map();
  terrain?.forEach((row, r) => row.forEach((cell, col) => {
    if (cell.material === 'copper' && cell.height === 1) remaining.set(`${col}:${r}`, { col, row: r });
  }));
  const nets = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    const cells = new Map([[cellKey(first), first]]);
    const queue = [first];
    remaining.delete(cellKey(first));
    for (let i = 0; i < queue.length; i += 1) {
      const { col, row } = queue[i];
      [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]].forEach(([c, r]) => {
        const key = `${c}:${r}`;
        if (!remaining.has(key)) return;
        const cell = remaining.get(key);
        remaining.delete(key); cells.set(key, cell); queue.push(cell);
      });
    }
    const attached = ports.filter((port) => portTouchesCopperCells(port, cells));
    const drivers = attached.filter((port) => port.role === 'driver');
    const receivers = attached.filter((port) => port.role === 'receiver');
    nets.push({ cells, ports: attached, drivers, receivers, conflict: drivers.length > 1 });
  }
  return nets;
}

export function wireRoute(net, from, to) {
  const fromCell = terrainCell(from.x, from.y);
  const toCell = terrainCell(to.x, to.y);
  const starts = routeEndpointCells(net, from);
  const ends = routeEndpointCells(net, to);
  if (!starts.length || !ends.length) return [];

  const endKeys = new Set(ends.map(cellKey));
  const visited = new Map(starts.map((cell) => [cellKey(cell), null]));
  const queue = starts.map((cell) => net.cells.get(cellKey(cell)));

  for (let i = 0; i < queue.length; i += 1) {
    const cell = queue[i];
    if (endKeys.has(cellKey(cell))) {
      const route = [];
      let key = cellKey(cell);
      while (key) {
        route.unshift(net.cells.get(key));
        key = visited.get(key);
      }
      if (cellKey(fromCell) !== cellKey(route[0])) route.unshift(fromCell);
      if (cellKey(toCell) !== cellKey(route[route.length - 1])) route.push(toCell);
      return route;
    }
    const { col, row } = cell;
    CARDINAL_OFFSETS.forEach(([dc, dr]) => {
      const next = `${col + dc}:${row + dr}`;
      if (!net.cells.has(next) || visited.has(next)) return;
      visited.set(next, cellKey(cell));
      queue.push(net.cells.get(next));
    });
  }
  return [];
}

export function packetPosition(packet) {
  const index = Math.min(packet.route.length - 1, Math.floor(packet.progress));
  const start = cellPosition(packet.route[index]);
  const end = cellPosition(packet.route[Math.min(index + 1, packet.route.length - 1)]);
  const t = packet.progress - index;
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
}
