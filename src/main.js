import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---- Config: swap MODEL_URL for Michelle.glb once it has walk + idle clips ----
const MODEL_URL = './models/mixamo-female-michelle.glb';   // visible character (Michelle)
const TARGET_ANKLE_TO_HEAD = 1.66;
const MODEL_NAME = 'Michelle';
const ANIM_SOURCE_URL = './models/mixamo-xbot.glb';        // walk/idle clips come from Xbot (Michelle has none)
const WALK_CLIP = 'walk', IDLE_CLIP = 'idle';
const WAYPOINTS = [[0,-8],[10,-14],[16,0],[8,12],[-6,14],[-14,2],[-10,-10]].map(([x,z]) => new THREE.Vector2(x,z));
const FOG = 0x4a5d80;
const touch = matchMedia('(pointer:coarse)').matches;

const renderer = new THREE.WebGLRenderer({ antialias: !touch });
renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(FOG, 20, 400);
const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.1, 6000);
camera.position.set(WAYPOINTS[0].x, 2.0, WAYPOINTS[0].y + 5);

// gradient sky dome (fog:false so horizon stays a gradient into fog color)
const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 24, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { h: { value: new THREE.Color(FOG) }, t: { value: new THREE.Color(0x0a1020) } },
  vertexShader: 'varying float y;void main(){y=normalize(position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: 'uniform vec3 h,t;varying float y;void main(){gl_FragColor=vec4(mix(h,t,smoothstep(0.,.5,y)),1.);}' }));
scene.add(sky);
const startTarget = true;
scene.add(new THREE.HemisphereLight(0xaabbff, 0x111122, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(5, 12, 6); scene.add(sun);

// infinite mirror: huge Reflector with a fog fade shader patch
const SIZE = 6000;
const mirror = new Reflector(new THREE.PlaneGeometry(SIZE, SIZE), {
  textureWidth: Math.floor(innerWidth * (touch ? 0.5 : 1) * Math.min(devicePixelRatio, touch ? 1 : 2)),
  textureHeight: Math.floor(innerHeight * (touch ? 0.5 : 1) * Math.min(devicePixelRatio, touch ? 1 : 2)),
  color: 0xb0b8c4, clipBias: 0.003,
  shader: {
    name: 'FogMirror',
    uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
      fogColor: { value: new THREE.Color(FOG) }, fogNear: { value: 15 }, fogFar: { value: 400 } },
    vertexShader: 'uniform mat4 textureMatrix;varying vec4 vUv;varying float vD;void main(){vUv=textureMatrix*vec4(position,1.);vec4 mv=modelViewMatrix*vec4(position,1.);vD=-mv.z;gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'uniform vec3 color,fogColor;uniform sampler2D tDiffuse;uniform float fogNear,fogFar;varying vec4 vUv;varying float vD;void main(){vec3 c=texture2DProj(tDiffuse,vUv).rgb*color*1.6;float f=smoothstep(fogNear,fogFar,vD);gl_FragColor=vec4(mix(c,fogColor,f),1.);}'
  }
});
mirror.rotation.x = -Math.PI/2; scene.add(mirror);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(WAYPOINTS[0].x, 1.1, WAYPOINTS[0].y); controls.enableDamping = true; controls.enablePan = false;
controls.minDistance = 2.5; controls.maxDistance = 40; controls.maxPolarAngle = Math.PI/2 - 0.03;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

const info = document.getElementById('info');
let dbg = new URLSearchParams(location.search).has('debug');
document.getElementById('dbg').onclick = e => { dbg = !dbg; e.target.textContent = 'Foot debug: ' + (dbg?'on':'off'); markers.forEach(m => m.visible = dbg); };

const markers = [];
const actor = new THREE.Group(); scene.add(actor);
let model, mixer, walk, idle, speed = 1, footBones = [], tmp = new THREE.Vector3();

const loader = new GLTFLoader();
const loadGLB = u => new Promise((res, rej) => loader.load(u, res, undefined, rej));
let hips, hipsRest = new THREE.Vector3(), hipsLocalRest = null;
const skinned = r => { let s; r.traverse(o => { if (o.isSkinnedMesh && !s) s = o; }); return s; };

Promise.all([loadGLB(MODEL_URL), loadGLB(ANIM_SOURCE_URL)]).then(([body, src]) => {
  model = body.scene; actor.add(model);
  model.traverse(o => { if (o.isMesh) o.frustumCulled = false; if (o.isBone && /(Foot|ToeBase)$/.test(o.name)) footBones.push(o); if (o.isBone && o.name === 'mixamorigHips') hips = o; });
  // Michelle's skeleton is authored in cm with the 0.01 scale on the mesh node only, so size by bones:
  // ankle-to-head-top height of the bind pose is normalised to ~1.66 m (≈1.75 m person).
  model.updateMatrixWorld(true);
  { let top, ank = Infinity; model.traverse(o => { if (!o.isBone) return; o.getWorldPosition(tmp);
      if (/HeadTop_End$/.test(o.name)) top = tmp.y; if (/(Left|Right)Foot$/.test(o.name)) ank = Math.min(ank, tmp.y); });
    const k = TARGET_ANKLE_TO_HEAD / (top - ank); model.scale.multiplyScalar(k); console.log('[scale]', k); }
  // Retarget Xbot clips onto the visible model (same mixamorig bone names, different rest poses/scale).
  // SkeletonUtils.retargetClip converts local rotations via rest poses and scales hip translation by hip height ratio.
  const tgtMesh = skinned(model);
  src.scene.updateMatrixWorld(true); model.updateMatrixWorld(true);
  const sameModel = MODEL_URL === ANIM_SOURCE_URL;
  // Custom same-name retarget (three's SkeletonUtils.retargetClip mishandles Michelle's rotated, cm-scaled parent node).
  // World-space delta retarget: for each bone, D = Wsrc_anim * Wsrc_rest^-1 ; Wtgt_anim = D * Wtgt_rest ;
  // local = Wtgt_anim(parent)^-1 * Wtgt_anim(bone). Both rigs are Mixamo T-pose, Y-up, facing +Z.
  const srcBones = {}; src.scene.traverse(o => { if (o.isBone) srcBones[o.name] = o; });
  const tgtBones = []; model.traverse(o => { if (o.isBone && srcBones[o.name]) tgtBones.push(o); }); // parents first
  const Q = THREE.Quaternion, q1 = new Q(), q2 = new Q();
  const restS = {}, restT = {};
  for (const b of tgtBones) { restS[b.name] = srcBones[b.name].getWorldQuaternion(new Q()); restT[b.name] = b.getWorldQuaternion(new Q()); }
  const srcMixer = new THREE.AnimationMixer(src.scene);
  const rest = hips.position.clone(), kk = 1 / model.scale.x;
  const convert = name => {
    const sc = THREE.AnimationClip.findByName(src.animations, name); if (!sc) throw new Error('no clip ' + name);
    const act = srcMixer.clipAction(sc); act.play();
    const n = Math.max(2, Math.round(sc.duration * 30)), times = [], vals = {}, hp = [];
    for (const b of tgtBones) vals[b.name] = [];
    let p0 = null;
    for (let i = 0; i <= n; i++) {
      const t = i * sc.duration / n; times.push(t); srcMixer.setTime(t); src.scene.updateMatrixWorld(true);
      const worldAnim = {};
      for (const b of tgtBones) {
        const sb = srcBones[b.name];
        const D = sb.getWorldQuaternion(q1).multiply(q2.copy(restS[b.name]).invert());   // world delta
        const wt = D.clone().multiply(restT[b.name]); worldAnim[b.name] = wt;
        const pw = b.parent && worldAnim[b.parent.name] ? worldAnim[b.parent.name] : (b.parent ? b.parent.getWorldQuaternion(new Q()) : new Q());
        vals[b.name].push(...pw.clone().invert().multiply(wt).toArray());
      }
      const hs = srcBones['mixamorigHips'].position; if (!p0) p0 = hs.clone();
      // hips: lateral sway + vertical bob only (in-place); Michelle hips local: up = -Z, 1 unit = 1 cm at 0.01 scale
      hp.push(rest.x + (hs.x - p0.x) * kk, rest.y, rest.z - (hs.y - p0.y) * kk);
    }
    srcMixer.stopAllAction(); srcMixer.uncacheClip(sc);
    const tracks = tgtBones.map(b => new THREE.QuaternionKeyframeTrack(`.bones[${b.name}].quaternion`, times, vals[b.name]));
    tracks.push(new THREE.VectorKeyframeTrack('.bones[mixamorigHips].position', times, hp));
    return new THREE.AnimationClip(name, sc.duration, tracks);
  };
  const wc = convert(WALK_CLIP), ic = convert(IDLE_CLIP);
  model.updateMatrixWorld(true);
  mixer = new THREE.AnimationMixer(tgtMesh);
  walk = mixer.clipAction(wc); idle = mixer.clipAction(ic);
  walk.play(); idle.play(); walk.setEffectiveWeight(1); idle.setEffectiveWeight(0);
  mixer.setTime(0); model.updateMatrixWorld(true);
  hips.getWorldPosition(tmp); actor.worldToLocal(tmp); hipsRest.copy(tmp);

  // Measure stride: foot travel relative to the hips along actor forward (+Z) per cycle.
  // Backward travel of a foot during stance (sum of negative z deltas) = body travel per cycle.
  const left = footBones.find(b => /LeftFoot$/.test(b.name)), right = footBones.find(b => /RightFoot$/.test(b.name));
  const N = 240, dur = wc.duration; const res = {};
  for (const [k, foot] of [['L', left], ['R', right]]) {
    let back = 0, prev = null, hx = 0, hz = 0;
    for (let i = 0; i <= N; i++) {
      mixer.setTime(i / N * dur); model.updateMatrixWorld(true);
      foot.getWorldPosition(tmp); actor.worldToLocal(tmp); const fz = tmp.z;
      hips.getWorldPosition(tmp); actor.worldToLocal(tmp); const rel = fz - tmp.z;
      hx = Math.max(hx, Math.abs(tmp.x - hipsRest.x)); hz = Math.max(hz, Math.abs(tmp.z - hipsRest.z));
      if (prev !== null && rel < prev) back += prev - rel;
      prev = rel;
    }
    res[k] = { stride: back, hipDriftX: hx, hipDriftZ: hz };
  }
  const stride = (res.L.stride + res.R.stride) / 2;
  speed = stride / dur; mixer.setTime(0);
  info.textContent = `${MODEL_NAME} (Xbot walk/idle retargeted): cycle ${dur.toFixed(2)}s, stride ${stride.toFixed(2)}m → ${speed.toFixed(2)} m/s`;
  console.log('[stride]', JSON.stringify({ cycle: dur, stride, speed, res, hipsRest: hipsRest.toArray(), modelScale: model.scale.x }));
  document.getElementById('dbg').textContent = 'Foot debug: ' + (dbg?'on':'off');
window.__strideReady = true;
  for (const b of footBones) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05), new THREE.MeshBasicMaterial({ color: 0xff3333, depthTest: false }));
    m.renderOrder = 10; m.visible = dbg; m.userData.bone = b; scene.add(m); markers.push(m);
  }
}).catch(e => { info.textContent = 'load error: ' + e.message; console.error(e); });

// walker state
let wp = 1, heading = 0, state = 'walk', wait = 0, blend = 1;
actor.position.set(WAYPOINTS[0].x, 0, WAYPOINTS[0].y);
const clock = new THREE.Clock();
const shortest = (a, b) => Math.atan2(Math.sin(b-a), Math.cos(b-a));

function step(dt) {
  const target = WAYPOINTS[wp], dx = target.x - actor.position.x, dz = target.y - actor.position.z;
  const dist = Math.hypot(dx, dz), want = Math.atan2(dx, dz), err = shortest(heading, want);
  let moving = false;
  if (state === 'wait') { wait -= dt; if (wait <= 0) state = 'turn'; }
  else if (state === 'turn') { // turn in place while idle
    const r = 2.2*dt; heading += Math.abs(err) < r ? err : Math.sign(err)*r;
    if (Math.abs(err) < 0.05) state = 'walk';
  } else {
    if (dist < 0.3) { wp = (wp+1) % WAYPOINTS.length; state = 'wait'; wait = 0.4; }
    else { // small steering while walking; large angle error → stop and turn first
      if (Math.abs(err) > 0.6) state = 'turn';
      else { heading += err * Math.min(1, 4*dt); moving = true; }
    }
  }
  blend += ((moving ? 1 : 0) - blend) * Math.min(1, 8*dt);
  if (moving) { actor.position.x += Math.sin(heading)*speed*dt*blend; actor.position.z += Math.cos(heading)*speed*dt*blend; }
  actor.rotation.y = heading;
  if (walk) {
    walk.setEffectiveWeight(blend); idle.setEffectiveWeight(1 - blend);
    walk.setEffectiveTimeScale(1); mixer.update(dt);
  }
}

function plantFeet() {
  if (!model) return;
  model.position.set(0, 0, 0); actor.updateMatrixWorld(true);
  if (hips) { hips.getWorldPosition(tmp); actor.worldToLocal(tmp); model.position.x = hipsRest.x - tmp.x; model.position.z = hipsRest.z - tmp.z; actor.updateMatrixWorld(true); }
  let low = Infinity;
  for (const b of footBones) { b.getWorldPosition(tmp); low = Math.min(low, tmp.y - (/ToeBase$/.test(b.name) ? 0 : 0.07)); }
  // floor clamp: lowest foot sole rests on y=0 (ankle sits ~7cm above sole on Mixamo rigs; toe base ~0)
  model.position.y = -low;  // vertical clamp only; x/z hip drift cancelled above (in-place playback)
  actor.updateMatrixWorld(true);
  for (const m of markers) {
    m.userData.bone.getWorldPosition(tmp); m.position.copy(tmp);
    const sole = tmp.y - (/ToeBase$/.test(m.userData.bone.name) ? 0 : 0.07);
    m.material.color.set(sole < 0.03 ? 0x33ff66 : 0xff3333);
  }
}

addEventListener('resize', () => { camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const offset = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  step(dt); plantFeet();
  // follow: move camera with actor, keep user's orbit offset
  const t = new THREE.Vector3(actor.position.x, 1.1, actor.position.z);
  offset.copy(camera.position).sub(controls.target);
  controls.target.lerp(t, 1 - Math.exp(-6*dt));
  camera.position.copy(controls.target).add(offset);
  controls.update();
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
});
document.getElementById('dbg').textContent = 'Foot debug: ' + (dbg?'on':'off');
window.__stride = { actor, get speed(){return speed;} };
