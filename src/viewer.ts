// Studio viewer for iterating on characters: ?view=cloud&yaw=0.6&zoom=1&pose=idle
import * as THREE from 'three/webgpu';
import { U } from './core/env';

export async function runViewer(renderer: THREE.WebGPURenderer, what: string, params: URLSearchParams) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.08, 0.09, 0.11);
  const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.05, 200);
  const key = new THREE.DirectionalLight(0xfff1e0, 3.2);
  key.position.set(2, 3, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -3;
  key.shadow.camera.right = key.shadow.camera.top = 3;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 2.0);
  rim.position.set(-2, 2, -3);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x3a3228, 0.9));
  U.sunDir.value.set(2, 3, 3).normalize();
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: 0x2a2c30, roughness: 0.9 }));
  floor.receiveShadow = true;
  scene.add(floor);

  let target = new THREE.Vector3(0, 1.0, 0);
  let dist = 4.2;
  let update: (dt: number, t: number) => void = () => {};
  const zoom = parseFloat(params.get('zoom') || '1');

  if (what === 'cloud') {
    const { buildCloud } = await import('./characters/cloud');
    const t0 = performance.now();
    const c = buildCloud('high');
    console.log('[viewer] cloud built in', (performance.now() - t0).toFixed(0), 'ms', 'body verts', c.body.geometry.attributes.position.count, 'head verts', c.head.geometry.attributes.position.count);
    scene.add(c.group);
    if (params.has('dbgmat')) {
      const { attribute, vec3, float, mix, abs, saturate } = await import('three/tsl');
      const dm = new THREE.MeshBasicNodeMaterial();
      const kind = attribute('pbr', 'vec4').z;
      const pal = [vec3(1, 0.6, 0.5), vec3(0.2, 0.3, 1), vec3(0.6, 0.3, 0.1), vec3(0.8, 0.8, 0.8), vec3(1, 1, 0), vec3(1, 0.5, 0), vec3(0, 1, 0.5), vec3(0, 1, 0), vec3(1, 1, 1), vec3(0, 1, 1)];
      let col: any = vec3(0);
      pal.forEach((c, i) => (col = col.add(c.mul(saturate(float(1).sub(abs(kind.sub(i)).mul(4)))))));
      dm.colorNode = col;
      c.body.material = dm;
      c.head.material = dm;
      void mix;
    }
    if (params.get('only') === 'head') c.body.visible = false;
    if (params.get('only') === 'body') c.head.visible = false;
    if (params.has('noskin')) {
      for (const sm of [c.body, c.head]) {
        const plain = new THREE.Mesh(sm.geometry, sm.material);
        plain.visible = sm.visible;
        c.group.remove(sm);
        c.group.add(plain);
      }
    }
    const hand = c.rig.bones['hand.R'];
    hand.add(c.sword);
    c.sword.position.set(-0.04, -0.07, 0.0);
    c.sword.rotation.set(0, 0, Math.PI - 0.6);
    const pose = params.get('pose');
    if (pose === 'tpose') {
      c.rig.bones['uarm.L'].rotation.z = 0.9;
      c.rig.bones['uarm.R'].rotation.z = -0.9;
    }
    if (params.has('head')) {
      target = new THREE.Vector3(0, 1.66, 0);
      dist = 0.9;
    }
    update = (_dt, t) => {
      c.rig.bones['chest'].rotation.x = Math.sin(t * 1.4) * 0.01;
    };
  }

  if (what === 'actor') {
    const { CloudActor } = await import('./characters/cloudActor');
    const a = new CloudActor('high');
    scene.add(a.root);
    const base = (params.get('base') || 'combat') as any;
    a.setBase(base);
    if (base === 'combat') a.attachSword('hand', true);
    const clip = params.get('clip');
    const at = parseFloat(params.get('t') || '0');
    const phase = parseFloat(params.get('phase') || '0');
    if (params.has('move')) {
      a.moveAmount = 1;
      a.speed = parseFloat(params.get('move')!);
    }
    // Settle the base blend, then jump the clip to the requested time.
    for (let i = 0; i < 60; i++) a.update(1 / 60);
    a.gaitPhase = phase;
    if (clip) {
      const act = a.play(clip, { fadeIn: 0.0001 });
      act.t = at;
      a.update(0.0001);
      act.weight = 1;
    }
    a.update(0.0001);
    update = () => {};
    target = new THREE.Vector3(0, 1.0, 0);
    dist = 4.6;
  }

  if (what === 'choco') {
    const { ChocoboActor } = await import('./characters/chocobo');
    const t0 = performance.now();
    const c = new ChocoboActor('high');
    console.log('[viewer] chocobo built in', (performance.now() - t0).toFixed(0), 'ms');
    scene.add(c.root);
    const spd = parseFloat(params.get('speed') || '0');
    const sim = parseFloat(params.get('sim') || '0');
    c.resetFeet();
    for (let t = 0; t < sim; t += 1 / 60) {
      c.speed = spd;
      c.root.position.z += spd / 60;
      c.update(1 / 60);
    }
    c.update(0.001);
    target = new THREE.Vector3(0, 1.3, c.root.position.z);
    floor.position.z = c.root.position.z;
    key.target.position.copy(target);
    scene.add(key.target);
    key.position.copy(target).add(new THREE.Vector3(2, 3, 3));
    dist = 5.2;
    if (params.has('rider')) {
      const { CloudActor } = await import('./characters/cloudActor');
      const a = new CloudActor('high');
      a.setBase('ride');
      c.saddle.add(a.root);
      a.root.position.set(0, -0.93, 0.02);
      for (let i = 0; i < 30; i++) a.update(1 / 60);
    }
  }

  if (what === 'monster') {
    const { MonsterActor } = await import('./characters/monster');
    const t0 = performance.now();
    const m = new MonsterActor('high');
    console.log('[viewer] monster built in', (performance.now() - t0).toFixed(0), 'ms');
    scene.add(m.root);
    m.glow.value = 1.2;
    const st = (params.get('state') || 'idle') as any;
    const spd = parseFloat(params.get('speed') || '0');
    const sim = parseFloat(params.get('sim') || '0');
    m.setState(st);
    for (let t = 0; t < sim; t += 1 / 60) {
      m.speed = spd;
      m.root.position.z += spd / 60;
      m.update(1 / 60);
    }
    m.update(0.001);
    target = new THREE.Vector3(0, 1.1, m.root.position.z - 0.4);
    floor.position.z = m.root.position.z;
    key.target.position.copy(target);
    scene.add(key.target);
    key.position.copy(target).add(new THREE.Vector3(2, 3, 3));
    dist = parseFloat(params.get('dist') || '7');
    if (params.has('headshot')) {
      target = m.point('head').add(new THREE.Vector3(0, 0, 0.2));
      dist = 1.8;
    }
  }

  if (what === 'serpent') {
    const { SerpentActor } = await import('./characters/serpent');
    const t0 = performance.now();
    const sp = new SerpentActor('high');
    console.log('[viewer] serpent built in', (performance.now() - t0).toFixed(0), 'ms');
    scene.add(sp.root);
    const P = [
      [0, 8, 0],
      [0, 7, -4],
      [1, 4, -9],
      [0, 0.5, -14],
      [-2, -1.5, -20],
      [0, 2, -27],
      [2, -3, -36],
    ];
    P.forEach((p, i) => sp.curvePts[i].set(p[0], p[1], p[2]));
    sp.headDir.set(0, -0.2, 1);
    sp.jawOpen = parseFloat(params.get('jaw') || '0.3');
    sp.frill = 1;
    sp.update(0.016);
    if (params.has('nrm')) sp.body.material = new THREE.MeshNormalNodeMaterial();
    if (params.has('stdmat')) sp.body.material = new THREE.MeshStandardNodeMaterial({ color: 0x0a2018, roughness: 0.6 });
    if (params.has('noemi')) {
      const { vec3 } = await import('three/tsl');
      (sp.body.material as any).emissiveNode = vec3(0, 0, 0);
    }
    if (params.has('nonrm')) {
      (sp.body.material as any).normalNode = null;
      (sp.body.material as any).clearcoatNode = null;
      (sp.body.material as any).needsUpdate = true;
    }
    if (params.has('nocol')) {
      const { vec3 } = await import('three/tsl');
      (sp.body.material as any).colorNode = vec3(1, 0, 0);
    }
    floor.scale.setScalar(8);
    target = new THREE.Vector3(0, 5, -8);
    dist = parseFloat(params.get('dist') || '30');
    key.shadow.camera.left = key.shadow.camera.bottom = -30;
    key.shadow.camera.right = key.shadow.camera.top = 30;
    key.shadow.camera.far = 100;
    key.position.set(20, 30, 20);
    if (params.has('headshot')) {
      target = sp.headCenter();
      dist = 9;
    }
  }

  if (what === 'knights') {
    const { KnightActor, KNIGHTS, KP } = await import('./cinematics/knights');
    const t0 = performance.now();
    const ks = KNIGHTS.map((d, i) => {
      const k = new KnightActor(d, 1);
      k.root.position.set((i - 6) * 1.1, 0, 0);
      k.dissolve.value = 0;
      k.setPose(KP[params.get('pose') || 'stand'] ?? KP.stand, 0.001);
      k.update(0.1);
      scene.add(k.root);
      return k;
    });
    console.log('[viewer] knights built in', (performance.now() - t0).toFixed(0), 'ms', ks.length);
    floor.scale.setScalar(2);
    target = new THREE.Vector3(0, 1.1, 0);
    dist = parseFloat(params.get('dist') || '12');
    key.shadow.camera.left = key.shadow.camera.bottom = -8;
    key.shadow.camera.right = key.shadow.camera.top = 8;
  }

  const yaw = parseFloat(params.get('yaw') || '0.5');
  const pitch = parseFloat(params.get('pitch') || '0.08');
  const place = () => {
    const d = dist / zoom;
    camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * d, target.y + Math.sin(pitch) * d, target.z + Math.cos(yaw) * Math.cos(pitch) * d);
    camera.lookAt(target);
  };
  place();
  const clock = new THREE.Clock();
  let frames = 0;
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    U.time.value += dt;
    update(dt, U.time.value);
    renderer.render(scene, camera);
    (window as any).__frames = ++frames;
  });
}
