export const TERRAIN_COLUMNS = 18;
export const TERRAIN_ROWS = 12;
export const TERRAIN_WIDTH = 12;
export const TERRAIN_DEPTH = 9;
export const TILE_WIDTH = TERRAIN_WIDTH / TERRAIN_COLUMNS;
export const TILE_DEPTH = TERRAIN_DEPTH / TERRAIN_ROWS;

export const MIN_HEIGHT = 0;
export const BASE_HEIGHT = 1;
export const MAX_HEIGHT = 3;

export function createTerrain(config = {}) {
  const baseHeight = config.baseHeight ?? BASE_HEIGHT;
  const baseMaterial = config.baseMaterial || 'silicon';
  const terrain = Array.from({ length: TERRAIN_ROWS }, () =>
    Array.from({ length: TERRAIN_COLUMNS }, () => ({
      height: baseHeight,
      material: baseMaterial,
      masked: false,
    }))
  );

  (config.regions || []).forEach((region) => {
    const [rowStart, rowEnd] = region.rows || [0, TERRAIN_ROWS - 1];
    const [colStart, colEnd] = region.cols || [0, TERRAIN_COLUMNS - 1];
    for (let row = Math.max(0, rowStart); row <= Math.min(TERRAIN_ROWS - 1, rowEnd); row += 1) {
      for (let col = Math.max(0, colStart); col <= Math.min(TERRAIN_COLUMNS - 1, colEnd); col += 1) {
        terrain[row][col] = {
          ...terrain[row][col],
          height: region.height ?? terrain[row][col].height,
          material: region.material || terrain[row][col].material,
        };
      }
    }
  });

  return terrain;
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
  copper: { base: 28, cell: 8, label: 'Fill Copper' },
  cmp: { base: 22, cell: 2, label: 'CMP' },
};
