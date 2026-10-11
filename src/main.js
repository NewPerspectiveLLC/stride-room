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
const LEAD = 3.5;   // Soldier starts this many metres ahead of Michelle along the ring
const FOG = 0x4a5d80;
const touch = matchMedia('(pointer:coarse)').matches;

const renderer = new THREE.WebGLRenderer({ antialias: !touch });
renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(FOG, 20, 400);
const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.1, 6000);
camera.position.set(14.5, 2.2, 0);

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
controls.target.set(10, 1.1, 0); controls.enableDamping = true; controls.enablePan = false;
controls.minDistance = 2.5; controls.maxDistance = 40; controls.maxPolarAngle = Math.PI/2 - 0.03;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

const info = document.getElementById('info');
let dbg = new URLSearchParams(location.search).has('debug');
document.getElementById('dbg').onclick = e => { dbg = !dbg; e.target.textContent = 'Foot debug: ' + (dbg?'on':'off'); markers.forEach(m => m.visible = dbg); };


// ---------------- stone path (circular flagstone ring) ----------------
const RING_R = 10, PATH_W = 1.4, FLOOR_Y = 0.04;   // FLOOR_Y = mean top surface of the stones; feet are planted here on the path
const ringPos = (s, lane = 0) => { const a = s / RING_R, r = RING_R + lane; return [r*Math.cos(a), r*Math.sin(a)]; };
const ringHeading = s => { const a = s / RING_R; return Math.atan2(-Math.sin(a), Math.cos(a)); }; // tangent (dx,dz) -> yaw
const stoneStats = { count: 0, min: Infinity, max: 0 };
{
  let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const VARIANTS = 6, geos = [], insts = [];
  for (let v = 0; v < VARIANTS; v++) {
    const sides = 7 + (v % 3), g = new THREE.CylinderGeometry(0.46, 0.5, 1, sides, 1);   // slightly narrower top = bevelled edge
    const ph = [rnd()*6.28, rnd()*6.28, rnd()*6.28], pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), ang = Math.atan2(z, x);
      const k = 1 + 0.10*Math.sin(2*ang+ph[0]) + 0.07*Math.sin(3*ang+ph[1]) + 0.04*Math.sin(5*ang+ph[2]);  // seam-safe (function of angle)
      pos.setX(i, x*k); pos.setZ(i, z*k);
    }
    g.computeVertexNormals(); geos.push(g);
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0, flatShading: true });
  const lists = geos.map(() => []);
  const LANES = 3, laneW = PATH_W / LANES, circ = 2*Math.PI*RING_R;
  for (let l = 0; l < LANES; l++) {
    let s = rnd() * 0.3;
    while (s < circ - 0.5) {
      const len = 0.38 + rnd()*0.30, wid = laneW * (0.82 + rnd()*0.22), th = 0.07 + rnd()*0.02;
      const sc = s + len/2; s += len + 0.035 + rnd()*0.03;   // small gaps
      const lane = (l - (LANES-1)/2) * laneW + (rnd()-0.5)*0.05;
      lists[Math.floor(rnd()*VARIANTS)].push({ sc, lane, len, wid, th });
      stoneStats.min = Math.min(stoneStats.min, len, wid); stoneStats.max = Math.max(stoneStats.max, len, wid);
    }
  }
  const tones = [0xb0aca4, 0x9c9a94, 0xbdb5a8, 0xa89a86, 0x8d877d, 0xb5a994, 0x9aa0a4].map(c => new THREE.Color(c));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sv = new THREE.Vector3(), col = new THREE.Color();
  lists.forEach((list, v) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geos[v], mat, list.length);
    list.forEach((st, i) => {
      const [x, z] = ringPos(st.sc, st.lane), top = FLOOR_Y + (rnd()-0.5)*0.008;
      p.set(x, top - st.th/2, z);
      e.set((rnd()-0.5)*0.03, ringHeading(st.sc) + (rnd()-0.5)*0.5, (rnd()-0.5)*0.03, 'YXZ'); q.setFromEuler(e);
      sv.set(st.wid, st.th, st.len);   // cylinder local: x across, z along (before yaw)
      m4.compose(p, q, sv); im.setMatrixAt(i, m4);
      col.copy(tones[Math.floor(rnd()*tones.length)]).multiplyScalar(0.85 + rnd()*0.3); im.setColorAt(i, col);
    });
    stoneStats.count += list.length; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; scene.add(im);
  });
  console.log('[stones]', JSON.stringify(stoneStats));
}

// ---------------- characters ----------------
const markers = [];
const loader = new GLTFLoader();
const loadGLB = u => new Promise((res, rej) => loader.load(u, res, undefined, rej));
const skinned = r => { let s; r.traverse(o => { if (o.isSkinnedMesh && !s) s = o; }); return s; };
const tmp = new THREE.Vector3();
const shortest = (a, b) => Math.atan2(Math.sin(b-a), Math.cos(b-a));
const characters = [];
let pace = 0.9;   // shared ground speed (m/s) = Michelle's stride-matched speed

// opts: {name, url, animUrl|null (native clips), walk, idle, height, s0, laneOffset}
async function buildCharacter(opts) {
  const ch = { name: opts.name, actor: new THREE.Group(), speed: 1, ts: 1, blend: 0, state: 'turn', s: opts.s0, footBones: [], lane: opts.lane || 0 };
  scene.add(ch.actor);
  const [body, src] = await Promise.all([loadGLB(opts.url), opts.animUrl ? loadGLB(opts.animUrl) : Promise.resolve(null)]);
  const model = ch.model = body.scene; ch.actor.add(model);
  let hips;
  model.traverse(o => { if (o.isMesh) o.frustumCulled = false; if (o.isBone && /(Foot|ToeBase)$/.test(o.name)) ch.footBones.push(o); if (o.isBone && o.name === 'mixamorigHips') hips = o; });
  ch.hips = hips;
  // size by bones: ankle-to-head-top of the bind pose normalised (handles cm-scaled rigs)
  model.updateMatrixWorld(true);
  { let top, headY, ank = Infinity; model.traverse(o => { if (!o.name) return; o.getWorldPosition(tmp);
      if (/HeadTop_End$/.test(o.name)) top = tmp.y; if (/Head$/.test(o.name)) headY = tmp.y; if (o.isBone && /(Left|Right)Foot$/.test(o.name)) ank = Math.min(ank, tmp.y); });
    if (top === undefined) top = headY + 0.12 * (headY - ank);   // Soldier's glb has no HeadTop_End node: estimate crown above the Head bone
    const k = opts.height / (top - ank); model.scale.multiplyScalar(k); console.log('[scale]', opts.name, k); }
  const tgtMesh = skinned(model);
  model.updateMatrixWorld(true);
  let wc, ic;
  if (src) {
    // World-space delta retarget (Mixamo T-pose, Y-up, +Z facing) from the animation-source rig onto this rig by bone name.
    src.scene.updateMatrixWorld(true);
    const srcBones = {}; src.scene.traverse(o => { if (o.isBone) srcBones[o.name] = o; });
    const tgtBones = []; model.traverse(o => { if (o.isBone && srcBones[o.name]) tgtBones.push(o); });
    const Q = THREE.Quaternion, q1 = new Q(), q2 = new Q();
    const restS = {}, restT = {};
    for (const b of tgtBones) { restS[b.name] = srcBones[b.name].getWorldQuaternion(new Q()); restT[b.name] = b.getWorldQuaternion(new Q()); }
    const srcMixer = new THREE.AnimationMixer(src.scene);
    const rest = hips.position.clone(), kk = 1 / model.scale.x;
    const convert = name => {
      const sc = THREE.AnimationClip.findByName(src.animations, name); if (!sc) throw new Error('no clip ' + name);
      srcMixer.clipAction(sc).play();
      const n = Math.max(2, Math.round(sc.duration * 30)), times = [], vals = {}, hp = [];
      for (const b of tgtBones) vals[b.name] = [];
      let p0 = null;
      for (let i = 0; i <= n; i++) {
        const t = i * sc.duration / n; times.push(t); srcMixer.setTime(t); src.scene.updateMatrixWorld(true);
        const worldAnim = {};
        for (const b of tgtBones) {
          const sb = srcBones[b.name];
          const D = sb.getWorldQuaternion(q1).multiply(q2.copy(restS[b.name]).invert());
          const wt = D.clone().multiply(restT[b.name]); worldAnim[b.name] = wt;
          const pw = b.parent && worldAnim[b.parent.name] ? worldAnim[b.parent.name] : (b.parent ? b.parent.getWorldQuaternion(new Q()) : new Q());
          vals[b.name].push(...pw.clone().invert().multiply(wt).toArray());
        }
        const hs = srcBones['mixamorigHips'].position; if (!p0) p0 = hs.clone();
        hp.push(rest.x + (hs.x - p0.x) * kk, rest.y, rest.z - (hs.y - p0.y) * kk);   // sway + bob only (Michelle hips: up = -Z)
      }
      srcMixer.stopAllAction(); srcMixer.uncacheClip(sc);
      const tracks = tgtBones.map(b => new THREE.QuaternionKeyframeTrack(`.bones[${b.name}].quaternion`, times, vals[b.name]));
      tracks.push(new THREE.VectorKeyframeTrack('.bones[mixamorigHips].position', times, hp));
      return new THREE.AnimationClip(name, sc.duration, tracks);
    };
    wc = convert(opts.walk); ic = convert(opts.idle);
    ch.mixer = new THREE.AnimationMixer(tgtMesh);
  } else {
    // Native clips: keep hips vertical bob only (strip any root-motion / lateral drift) so playback is in place.
    const pq = hips.parent.getWorldQuaternion(new THREE.Quaternion());
    const axes = [0, 1, 2].map(i => { const v = new THREE.Vector3(); v.setComponent(i, 1); return v.applyQuaternion(pq).y; });
    const up = axes.reduce((b, v, i) => Math.abs(v) > Math.abs(axes[b]) ? i : b, 0);
    console.log('[hips up axis]', opts.name, up, axes.map(v => v.toFixed(2)).join(','));
    const prep = name => {
      const c = THREE.AnimationClip.findByName(body.animations, name); if (!c) throw new Error('no clip ' + name);
      const cc = c.clone();
      for (const t of cc.tracks) if (/Hips\.position$/.test(t.name)) {
        const v = t.values;
        for (let i = 0; i < v.length; i += 3) for (let a = 0; a < 3; a++) if (a !== up) v[i + a] = v[a];
      }
      return cc;
    };
    wc = prep(opts.walk); ic = prep(opts.idle);
    ch.mixer = new THREE.AnimationMixer(model);
  }
  model.updateMatrixWorld(true);
  ch.walk = ch.mixer.clipAction(wc); ch.idle = ch.mixer.clipAction(ic);
  ch.walk.play(); ch.idle.play(); ch.walk.setEffectiveWeight(1); ch.idle.setEffectiveWeight(0);
  ch.mixer.setTime(0); model.updateMatrixWorld(true);
  ch.hipsRest = new THREE.Vector3(); hips.getWorldPosition(tmp); ch.actor.worldToLocal(tmp); ch.hipsRest.copy(tmp);

  // stride measurement: backward travel of each foot relative to hips per cycle = body travel per cycle
  const left = ch.footBones.find(b => /LeftFoot$/.test(b.name)), right = ch.footBones.find(b => /RightFoot$/.test(b.name));
  const N = 240, dur = wc.duration, res = {};
  for (const [k, foot] of [['L', left], ['R', right]]) {
    let back = 0, prev = null, hx = 0, hz = 0;
    for (let i = 0; i <= N; i++) {
      ch.mixer.setTime(i / N * dur); model.updateMatrixWorld(true);
      foot.getWorldPosition(tmp); ch.actor.worldToLocal(tmp); const fz = tmp.z;
      hips.getWorldPosition(tmp); ch.actor.worldToLocal(tmp); const rel = fz - tmp.z;
      hx = Math.max(hx, Math.abs(tmp.x - ch.hipsRest.x)); hz = Math.max(hz, Math.abs(tmp.z - ch.hipsRest.z));
      if (prev !== null && rel < prev) back += prev - rel;
      prev = rel;
    }
    res[k] = { stride: back, hipDriftX: hx, hipDriftZ: hz };
  }
  const stride = (res.L.stride + res.R.stride) / 2;
  ch.speed = stride / dur; ch.dur = dur; ch.mixer.setTime(0);
  console.log('[stride]', opts.name, JSON.stringify({ cycle: dur, stride, speed: ch.speed, res, modelScale: model.scale.x }));
  for (const b of ch.footBones) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05), new THREE.MeshBasicMaterial({ color: 0xff3333, depthTest: false }));
    m.renderOrder = 10; m.visible = dbg; m.userData.bone = b; scene.add(m); markers.push(m);
  }
  // start pose: on ring at s0, facing away from tangent so she turns in place first
  ch.heading = ringHeading(ch.s) + 1.5;
  return ch;
}

const CFG = [
  { name: 'Michelle', url: MODEL_URL, animUrl: ANIM_SOURCE_URL, walk: WALK_CLIP, idle: IDLE_CLIP, height: TARGET_ANKLE_TO_HEAD, s0: 0 },
  { name: 'Soldier', url: './models/mixamo-male-soldier.glb', animUrl: null, walk: 'Walk', idle: 'Idle', height: 1.70, s0: LEAD },
];
Promise.all(CFG.map(buildCharacter)).then(list => {
  characters.push(...list);
  pace = list[0].speed;                       // Michelle's matched speed is the shared ground speed
  for (const c of list) c.ts = pace / c.speed; // Soldier's walk clip is time-scaled so his feet match the same ground speed
  info.textContent = list.map(c => `${c.name}: cycle ${c.dur.toFixed(2)}s, stride-speed ${c.speed.toFixed(2)} m/s, clip x${c.ts.toFixed(2)}`).join(' | ') + ` | pace ${pace.toFixed(2)} m/s`;
  window.__strideReady = true;
}).catch(e => { info.textContent = 'load error: ' + e.message; console.error(e); });

function step(c, dt) {
  const want = ringHeading(c.s), err = shortest(c.heading, want);
  let moving = false;
  if (c.state === 'turn') {   // turn in place (idle) at the start until facing the path tangent
    const r = 2.2*dt; c.heading += Math.abs(err) < r ? err : Math.sign(err)*r;
    if (Math.abs(err) < 0.05) c.state = 'walk';
  } else { c.heading += err * Math.min(1, 8*dt); moving = true; }   // walking: heading follows the circle tangent
  c.blend += ((moving ? 1 : 0) - c.blend) * Math.min(1, 8*dt);
  c.s += pace * dt * c.blend;
  const [x, z] = ringPos(c.s, c.lane);
  c.actor.position.set(x, 0, z); c.actor.rotation.y = c.heading;
  c.walk.setEffectiveWeight(c.blend); c.idle.setEffectiveWeight(1 - c.blend);
  c.walk.setEffectiveTimeScale(c.ts); c.mixer.update(dt);
}

function plantFeet(c) {
  const { model, hips } = c;
  model.position.set(0, 0, 0); c.actor.updateMatrixWorld(true);
  hips.getWorldPosition(tmp); c.actor.worldToLocal(tmp); model.position.x = c.hipsRest.x - tmp.x; model.position.z = c.hipsRest.z - tmp.z; c.actor.updateMatrixWorld(true);
  let low = Infinity;
  for (const b of c.footBones) { b.getWorldPosition(tmp); low = Math.min(low, tmp.y - (/ToeBase$/.test(b.name) ? 0 : 0.07)); }
  model.position.y = FLOOR_Y - low;   // lowest foot sole rests on the stone surface (ankle ~7 cm above sole; toe base ~0)
  c.actor.updateMatrixWorld(true);
}
function updateMarkers() {
  for (const m of markers) {
    m.userData.bone.getWorldPosition(tmp); m.position.copy(tmp);
    const sole = tmp.y - (/ToeBase$/.test(m.userData.bone.name) ? 0 : 0.07);
    m.material.color.set(sole - FLOOR_Y < 0.03 ? 0x33ff66 : 0xff3333);
  }
}

addEventListener('resize', () => { camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const offset = new THREE.Vector3(); const clock = new THREE.Clock();
const overview = new URLSearchParams(location.search).has('overview');
if (overview) { const c = (new URLSearchParams(location.search).get('cam') || '0,15,24,0,0,4').split(',').map(Number); camera.position.set(c[0], c[1], c[2]); controls.target.set(c[3], c[4], c[5]); controls.maxDistance = 120; }
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  for (const c of characters) { step(c, dt); plantFeet(c); }
  updateMarkers();
  const lead = characters[0];
  if (lead && !overview) { // follow Michelle, keep user's orbit offset
    const t = new THREE.Vector3(lead.actor.position.x, 1.1, lead.actor.position.z);
    offset.copy(camera.position).sub(controls.target);
    controls.target.lerp(t, 1 - Math.exp(-6*dt));
    camera.position.copy(controls.target).add(offset);
  }
  controls.update();
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
});
document.getElementById('dbg').textContent = 'Foot debug: ' + (dbg?'on':'off');
window.__stride = { get chars(){return characters;}, get pace(){return pace;}, stones: stoneStats };
