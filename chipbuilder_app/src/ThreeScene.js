import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { TERRAIN_COLUMNS, TERRAIN_ROWS, TILE_WIDTH, TILE_DEPTH } from './terrain.js';

const MOVE_SPEED = 3.15;
const tileColors = { silicon: 0x318b9d, oxide: 0xb7a1d9, trench: 0x203143, rough: 0xad6635, metal: 0xe5ae50 };

function label(text, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 38px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color; ctx.fillText(text, 64, 32);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
  sprite.scale.set(0.8, 0.4, 1);
  return sprite;
}

function orb(color, radius = 0.22) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshBasicMaterial({ color })));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.5, 0.028, 6, 28), new THREE.MeshBasicMaterial({ color }));
  ring.rotation.x = Math.PI / 2; group.add(ring);
  return group;
}

function editable(target) {
  const tag = target?.tagName?.toLowerCase();
  return target?.isContentEditable || ['input', 'textarea', 'select'].includes(tag);
}

export default function ThreeScene({ level, game, onMove, onPaint, tool }) {
  const mountRef = useRef(null);
  const moveRef = useRef(onMove);
  const paintRef = useRef(onPaint);
  const toolRef = useRef(tool);
  const gameRef = useRef(game);
  const visuals = useRef(null);
  useEffect(() => { moveRef.current = onMove; paintRef.current = onPaint; toolRef.current = tool; gameRef.current = game; });

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x081422);
    const camera = new THREE.OrthographicCamera(-10, 10, 7, -7, 0.1, 100);
    camera.position.set(10, 18, 18); camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.prepend(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xbdeaff, 0x183345, 2.3));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1); sun.position.set(-5, 13, 7); scene.add(sun);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(13, 0.35, 10), new THREE.MeshStandardMaterial({ color: 0x102b3d }));
    floor.position.y = -0.35; scene.add(floor);

    const tileMeshes = [];
    const tiles = [];
    const tileGeometry = new THREE.BoxGeometry(TILE_WIDTH * 0.97, 1, TILE_DEPTH * 0.97);
    const materials = Object.fromEntries(Object.entries(tileColors).map(([name, color]) => [name, new THREE.MeshStandardMaterial({ color, roughness: name === 'metal' ? 0.3 : 0.68, metalness: name === 'metal' ? 0.6 : 0.12 })]));
    const maskMaterial = new THREE.MeshBasicMaterial({ color: 0xffd56a, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    for (let row = 0; row < TERRAIN_ROWS; row++) for (let col = 0; col < TERRAIN_COLUMNS; col++) {
      const mesh = new THREE.Mesh(tileGeometry, materials.silicon);
      mesh.position.set(-6 + (col + 0.5) * TILE_WIDTH, 0, 4.5 - (row + 0.5) * TILE_DEPTH);
      mesh.userData = { col, row }; scene.add(mesh); tileMeshes.push(mesh);
      const mask = new THREE.Mesh(new THREE.PlaneGeometry(TILE_WIDTH * 0.7, TILE_DEPTH * 0.7), maskMaterial);
      mask.rotation.x = -Math.PI / 2; mask.position.y = 0.52; mesh.add(mask);
      tiles.push({ mesh, mask });
    }
    const source = orb(0x5ae9ff, 0.28);
    source.position.set(level.start.x, 0.9, -level.start.y); scene.add(source);
    const destination = orb(0xffd16c, 0.36);
    destination.position.set(level.destination.x, 0.9, -level.destination.y); scene.add(destination);
    const destLabel = label('DEST', '#ffd77d'); destLabel.position.y = 0.75; destination.add(destLabel);
    const player = orb(0x88eeff, 0.25); scene.add(player);
    const pickups = new Map();
    level.pickups.forEach((pickup) => {
      const mesh = orb(pickup.value ? 0xffc87a : 0x72e2d4, 0.22);
      mesh.position.set(pickup.x, 1.02, -pickup.y);
      const text = label(String(pickup.value)); text.position.y = 0.53; mesh.add(text);
      scene.add(mesh); pickups.set(pickup.id, mesh);
    });
    const obstacles = new Map();
    level.obstacles.forEach((obstacle) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(obstacle.width, 0.8, obstacle.height), new THREE.MeshStandardMaterial({ color: obstacle.fabricationTarget ? 0xc75d43 : 0x596362 }));
      mesh.position.set(obstacle.x, 0.53, -obstacle.y); scene.add(mesh); obstacles.set(obstacle.id, mesh);
    });
    level.gates.forEach((gate) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(gate.type === 'AND' ? 2.15 : 1.75, 0.55, 1.35), new THREE.MeshStandardMaterial({ color: 0x3d5556 }));
      mesh.position.set(gate.x, 0.5, -gate.y); scene.add(mesh);
      const text = label(gate.type, '#f2d078'); text.position.set(gate.x, 1.12, -gate.y); scene.add(text);
    });
    visuals.current = { player, pickups, obstacles, tiles, materials };

    const keys = new Set();
    const keyDown = (event) => {
      if (editable(event.target)) return;
      const key = event.key.toLowerCase();
      if ('wasd'.includes(key)) { event.preventDefault(); keys.add(key); }
    };
    const keyUp = (event) => keys.delete(event.key.toLowerCase());
    const clearKeys = () => keys.clear();
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', clearKeys);

    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let painting = false, strokeStarted = false;
    const touched = new Set();
    const paint = (event) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(tileMeshes, false)[0];
      if (!hit || !gameRef.current.terrain) return;
      const { col, row } = hit.object.userData;
      const id = `${col}:${row}`;
      if (touched.has(id)) return;
      touched.add(id);
      const cell = gameRef.current.terrain[row]?.[col];
      const action = toolRef.current;
      const valid = action === 'lithography' ? cell?.type === 'oxide' && !cell.masked
        : action === 'etch' ? cell?.type === 'oxide' && cell.masked
        : action === 'deposit' ? cell?.type === 'trench'
        : cell?.type === 'rough';
      paintRef.current(col, row, !strokeStarted);
      if (valid) strokeStarted = true;
    };
    const down = (event) => {
      if (!gameRef.current.terrain || event.button !== 0) return;
      painting = true; strokeStarted = false; touched.clear();
      renderer.domElement.setPointerCapture(event.pointerId); paint(event);
    };
    const move = (event) => { if (painting) paint(event); };
    const up = () => { painting = false; touched.clear(); };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', up);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth), height = Math.max(1, mount.clientHeight);
      const aspect = width / height, span = 6.2;
      camera.left = -span * aspect; camera.right = span * aspect;
      camera.top = span; camera.bottom = -span; camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize); observer.observe(mount); resize();
    const clock = new THREE.Clock(); let animationFrame;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      let x = Number(keys.has('d')) - Number(keys.has('a'));
      let y = Number(keys.has('w')) - Number(keys.has('s'));
      if (x || y) { const length = Math.hypot(x, y); moveRef.current({ x: x / length * MOVE_SPEED * delta, y: y / length * MOVE_SPEED * delta }); }
      player.rotation.y += delta * 0.7;
      destination.rotation.y -= delta * 0.5;
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(animationFrame); observer.disconnect();
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', clearKeys);
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up); renderer.domElement.removeEventListener('pointercancel', up);
      visuals.current = null;
      const geometries = new Set(), ownedMaterials = new Set();
      scene.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.filter(Boolean).forEach((material) => ownedMaterials.add(material));
      });
      geometries.forEach((geometry) => geometry.dispose());
      ownedMaterials.forEach((material) => { material.map?.dispose(); material.dispose(); });
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [level]);

  useEffect(() => {
    const refs = visuals.current;
    if (!refs) return;
    refs.player.position.set(game.player.x, 1.08, -game.player.y);
    refs.pickups.forEach((mesh, id) => { mesh.visible = !game.collectedIds.includes(id); });
    refs.obstacles.forEach((mesh, id) => {
      const obstacle = level.obstacles.find((item) => item.id === id);
      mesh.visible = obstacle?.permanent || !game.fabrication.etched;
      if (obstacle?.fabricationTarget && game.fabrication.patterned) mesh.material.color.setHex(0xe3bd4e);
    });
    refs.tiles.forEach(({ mesh, mask }, index) => {
      const row = Math.floor(index / TERRAIN_COLUMNS), col = index % TERRAIN_COLUMNS;
      const cell = game.terrain?.[row]?.[col] || { type: 'silicon', masked: false };
      mesh.material = refs.materials[cell.type]; mask.visible = cell.masked;
      const heights = { silicon: 0.48, oxide: 1.13, trench: 0.13, rough: 0.81, metal: 0.59 };
      mesh.scale.y = heights[cell.type]; mesh.position.y = heights[cell.type] / 2;
    });
  }, [game, level]);

  return <div className="wafer-stage" ref={mountRef} aria-label="Tilted 3D semiconductor wafer play field" />;
}
