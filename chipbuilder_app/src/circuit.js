import { terrainCell, TILE_WIDTH, TILE_DEPTH, TERRAIN_WIDTH, TERRAIN_DEPTH } from './terrain.js';

export const SIGNAL_SPEED = 4; // Tile edges per second; a deliberate gameplay simplification.
export const cellKey = ({ col, row }) => `${col}:${row}`;
export const cellPosition = ({ col, row }) => ({
  x: -TERRAIN_WIDTH / 2 + (col + 0.5) * TILE_WIDTH,
  y: -TERRAIN_DEPTH / 2 + (row + 0.5) * TILE_DEPTH,
});

// Copper has no direction. Four-neighbour connectivity defines passive electrical nets.
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
    const attached = ports.filter((port) => cells.has(cellKey(terrainCell(port.x, port.y))));
    const drivers = attached.filter((port) => port.role === 'driver');
    const receivers = attached.filter((port) => port.role === 'receiver');
    nets.push({ cells, ports: attached, drivers, receivers, conflict: drivers.length > 1 });
  }
  return nets;
}

export function wireRoute(net, from, to) {
  const start = terrainCell(from.x, from.y), end = terrainCell(to.x, to.y);
  const visited = new Map([[cellKey(start), null]]), queue = [start];
  for (let i = 0; i < queue.length; i += 1) {
    const cell = queue[i];
    if (cellKey(cell) === cellKey(end)) {
      const route = [];
      let key = cellKey(end);
      while (key) { route.unshift(net.cells.get(key)); key = visited.get(key); }
      return route;
    }
    const { col, row } = cell;
    [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]].forEach(([c, r]) => {
      const next = `${c}:${r}`;
      if (!net.cells.has(next) || visited.has(next)) return;
      visited.set(next, cellKey(cell)); queue.push(net.cells.get(next));
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
