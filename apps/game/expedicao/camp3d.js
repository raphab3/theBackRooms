// Acampamento a céu aberto: chão de grama seca, cerca, postes de concreto, o gerador no centro com a
// luz da área segura, as edificações (porta e letreiro) e o portal de volta ao Posto Zero.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CAMP_SIZE, GENERATOR, PORTAL } from '@backrooms/shared/camp.js';
import { wallpaper } from '../lobby/scene.js';
import { S } from './level.js';

const SKY = 0xc4c8bd;

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
  root.add(new THREE.HemisphereLight(0xf1f2e6, 0x5b5432, 2.2));
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

  return {
    update(t) {
      ring.rotation.z = t;
      veil.material.opacity = 0.3 + Math.sin(t * 2) * 0.1;
      light.intensity = 28 + Math.sin(t * 13) * 1.5;
    },
  };
}
