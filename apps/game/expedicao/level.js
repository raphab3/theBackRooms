// Nível 0 em 3D a partir da grade de world.js: paredes instanciadas, fusíveis, moedas, saída e a
// entidade. Coordenadas do mundo: célula (x, y) da grade → (x·S, 0, y·S) em metros.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ENEMY_HP } from '@backrooms/shared/combat.js';
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
  lampMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(lamps.length * 3).fill(1),
    3,
  );
  scene.add(lampMesh);
  // Algumas luminárias piscam (escolha fixa pela posição, igual para todos).
  const flickering = lamps
      .map(([x, y], i) => ((x * 3 + y * 5) % 7 === 0 ? i : -1))
      .filter(i => i >= 0),
    lampColor = new THREE.Color();

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
  const coinPos = new THREE.Vector3(),
    coinTurn = new THREE.Quaternion(),
    coinEuler = new THREE.Euler(),
    zero = new THREE.Vector3(0, 0, 0);

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
  // Barra de vida sobre a entidade (só aparece depois do primeiro dano).
  const hpBar = document.createElement('div'),
    hpFill = document.createElement('div');
  hpBar.className = 'hpBar';
  hpBar.append(hpFill);
  const hpLabel = new CSS2DObject(hpBar);
  hpLabel.position.y = 2.5;
  enemy.add(hpLabel);

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
      // Objetos reaproveitados: criar 3 por moeda a cada quadro gerava lixo e travadas de GC.
      world.coins.forEach((c, i) => {
        coinPos.set(c.x * S, 0.6 + Math.sin(t * 3 + i) * 0.05, c.y * S);
        coinTurn.setFromEuler(coinEuler.set(Math.PI / 2, 0, t * 2 + i));
        coinMesh.setMatrixAt(i, m.compose(coinPos, coinTurn, hidden.has(c.id) ? zero : one));
      });
      coinMesh.instanceMatrix.needsUpdate = true;
      // Entidade: some ao morrer; queimando, brilha em laranja; vida na barra.
      const foe = room.enemy;
      enemy.visible = !foe.dead;
      hpBar.hidden = foe.dead || foe.hp >= ENEMY_HP;
      hpFill.style.width = `${(100 * foe.hp) / ENEMY_HP}%`;
      shadow.emissive.setRGB(
        foe.burning ? 0.6 + Math.sin(t * 30) * 0.3 : 0,
        foe.burning ? 0.2 : 0,
        0,
      );
      for (const i of flickering) {
        const v = Math.sin(t * 7 + i * 13) * Math.sin(t * 1.3 + i);
        lampMesh.setColorAt(i, lampColor.setScalar(v > 0.8 ? 0.12 : 1));
      }
      lampMesh.instanceColor.needsUpdate = true;
    },
    /** Distância (em metros) do ponto até a luminária acesa mais próxima, para o zumbido. */
    nearestLamp(px, pz) {
      let best = Infinity;
      for (const [x, y] of lamps)
        best = Math.min(best, Math.hypot((x + 0.5) * S - px, (y + 0.5) * S - pz));
      return best;
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
