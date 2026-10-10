// Nível 0 em 3D a partir da grade de world.js: paredes instanciadas, fusíveis, moedas, saída e a
// entidade. Coordenadas do mundo: célula (x, y) da grade → (x·S, 0, y·S) em metros.
import * as THREE from 'three';
import { carpet, ceilingTiles, wallpaper } from '../lobby/scene.js';

export const S = 2; // metros por célula
export const WALL_HEIGHT = 2.7;

export function buildLevel(scene, world) {
  const grid = world.grid,
    n = grid.length,
    open = (x, y) => grid[y]?.[x] === 0;

  const floorMap = carpet();
  floorMap.repeat.set(n, n);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(n * S, n * S),
    new THREE.MeshLambertMaterial({ map: floorMap }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((n * S) / 2, 0, (n * S) / 2);
  scene.add(floor);
  const ceilingMap = ceilingTiles();
  ceilingMap.repeat.set(n * 2, n * 2);
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(n * S, n * S),
    new THREE.MeshLambertMaterial({ map: ceilingMap }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set((n * S) / 2, WALL_HEIGHT, (n * S) / 2);
  scene.add(ceiling);

  // Só as células sólidas que encostam num corredor viram parede: o miolo nunca é visto.
  const wallMap = wallpaper();
  wallMap.repeat.set(1, 1);
  const walls = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (
        !open(x, y) &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => open(x + dx, y + dy))
      )
        walls.push([x, y]);
  const wallMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(S, WALL_HEIGHT, S),
    new THREE.MeshLambertMaterial({ map: wallMap }),
    walls.length,
  );
  const m = new THREE.Matrix4();
  walls.forEach(([x, y], i) =>
    wallMesh.setMatrixAt(i, m.makeTranslation((x + 0.5) * S, WALL_HEIGHT / 2, (y + 0.5) * S)),
  );
  scene.add(wallMesh);

  // Luminárias: uma a cada poucas células abertas, algumas apagadas (sorteio fixo pela posição).
  const lamps = [];
  for (let y = 1; y < n; y += 2)
    for (let x = 1; x < n; x += 2) if (open(x, y) && (x * 7 + y * 13) % 5 !== 0) lamps.push([x, y]);
  const lampMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.9, 0.45),
    new THREE.MeshBasicMaterial({ color: 0xfff6cf }),
    lamps.length,
  );
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
    one = new THREE.Vector3(1, 1, 1);
  lamps.forEach(([x, y], i) =>
    lampMesh.setMatrixAt(
      i,
      m.compose(new THREE.Vector3((x + 0.5) * S, WALL_HEIGHT - 0.01, (y + 0.5) * S), q, one),
    ),
  );
  scene.add(lampMesh);

  scene.add(new THREE.HemisphereLight(0xfff1c2, 0x3a2f12, 1.3));
  scene.fog = new THREE.Fog(0x8f8247, 2, 22);
  scene.background = new THREE.Color(0x8f8247);

  // Fusíveis: caixas amarelas que brilham e giram; somem quando a equipe coleta.
  const fuses = world.fuses.map(f => {
    const fuse = new THREE.Group(),
      body = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.42, 0.28),
        new THREE.MeshBasicMaterial({ color: 0xffd23a }),
      );
    fuse.add(body);
    const light = new THREE.PointLight(0xffc93a, 4, 4);
    light.position.y = 0.2;
    fuse.add(light);
    fuse.position.set(f.x * S, 1, f.y * S);
    scene.add(fuse);
    return fuse;
  });

  // Moedas numa malha instanciada; coletada = escala zero até reaparecer.
  const coinMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.16, 0.16, 0.04, 16),
    new THREE.MeshBasicMaterial({ color: 0xe8c547 }),
    world.coins.length,
  );
  scene.add(coinMesh);

  // Saída: porta escura com moldura que fica verde quando os fusíveis estão completos.
  const exit = new THREE.Group(),
    frameMaterial = new THREE.MeshBasicMaterial({ color: 0x7a2a1a });
  exit.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.1, 0.12), frameMaterial));
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1.95, 0.14),
    new THREE.MeshLambertMaterial({ color: 0x2b2416 }),
  );
  exit.add(door);
  exit.position.set(world.exit.x * S, 1.05, world.exit.y * S);
  scene.add(exit);

  // A entidade: vulto alto e escuro com olhos que brilham.
  const enemy = new THREE.Group(),
    shadow = new THREE.MeshLambertMaterial({ color: 0x0d0c0a });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.2, 0.4), shadow);
  body.position.y = 1.1;
  enemy.add(body);
  for (const side of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.05, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    eye.position.set(side, 1.95, 0.21);
    enemy.add(eye);
  }
  enemy.position.set(world.enemy.x * S, 0, world.enemy.y * S);
  scene.add(enemy);

  return {
    update(room, t) {
      room.fuses.forEach((taken, i) => (fuses[i].visible = !taken));
      for (const f of fuses) {
        f.rotation.y = t * 1.5;
        f.position.y = 1 + Math.sin(t * 2) * 0.08;
      }
      const ready = room.fuses.every(Boolean);
      frameMaterial.color.set(ready ? 0x3ad17a : 0x7a2a1a);
      const hidden = new Set(room.collectedCoins);
      world.coins.forEach((c, i) =>
        coinMesh.setMatrixAt(
          i,
          m.compose(
            new THREE.Vector3(c.x * S, 0.6 + Math.sin(t * 3 + i) * 0.05, c.y * S),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, t * 2 + i)),
            hidden.has(c.id) ? new THREE.Vector3(0, 0, 0) : one,
          ),
        ),
      );
      coinMesh.instanceMatrix.needsUpdate = true;
    },
    // A entidade anda entre snapshots: suaviza até a posição do servidor e olha para onde vai.
    moveEnemy(target, dt) {
      const tx = target.x * S,
        tz = target.y * S,
        dx = tx - enemy.position.x,
        dz = tz - enemy.position.z;
      if (Math.hypot(dx, dz) > 0.01) enemy.rotation.y = Math.atan2(dx, dz);
      enemy.position.x += dx * Math.min(1, dt * 8);
      enemy.position.z += dz * Math.min(1, dt * 8);
    },
  };
}
