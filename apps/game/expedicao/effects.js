// Efeitos do Braço de Fogo: projétil, faíscas no impacto, clarão de luz e som. Tudo reaproveitado
// de pools pequenos, para disparar a 4 tiros/s sem criar lixo a cada quadro.
import * as THREE from 'three';

const SPEED = 40, // m/s do projétil (só visual; o acerto já foi decidido no servidor)
  SPARKS = 24,
  SPARK_LIFE = 0.45;

export function createEffects(scene) {
  const shots = [],
    bursts = [],
    flashes = [new THREE.PointLight(0xff8a2a, 0, 6), new THREE.PointLight(0xff8a2a, 0, 6)];
  for (const light of flashes) scene.add(light);
  let flashIndex = 0;
  const ballGeo = new THREE.SphereGeometry(1, 10, 8),
    ballMat = new THREE.MeshBasicMaterial({ color: 0xffb347 }),
    sparkMat = new THREE.PointsMaterial({
      color: 0xffa040,
      size: 0.08,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

  function flash(pos, power) {
    const light = flashes[flashIndex++ % flashes.length];
    light.position.copy(pos);
    light.intensity = power;
  }

  function burst(pos, big) {
    const positions = new Float32Array(SPARKS * 3),
      velocities = [];
    for (let i = 0; i < SPARKS; i++) {
      positions.set([pos.x, pos.y, pos.z], i * 3);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5)
        .normalize()
        .multiplyScalar((big ? 6 : 3) * (0.4 + Math.random()));
      velocities.push(v);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, sparkMat.clone());
    points.material.size = big ? 0.14 : 0.08;
    scene.add(points);
    bursts.push({ points, velocities, age: 0 });
    flash(pos, big ? 22 : 8);
  }

  return {
    /** Dispara de `from` até `to` (vetores em metros); `big` = tiro carregado. */
    fire(from, to, big) {
      const ball = new THREE.Mesh(ballGeo, ballMat);
      ball.scale.setScalar(big ? 0.18 : 0.07);
      ball.position.copy(from);
      scene.add(ball);
      shots.push({ ball, from: from.clone(), to: to.clone(), t: 0, len: from.distanceTo(to), big });
      flash(from, big ? 10 : 4);
    },
    update(dt) {
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.t += (dt * SPEED) / Math.max(0.01, s.len);
        s.ball.position.lerpVectors(s.from, s.to, Math.min(1, s.t));
        if (s.t >= 1) {
          scene.remove(s.ball);
          burst(s.to, s.big);
          shots.splice(i, 1);
        }
      }
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i],
          attr = b.points.geometry.attributes.position;
        b.age += dt;
        for (let k = 0; k < SPARKS; k++) {
          b.velocities[k].y -= 9 * dt;
          attr.array[k * 3] += b.velocities[k].x * dt;
          attr.array[k * 3 + 1] += b.velocities[k].y * dt;
          attr.array[k * 3 + 2] += b.velocities[k].z * dt;
        }
        attr.needsUpdate = true;
        b.points.material.opacity = Math.max(0, 1 - b.age / SPARK_LIFE);
        if (b.age >= SPARK_LIFE) {
          scene.remove(b.points);
          b.points.geometry.dispose();
          b.points.material.dispose();
          bursts.splice(i, 1);
        }
      }
      for (const light of flashes) light.intensity = Math.max(0, light.intensity - dt * 60);
    },
  };
}

/** Som do disparo e da explosão, gerados com Web Audio (sem arquivos). */
export function createSfx() {
  let ctx = null;
  const start = () => {
    try {
      ctx ??= new AudioContext();
    } catch {}
  };
  for (const type of ['pointerdown', 'keydown'])
    addEventListener(type, start, { once: true, capture: true });
  function noise(duration, from, to, volume) {
    if (!ctx) return;
    const length = Math.floor(ctx.sampleRate * duration),
      buffer = ctx.createBuffer(1, length, ctx.sampleRate),
      data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + duration);
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
  }
  return {
    shot: big => noise(big ? 0.35 : 0.12, big ? 1800 : 3500, 200, big ? 0.5 : 0.25),
    boom: () => noise(0.6, 900, 60, 0.6),
  };
}
