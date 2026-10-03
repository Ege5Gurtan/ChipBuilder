export const TERRAIN_COLUMNS = 18;
export const TERRAIN_ROWS = 12;
export const TERRAIN_WIDTH = 12;
export const TERRAIN_DEPTH = 9;
export const TILE_WIDTH = TERRAIN_WIDTH / TERRAIN_COLUMNS;
export const TILE_DEPTH = TERRAIN_DEPTH / TERRAIN_ROWS;

export const MIN_HEIGHT = 0;
export const BASE_HEIGHT = 1;
export const MAX_HEIGHT = 3;

export function createTerrain() {
  return Array.from({ length: TERRAIN_ROWS }, (_, row) =>
    Array.from({ length: TERRAIN_COLUMNS }, (_, col) => ({
      height: col === 8 ? 2 : BASE_HEIGHT,
      material: col === 8 ? 'oxide' : 'silicon',
      masked: false,
    }))
  );
}

export function terrainCell(x, y) {
  const col = Math.floor((x + TERRAIN_WIDTH / 2) / TILE_WIDTH);
  const row = Math.floor((y + TERRAIN_DEPTH / 2) / TILE_DEPTH);
  return { col, row };
}

export function terrainHeight(terrain, x, y) {
  const { col, row } = terrainCell(x, y);
  return terrain[row]?.[col]?.height ?? BASE_HEIGHT;
}

export const FAB_TOOLS = {
  lithography: { base: 18, cell: 2, label: 'Lithography' },
  etch: { base: 24, cell: 4, label: 'Etch' },
  deposit: { base: 28, cell: 8, label: 'Deposit' },
  cmp: { base: 22, cell: 2, label: 'CMP' },
};
