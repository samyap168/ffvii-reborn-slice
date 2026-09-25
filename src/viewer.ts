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
