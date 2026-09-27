export const TERRAIN_COLUMNS = 18;
export const TERRAIN_ROWS = 12;
export const TERRAIN_WIDTH = 12;
export const TERRAIN_DEPTH = 9;
export const TILE_WIDTH = TERRAIN_WIDTH / TERRAIN_COLUMNS;
export const TILE_DEPTH = TERRAIN_DEPTH / TERRAIN_ROWS;

export function createTerrain() {
  return Array.from({ length: TERRAIN_ROWS }, (_, row) =>
    Array.from({ length: TERRAIN_COLUMNS }, (_, col) => ({
      type: col === 8 || col === 9 ? 'oxide' : col === 13 || col === 14 ? 'trench' : 'silicon',
      masked: false,
    }))
  );
}

export function terrainCell(x, y) {
  const col = Math.floor((x + TERRAIN_WIDTH / 2) / TILE_WIDTH);
  const row = Math.floor((y + TERRAIN_DEPTH / 2) / TILE_DEPTH);
  return { col, row };
}

export function terrainMaterial(terrain, x, y) {
  const { col, row } = terrainCell(x, y);
  return terrain[row]?.[col]?.type;
}

export const FAB_TOOLS = {
  lithography: { base: 18, cell: 2, label: 'Lithography' },
  etch: { base: 24, cell: 4, label: 'Etch' },
  deposit: { base: 28, cell: 8, label: 'Deposit Cu' },
  cmp: { base: 22, cell: 2, label: 'CMP' },
};
