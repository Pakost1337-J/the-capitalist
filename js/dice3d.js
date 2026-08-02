import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const DEG = Math.PI / 180;
const SIZE = 1;

/** Top face (+Y): faces +X=3 -X=4 +Y=2 -Y=5 +Z=1 -Z=6 */
const TOP_EULER = {
  1: [90 * DEG, 0, 0],
  2: [0, 0, 0],
  3: [0, 0, -90 * DEG],
  4: [0, 0, 90 * DEG],
  5: [180 * DEG, 0, 0],
  6: [-90 * DEG, 0, 0],
};

const PIP_LAYOUT = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
};

function easeOutCubic(t) { return 1 - (1 - t) ** 3; }
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}
function clampDie(n) {
  const v = Number(n) || 1;
  return Math.min(6, Math.max(1, v));
}

function makeFaceTexture(value) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#f5f5f5');
  g.addColorStop(1, '#e6e6e6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const hg = ctx.createRadialGradient(s * 0.3, s * 0.24, 2, s * 0.3, s * 0.24, s * 0.55);
  hg.addColorStop(0, 'rgba(255,255,255,0.9)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, s, s);
  const cell = s / 3;
  const r = s * 0.09;
  for (const [gx, gy] of PIP_LAYOUT[value] || PIP_LAYOUT[1]) {
    const x = cell * (gx + 0.5);
    const y = cell * (gy + 0.5);
    const pg = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, 1, x, y, r);
    pg.addColorStop(0, '#222');
    pg.addColorStop(0.6, '#0a0a0a');
    pg.addColorStop(1, '#000');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = pg;
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeDieMesh() {
  const root = new THREE.Group();

  const body = new THREE.Mesh(
    new RoundedBoxGeometry(SIZE, SIZE, SIZE, 4, 0.13),
    new THREE.MeshStandardMaterial({ color: 0xf3f3f3, roughness: 0.42, metalness: 0.05 }),
  );
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  // Грани поверх скруглённого тела (чуть выступают)
  const faceSize = SIZE * 0.78;
  const d = SIZE * 0.505;
  const faces = [
    { v: 3, p: [d, 0, 0], r: [0, Math.PI / 2, 0] },
    { v: 4, p: [-d, 0, 0], r: [0, -Math.PI / 2, 0] },
    { v: 2, p: [0, d, 0], r: [-Math.PI / 2, 0, 0] },
    { v: 5, p: [0, -d, 0], r: [Math.PI / 2, 0, 0] },
    { v: 1, p: [0, 0, d], r: [0, 0, 0] },
    { v: 6, p: [0, 0, -d], r: [0, Math.PI, 0] },
  ];

  for (const f of faces) {
    const mat = new THREE.MeshStandardMaterial({
      map: makeFaceTexture(f.v),
      roughness: 0.4,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(faceSize, faceSize), mat);
    plane.position.set(f.p[0], f.p[1], f.p[2]);
    plane.rotation.set(f.r[0], f.r[1], f.r[2]);
    plane.castShadow = false;
    root.add(plane);
  }

  return root;
}

function finalQuat(value, twistZ = 0) {
  const [x, y, z] = TOP_EULER[clampDie(value)] || TOP_EULER[1];
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z + twistZ, 'XYZ'));
}

export class DiceScene {
  constructor(container) {
    this.container = container;
    this.values = [5, 4];
    this.doubles = false;
    this.throwing = false;
    this._raf = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'dice-canvas';
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
    this.camera.position.set(0, 4.2, 5.6);
    this.camera.lookAt(0, 0.15, 0);

    this.scene.add(new THREE.AmbientLight(0xfff0e0, 0.75));
    const key = new THREE.DirectionalLight(0xfff5e8, 1.4);
    key.position.set(3.2, 7.5, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 20;
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    key.shadow.bias = -0.0008;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xc8e0ff, 0.4);
    fill.position.set(-4, 3, -2);
    this.scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 8),
      new THREE.ShadowMaterial({ opacity: 0.3 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.dieA = makeDieMesh();
    this.dieB = makeDieMesh();
    this.groupA = new THREE.Group();
    this.groupB = new THREE.Group();
    this.groupA.add(this.dieA);
    this.groupB.add(this.dieB);
    this.scene.add(this.groupA, this.groupB);

    this.rest = {
      a: { x: -0.95, z: 0.08, twist: -8 * DEG },
      b: { x: 0.95, z: -0.05, twist: 12 * DEG },
    };

    this.setValues(5, 4);
    this.resize();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  setValues(v1, v2, { doubles = false } = {}) {
    this.values = [clampDie(v1), clampDie(v2)];
    this.doubles = !!doubles;
    if (!this.throwing) this._placeRest(this.values[0], this.values[1]);
  }

  _placeRest(v1, v2) {
    const { a, b } = this.rest;
    this.groupA.position.set(a.x, SIZE / 2, a.z);
    this.groupB.position.set(b.x, SIZE / 2, b.z);
    this.dieA.quaternion.copy(finalQuat(v1, a.twist));
    this.dieB.quaternion.copy(finalQuat(v2, b.twist));
    const s = this.doubles ? 1.02 : 1;
    this.dieA.scale.setScalar(s);
    this.dieB.scale.setScalar(s);
  }

  async throw(v1, v2, { doubles = false } = {}) {
    const values = [clampDie(v1), clampDie(v2)];
    this.values = values;
    this.doubles = !!doubles;
    this.throwing = true;
    this.container.classList.add('table-toss--throwing');
    this.container.classList.remove('table-toss--landed');
    await Promise.all([
      this._throwOne(this.groupA, this.dieA, values[0], this.rest.a, 0),
      this._throwOne(this.groupB, this.dieB, values[1], this.rest.b, 70),
    ]);
    this.throwing = false;
    this.container.classList.remove('table-toss--throwing');
    this.container.classList.add('table-toss--landed');
    this._placeRest(values[0], values[1]);
  }

  _throwOne(group, die, value, rest, delayMs) {
    return new Promise((resolve) => {
      const startAt = performance.now() + delayMs;
      const duration = 1000;
      const endQ = finalQuat(value, rest.twist);
      const startQ = die.quaternion.clone();
      const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        (360 + Math.random() * 200) * DEG,
        (200 + Math.random() * 160) * DEG,
        (80 + Math.random() * 100) * DEG,
        'XYZ',
      ));
      const midQ = startQ.clone().multiply(spin);
      const peakY = 2.6 + Math.random() * 0.35;
      const startX = rest.x * 0.3;
      const startZ = rest.z - 0.4;
      group.position.set(startX, SIZE / 2 + 0.2, startZ);

      const step = (now) => {
        if (now < startAt) { requestAnimationFrame(step); return; }
        const t = Math.min(1, (now - startAt) / duration);
        let y; let q;
        if (t < 0.36) {
          const u = easeOutCubic(t / 0.36);
          y = SIZE / 2 + 0.2 + (peakY - SIZE / 2) * u;
          q = startQ.clone().slerp(midQ, u);
          group.position.x = startX + (rest.x - startX) * u * 0.4;
          group.position.z = startZ + (rest.z - startZ) * u * 0.4;
        } else if (t < 0.78) {
          const u = easeInOutCubic((t - 0.36) / 0.42);
          y = peakY + (SIZE / 2 - peakY) * u;
          q = midQ.clone().slerp(endQ, Math.min(1, u * 1.2));
          group.position.x = startX + (rest.x - startX) * (0.4 + 0.6 * u);
          group.position.z = startZ + (rest.z - startZ) * (0.4 + 0.6 * u);
        } else {
          const u = (t - 0.78) / 0.22;
          y = SIZE / 2 + Math.sin(u * Math.PI) * 0.24 * (1 - u);
          q = endQ;
          group.position.x = rest.x;
          group.position.z = rest.z;
        }
        group.position.y = y;
        die.quaternion.copy(q);
        if (t < 1) requestAnimationFrame(step);
        else {
          group.position.set(rest.x, SIZE / 2, rest.z);
          die.quaternion.copy(endQ);
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  _loop() {
    this._raf = requestAnimationFrame(this._loop);
    if (this.doubles && !this.throwing) {
      const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.015;
      this.dieA.scale.setScalar(pulse);
      this.dieB.scale.setScalar(pulse);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._ro?.disconnect();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}