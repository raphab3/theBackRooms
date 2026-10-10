// Acampamento a céu aberto: chão de grama seca, cerca, postes de concreto, o gerador no centro com a
// luz da área segura, as edificações (porta e letreiro) e o portal de volta ao Posto Zero.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  CAMP_SIZE,
  CARTOGRAPHER,
  GENERATOR,
  GENERATOR_CENTER,
  MAP_PRICE,
  PORTAL,
} from '@backrooms/shared/camp.js';
import { wallpaper } from '../lobby/scene.js';
import { S } from './level.js';

const SKY = 0xc4c8bd,
  NIGHT_SKY = 0x0c0f18;

function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8f8a55';
  ctx.fillRect(0, 0, 256, 256);
  let n = 99;
  for (let i = 0; i < 2600; i++) {
    n = (n * 1664525 + 1013904223) >>> 0;
    const x = n % 256,
      y = (n >>> 8) % 256,
      shade = 110 + ((n >>> 16) % 70);
    ctx.fillStyle = `rgb(${shade} ${shade - 8} ${shade - 60})`;
    ctx.fillRect(x, y, 1 + (n % 3), 3 + (n % 4));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(CAMP_SIZE / 2, CAMP_SIZE / 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function label(root, html, x, y, z) {
  const tag = document.createElement('div');
  tag.className = 'portalTag';
  tag.innerHTML = html;
  const obj = new CSS2DObject(tag);
  obj.position.set(x, y, z);
  root.add(obj);
  return obj;
}

export function buildCamp(root, camp, scene) {
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 18, 85);
  const hemi = new THREE.HemisphereLight(0xf1f2e6, 0x5b5432, 2.2);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3d6, 1.2);
  sun.position.set(30, 60, 10);
  root.add(sun);

  const size = CAMP_SIZE * S,
    ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshLambertMaterial({ map: groundTexture() }),
    );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(size / 2, 0, size / 2);
  root.add(ground);

  // Cerca na borda e postes de concreto: malhas instanciadas.
  const m = new THREE.Matrix4(),
    border = [];
  for (let i = 0; i < CAMP_SIZE; i++)
    border.push([i, 0], [i, CAMP_SIZE - 1], [0, i], [CAMP_SIZE - 1, i]);
  const fence = new THREE.InstancedMesh(
    new THREE.BoxGeometry(S, 2.2, 0.2),
    new THREE.MeshLambertMaterial({ color: 0x5c5a52 }),
    border.length,
  );
  border.forEach(([x, y], i) => {
    const vertical = x === 0 || x === CAMP_SIZE - 1;
    m.makeRotationY(vertical ? Math.PI / 2 : 0);
    m.setPosition((x + 0.5) * S, 1.1, (y + 0.5) * S);
    fence.setMatrixAt(i, m);
  });
  root.add(fence);
  const pylons = new THREE.InstancedMesh(
    new THREE.BoxGeometry(S * 0.8, 3.2, S * 0.8),
    new THREE.MeshLambertMaterial({ color: 0x9a9789 }),
    camp.pylons.length,
  );
  camp.pylons.forEach((p, i) =>
    pylons.setMatrixAt(i, m.makeTranslation((p.x + 0.5) * S, 1.6, (p.y + 0.5) * S)),
  );
  root.add(pylons);

  // Gerador: bloco 2×2 células, lâmpada no topo e a luz que marca a área segura.
  const gx = (GENERATOR.x + 1) * S,
    gz = (GENERATOR.y + 1) * S,
    generator = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2 * S - 0.6, 2, 2 * S - 0.6),
    new THREE.MeshLambertMaterial({ color: 0x4f5a4a }),
  );
  body.position.y = 1;
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.8, 16),
    new THREE.MeshBasicMaterial({ color: 0xffd76a }),
  );
  lamp.position.y = 2.5;
  const light = new THREE.PointLight(0xffc96a, 30, 26, 1.2);
  light.position.y = 3.2;
  generator.add(body, lamp, light);
  generator.position.set(gx, 0, gz);
  root.add(generator);
  label(root, '<b>GERADOR</b><br>área segura', gx, 4.2, gz);

  // Edificações: bloco com papel de parede, porta escura com moldura e o nome do nível.
  const wallMat = new THREE.MeshLambertMaterial({ map: wallpaper() }),
    doorMat = new THREE.MeshBasicMaterial({ color: 0x1a1710 }),
    frameMat = new THREE.MeshBasicMaterial({ color: 0xe8c547 });
  for (const b of camp.buildings) {
    const w = b.foot * S,
      height = 7,
      block = new THREE.Mesh(new THREE.BoxGeometry(w, height, w), wallMat);
    block.position.set((b.x + b.foot / 2) * S, height / 2, (b.y + b.foot / 2) * S);
    root.add(block);
    // Porta na face virada para o gerador, no centro da parede.
    const d = b.doorAt,
      face = { south: [0, -1], north: [0, 1], west: [1, 0], east: [-1, 0] }[b.door],
      door = new THREE.Group();
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4), doorMat),
      frame = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.7), frameMat);
    leaf.position.set(0, 1.2, 0.02);
    frame.position.set(0, 1.35, 0.01);
    door.add(frame, leaf);
    door.position.set((d.x + face[0] * 0.49) * S, 0, (d.y + face[1] * 0.49) * S);
    door.rotation.y = Math.atan2(-face[0], -face[1]);
    root.add(door);
    label(
      root,
      `<b>${b.name.toUpperCase()}</b><br>chegue perto e aperte E`,
      door.position.x,
      3.6,
      door.position.z,
    );
  }

  // Mesa do cartógrafo: um tampo com o mapa aberto em cima.
  const table = new THREE.Group(),
    top = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.08, 0.9),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2b }),
    ),
    paper = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.7),
      new THREE.MeshBasicMaterial({ color: 0xe9dfb8 }),
    );
  top.position.y = 0.95;
  paper.rotation.x = -Math.PI / 2;
  paper.position.y = 1;
  for (const [x, z] of [
    [-0.6, -0.35],
    [0.6, -0.35],
    [-0.6, 0.35],
    [0.6, 0.35],
  ]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.95, 0.07),
      new THREE.MeshLambertMaterial({ color: 0x4a3420 }),
    );
    leg.position.set(x, 0.47, z);
    table.add(leg);
  }
  table.add(top, paper);
  table.position.set(CARTOGRAPHER.x * S, 0, CARTOGRAPHER.y * S);
  root.add(table);
  label(
    root,
    `<b>CARTÓGRAFO</b><br>mapa da equipe: ${MAP_PRICE} moedas`,
    table.position.x,
    2.4,
    table.position.z,
  );

  // Portal de volta ao Posto Zero.
  const portal = new THREE.Group(),
    ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.12, 12, 48),
      new THREE.MeshBasicMaterial({ color: 0x67e3f2 }),
    ),
    veil = new THREE.Mesh(
      new THREE.CircleGeometry(1.15, 40),
      new THREE.MeshBasicMaterial({
        color: 0x67e3f2,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      }),
    );
  ring.position.y = veil.position.y = 1.5;
  portal.add(ring, veil);
  portal.position.set(PORTAL.x * S, 0, (PORTAL.y + 0.6) * S);
  root.add(portal);
  label(
    root,
    '<b>VOLTAR AO POSTO ZERO</b><br>segure E aqui',
    portal.position.x,
    3.2,
    portal.position.z,
  );

  // Anel no chão marcando a área segura (cresce com o combustível do gerador).
  const safeRing = new THREE.Mesh(
    new THREE.RingGeometry(0.96, 1, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffd76a,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    }),
  );
  safeRing.rotation.x = -Math.PI / 2;
  safeRing.position.set(GENERATOR_CENTER.x * S, 0.03, GENERATOR_CENTER.y * S);
  root.add(safeRing);

  const monsters = new Map(),
    drops = new Map(),
    sky = new THREE.Color(),
    daySky = new THREE.Color(SKY),
    nightSky = new THREE.Color(NIGHT_SKY);
  let night = 0, // 0 = dia, 1 = noite, com transição suave
    lastT = null;

  return {
    update(t, view, dt) {
      ring.rotation.z = t;
      veil.material.opacity = 0.3 + Math.sin(t * 2) * 0.1;
      if (!view) return;
      // Dia ↔ noite em ~3 s pelo relógio real (aba em segundo plano não congela a transição).
      const elapsed = lastT === null ? 10 : t - lastT;
      lastT = t;
      night += ((view.clock.phase === 'night' ? 1 : 0) - night) * Math.min(1, elapsed / 3);
      sky.copy(daySky).lerp(nightSky, night);
      scene.background.copy(sky);
      scene.fog.color.copy(sky);
      scene.fog.near = 18 - 12 * night;
      scene.fog.far = 85 - 55 * night;
      hemi.intensity = 2.2 - 1.95 * night;
      sun.intensity = 1.2 * (1 - night);
      // Gerador: luz e área segura seguem o combustível; apagado, tudo escurece.
      const g = view.generator,
        radius = g.safeRadius * S;
      light.intensity = g.on ? (28 + Math.sin(t * 13) * 1.5) * (0.5 + 0.5 * night) + 10 : 0;
      light.distance = Math.max(1, radius * 1.6);
      lamp.material.color.set(g.on ? 0xffd76a : 0x2a2a2a);
      safeRing.visible = g.on;
      safeRing.scale.setScalar(Math.max(0.01, radius));
      syncMonsters(view.monsters, t, dt);
      syncDrops(view.loot);
    },
  };

  // Monstros: sucata (caixas enferrujadas, olhos vermelhos) e aparição (vulto branco que pisca).
  function makeMonster(m) {
    const g = new THREE.Group();
    if (m.type === 'scrap') {
      const rust = new THREE.MeshLambertMaterial({ color: 0x7a4b2a });
      for (const [w, h, d, x, y, z] of [
        [0.9, 0.8, 0.7, 0, 0.5, 0],
        [0.5, 0.5, 0.5, 0.25, 1.1, 0.1],
        [0.7, 0.15, 0.3, -0.3, 0.9, -0.2],
      ]) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rust);
        box.position.set(x, y, z);
        g.add(box);
      }
      for (const side of [-0.1, 0.12]) {
        const eye = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.06, 0.02),
          new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
        );
        eye.position.set(0.25 + side, 1.15, 0.36);
        g.add(eye);
      }
    } else {
      const ghost = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 2.3, 0.3),
        new THREE.MeshBasicMaterial({ color: 0xe8f2ff, transparent: true, opacity: 0.55 }),
      );
      ghost.position.y = 1.3;
      g.add(ghost);
      g.userData.ghost = ghost;
    }
    const bar = document.createElement('div'),
      fill = document.createElement('div');
    bar.className = 'hpBar';
    bar.append(fill);
    const label = new CSS2DObject(bar);
    label.position.y = 2.6;
    g.add(label);
    g.userData.fill = fill;
    g.userData.bar = bar;
    g.position.set(m.x * S, 0, m.y * S);
    root.add(g);
    return g;
  }
  function syncMonsters(list, t, dt) {
    const seen = new Set();
    for (const m of list) {
      seen.add(m.id);
      let g = monsters.get(m.id);
      if (!g) monsters.set(m.id, (g = makeMonster(m)));
      // Suaviza até a posição do servidor (20 Hz) e olha para onde anda.
      const tx = m.x * S,
        tz = m.y * S,
        dx = tx - g.position.x,
        dz = tz - g.position.z;
      if (Math.hypot(dx, dz) > 0.01) g.rotation.y = Math.atan2(dx, dz);
      g.position.x += dx * Math.min(1, dt * 10);
      g.position.z += dz * Math.min(1, dt * 10);
      g.userData.fill.style.width = `${(100 * m.hp) / m.maxHp}%`;
      g.userData.bar.hidden = m.hp >= m.maxHp;
      if (g.userData.ghost)
        g.userData.ghost.material.opacity = 0.35 + Math.abs(Math.sin(t * 9 + g.position.x)) * 0.35;
      else g.position.y = Math.abs(Math.sin(t * 10 + g.position.x)) * 0.06;
    }
    for (const [id, g] of monsters)
      if (!seen.has(id)) {
        g.userData.bar.remove();
        root.remove(g);
        monsters.delete(id);
      }
  }
  // Itens no chão do acampamento: o que os monstros soltam e mochilas de quem foi pego aqui.
  function syncDrops(loot) {
    const seen = new Set(),
      items = [
        ...(loot.drops || []).map(d => ({ ...d, kind: d.item })),
        ...(loot.bags || []).map(b => ({ ...b, kind: 'bag' })),
        ...(loot.cores || []).map(c => ({ ...c, kind: 'core_fire' })),
      ];
    for (const item of items) {
      seen.add(item.id);
      if (drops.has(item.id)) continue;
      const color = { scrap: 0x8a8f96, almond: 0x9fe7ff, core_fire: 0xff7a1a, bag: 0x5a3b22 }[
          item.kind
        ],
        mesh = new THREE.Mesh(
          item.kind === 'bag'
            ? new THREE.BoxGeometry(0.5, 0.35, 0.3)
            : new THREE.BoxGeometry(0.3, 0.3, 0.3),
          item.kind === 'bag' || item.kind === 'scrap'
            ? new THREE.MeshLambertMaterial({ color })
            : new THREE.MeshBasicMaterial({ color }),
        );
      mesh.position.set(item.x * S, 0.3, item.y * S);
      root.add(mesh);
      drops.set(item.id, mesh);
    }
    for (const [id, mesh] of drops)
      if (!seen.has(id)) {
        root.remove(mesh);
        drops.delete(id);
      }
  }
}
