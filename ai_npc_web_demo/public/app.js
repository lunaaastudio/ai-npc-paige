import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

// ===== i18n：中英双语切换（默认跟随浏览器语言，localStorage 记忆选择） =====
const I18N = {
  zh: {
    title: 'Paige · 便利贴猫',
    brand: 'Paige的便利贴',
    loading: '召唤角色中…',
    legendDonow: '🔥 先做', legendPlan: '🌱 计划', legendQuick: '⚡ 速办', legendSomeday: '☁️ 改天',
    clear: '清空', clearTitle: '清空全部便签',
    micTitle: '语音输入',
    placeholder: '对 Paige 说说最近的事…',
    footerHint: 'ENTER 发送 · SHIFT+ENTER 换行',
    modeLocal: '本地模式 · 无需 API KEY',
    greeting: '喵，我是 Paige。把乱糟糟的事说给我听，我帮你贴到这面墙上。',
    typing: '正在整理成便利贴…',
    notesDone: '（便签贴好了）',
    connLost: '连接似乎断了：',
    lowConf: 'Paige 不太确定这个分类',
    tear: '撕掉',
    cleared: '墙上的便签都撕掉了。重新开始吧。',
    noSpeech: '当前浏览器不支持语音识别',
    loadingDetail: '载入 3D 模型',
    modelPct: p => `3D 模型 ${p}%`,
    modelMB: mb => `已载入 ${mb} MB`,
    modelFail: '模型载入失败，请刷新重试',
    animClip: n => `动画：${n}`
  },
  en: {
    title: "Paige's Memo · Sticky-note Cat",
    brand: "Paige's Memo",
    loading: 'Summoning Paige…',
    legendDonow: '🔥 Do now', legendPlan: '🌱 Plan', legendQuick: '⚡ Quick', legendSomeday: '☁️ Someday',
    clear: 'Clear', clearTitle: 'Remove all sticky notes',
    micTitle: 'Voice input',
    placeholder: "Tell Paige what's on your mind…",
    footerHint: 'ENTER to send · SHIFT+ENTER for new line',
    modeLocal: 'Local mode · No API key needed',
    greeting: "Meow, I'm Paige. Tell me the messy things on your mind and I'll pin them to this wall.",
    typing: 'Sorting into sticky notes…',
    notesDone: '(Notes pinned up)',
    connLost: 'Connection seems lost: ',
    lowConf: 'Paige is not sure about this quadrant',
    tear: 'Tear off',
    cleared: 'All notes torn off the wall. Fresh start!',
    noSpeech: 'Speech recognition is not supported in this browser',
    loadingDetail: 'Loading 3D model',
    modelPct: p => `3D model ${p}%`,
    modelMB: mb => `Loaded ${mb} MB`,
    modelFail: 'Failed to load model, please refresh',
    animClip: n => `Animation: ${n}`
  }
};
let LANG = localStorage.getItem('paige_lang') || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
function t(k) {
  const v = I18N[LANG][k] ?? I18N.zh[k];
  return typeof v === 'function' ? v : (v ?? k);
}
function tf(k, ...args) { const v = t(k); return typeof v === 'function' ? v(...args) : v; }

const wrap = document.getElementById('modelWrap');
const loaderEl = document.getElementById('loader');
const loadDetail = document.getElementById('loadDetail');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
camera.position.set(0, .73, 2.55);
const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
wrap.appendChild(renderer.domElement);

// ===== 赛璐璐渲染：阶梯光照 + 水彩描边 =====
const toonGradient = new THREE.DataTexture(new Uint8Array([100, 158, 216, 255]), 4, 1, THREE.RedFormat);
toonGradient.minFilter = toonGradient.magFilter = THREE.NearestFilter;
toonGradient.needsUpdate = true;
const outline = new OutlineEffect(renderer, {
  defaultThickness: 0.002,
  defaultColor: [0.03, 0.015, 0.08],  // 深紫黑描边（近纯黑）
  defaultAlpha: 0.75,
  defaultKeepAlive: true
});

scene.add(new THREE.HemisphereLight(0xfff1dd, 0x8a7a9a, 1.6));
const key = new THREE.DirectionalLight(0xffd9a8, 2.6); key.position.set(-2,3,3); scene.add(key);
const rim = new THREE.DirectionalLight(0x9fb4ff, 1.3); rim.position.set(3,1,-2); scene.add(rim);
// 高光：窄束聚光灯从左上前方打在猫身上，赛璐璐渲染下呈现硬朗的动漫式亮斑
const spot = new THREE.SpotLight(0xfff6e6, 18, 12, 0.4, 0.2, 1.4);
spot.position.set(-1.6, 2.6, 2.4);
spot.target.position.set(0, 0.55, 0.2);
scene.add(spot); scene.add(spot.target);

// canvas 已设 pointer-events:none（让便签可点），旋转/缩放的拖拽监听挂到 .world 容器上
const controls = new OrbitControls(camera, wrap.parentElement);
controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = .055;
controls.enableRotate = false; // 镜头锁定：不允许转动
controls.enableZoom = false;   // 大小锁定：不允许缩放
controls.minDistance = 1.5; controls.maxDistance = 3.4; controls.target.set(0,.70,0);
controls.autoRotate = false;
let character = null;
let mixer = null;

function fit(){const w=wrap.clientWidth,h=wrap.clientHeight; camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h,false)}
new ResizeObserver(fit).observe(wrap); fit();

new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load('/character.glb', gltf => {
  character = gltf.scene;
  const box = new THREE.Box3().setFromObject(character); const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
  // 水平居中，整体微微下移，让猫稳稳踩在地面上
  character.position.sub(center);
  character.position.y += size.y * 0.45;

  // ===== 赛璐璐材质：MeshToon 阶梯光照 =====
  const meshes = [];
  character.traverse(child=>{ if(child.isMesh) meshes.push(child); });
  for (const child of meshes) {
    child.frustumCulled = false; // skinned meshes can vanish when bones move outside the static bounds
    const src = child.material;
    child.material = new THREE.MeshToonMaterial({
      map: src?.map || null,
      color: (src?.color ? src.color.clone() : new THREE.Color(0xffffff)).lerp(new THREE.Color(0xfff2e6), .12),
      gradientMap: toonGradient,
      transparent: !!src?.transparent, alphaTest: src?.alphaTest || 0
    });
    // 每个网格线宽随机 0.003~0.0055，模拟手绘勾线粗细不均
    const jitter = ((child.id * 2654435761) % 100) / 100;
    child.userData.outlineParameters = { thickness: 0.001 + jitter * 0.003, color: [0.03, 0.015, 0.08], alpha: 0.75, visible: true };
  }
  scene.add(character);
  loadDesk();
  if (gltf.animations.length) {
    mixer = new THREE.AnimationMixer(character);
    const action = mixer.clipAction(gltf.animations[0]);
    action.setLoop(THREE.LoopRepeat).play();
    loadDetail.textContent = tf('animClip', gltf.animations[0].name || 'clip 1');
    // 该动画预设整体转向侧面 90°，用固定旋转把正脸转向镜头
    character.rotation.y = -Math.PI / 2;
  }
  loaderEl.classList.add('done');
  showBubble(t('greeting'),'greet',false,9000);
}, xhr => {
  if(xhr.total){ const pct=Math.min(99,Math.round(xhr.loaded/xhr.total*100)); loadDetail.textContent=tf('modelPct', pct); }
  else loadDetail.textContent=tf('modelMB', (xhr.loaded/1024/1024).toFixed(0));
}, err => { console.error(err); loadDetail.textContent=t('modelFail'); });

// ===== 悬浮书桌：放在猫的前方（顶点色 GLB，gltfpack 压缩，绘本风哑光材质） =====
let desk = null;
function loadDesk(){
  const catHeight = new THREE.Box3().setFromObject(character).getSize(new THREE.Vector3()).y;
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load('/desk.glb', gltf => {
    desk = gltf.scene;
    const mat = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: toonGradient
    });
    desk.traverse(child => { if (child.isMesh) { if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals(); child.material = mat;
      const jitter = ((child.id * 2654435761) % 100) / 100;
      child.userData.outlineParameters = { thickness: 0.0008 + jitter * 0.0022, color: [0.03, 0.015, 0.08], alpha: 0.72, visible: true }; } });
    // 桌子放大前倾，覆盖整个画面底部，猫在桌后露出上半身
    const box = new THREE.Box3().setFromObject(desk);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = (catHeight * 0.55) / Math.max(size.y, 0.0001);
    desk.scale.setScalar(s);
    desk.position.sub(center.multiplyScalar(s));
    desk.position.x = 0;
    desk.position.y = (size.y * s) / 2 + catHeight * 0.02; // 底部贴地、微微悬浮
    desk.position.z = catHeight * 0.72;                    // 更靠近镜头，铺满底部
    desk.rotation.x = -0.14;                               // 桌面向镜头前倾
    scene.add(desk);
    addTablecloth(box, size, s, catHeight);
  }, undefined, err => console.warn('desk load failed', err));
}

// ===== 彩色桌布：一块马卡龙条纹布，挡住桌底的空隙 =====
let cloth = null;
function addTablecloth(box, size, s, catHeight){
  const cw = 640, ch = 320;
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const cx = cv.getContext('2d');
  // 黑色桌布：深黑织纹 + 暗灰织带 + 底部黑流苏
  const grad = cx.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(0, '#2b2b31');
  grad.addColorStop(1, '#131316');
  cx.fillStyle = grad; cx.fillRect(0, 0, cw, ch);
  // 细密织纹
  cx.strokeStyle = 'rgba(200,200,215,.05)'; cx.lineWidth = 1;
  for (let y = 0; y < ch; y += 4) { cx.beginPath(); cx.moveTo(0, y); cx.lineTo(cw, y); cx.stroke(); }
  cx.strokeStyle = 'rgba(200,200,215,.03)';
  for (let x = 0; x < cw; x += 4) { cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, ch); cx.stroke(); }
  // 织带条纹（暗灰主带 + 浅灰线 + 深灰细带）
  cx.fillStyle = '#4a4a55'; cx.fillRect(0, ch * 0.60 - 3, cw, 2);
  cx.fillStyle = '#33333c'; cx.fillRect(0, ch * 0.60, cw, 18);
  cx.fillStyle = '#4a4a55'; cx.fillRect(0, ch * 0.60 + 24, cw, 2);
  cx.fillStyle = '#232328'; cx.fillRect(0, ch * 0.60 + 30, cw, 9);
  // 顶部深色锁边
  cx.fillStyle = 'rgba(0,0,0,.55)'; cx.fillRect(0, 0, cw, 6);
  // 底部流苏
  cx.strokeStyle = '#1c1c21'; cx.lineWidth = 3; cx.lineCap = 'round';
  for (let x = 4; x < cw; x += 8) { const len = 8 + (x * 7 % 6); cx.beginPath(); cx.moveTo(x, ch - 4); cx.lineTo(x, ch - 4 + len); cx.stroke(); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;

  desk.updateMatrixWorld(true);
  // 桌布最高处 = 桌子前唇下沿（朝向镜头那条底边，经前倾旋转后的实际高度）
  const lipL = new THREE.Vector3(box.min.x, box.min.y, box.max.z).applyMatrix4(desk.matrixWorld);
  const lipR = new THREE.Vector3(box.max.x, box.min.y, box.max.z).applyMatrix4(desk.matrixWorld);
  const topY = Math.min(lipL.y, lipR.y) + catHeight * 0.02;        // 微重叠贴桌底（往下一点）
  const clothZ = desk.position.z + box.max.z * s * 0.80;
  // 画面最底在该深度处的世界 y（相机固定，直接用视锥下缘射线求交）
  const ray = new THREE.Vector3(0, -1, 0.5).unproject(camera).sub(camera.position).normalize();
  const bottomY = camera.position.y + ray.y * ((clothZ - camera.position.z) / ray.z) - catHeight * 0.06;
  const height = Math.max(topY - bottomY, catHeight * 0.05);
  cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * s * 1.5, height),
    new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient, side: THREE.DoubleSide })
  );
  cloth.position.set(0, topY - height / 2, clothZ);
  cloth.rotation.x = -0.06;                                        // 随桌面轻微前倾
  cloth.userData.outlineParameters = { thickness: 0.0009, color: [0.03, 0.015, 0.08], alpha: 0.7, visible: true };
  scene.add(cloth);
}

const clock=new THREE.Clock();
function animate(){requestAnimationFrame(animate); const dt=clock.getDelta(); if(mixer)mixer.update(dt);
  // 桌子与桌布保持静止，无浮沉动画
  controls.update(); outline.render(scene,camera)} animate();

const messagesEl=document.getElementById('messages'); const form=document.getElementById('composer'); const input=document.getElementById('input'); const send=document.getElementById('send'); const mode=document.getElementById('modeText');
const history=[];
function esc(s){return s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function addMessage(role,text,typing=false,emotion=null){const el=document.createElement('article'); el.className=`msg ${role==='assistant'?'npc':'user'}${typing?' typing':''}`; const av=role==='assistant'?`<img class="avatar-img" src="/stickers/t-${emotion&&/^[a-z]+$/.test(emotion)?emotion:'default'}.png" alt="">`:'Y'; el.innerHTML=`<div class="avatar">${av}</div><div><span class="speaker">${role==='assistant'?'PAIGE':'YOU'}</span><p>${esc(text).replace(/\n/g,'<br>')}</p></div>`; messagesEl.appendChild(el); messagesEl.scrollTop=messagesEl.scrollHeight; return el}
async function ask(text){text=text.trim();if(!text)return; addMessage('user',text); history.push({role:'user',content:text}); input.value=''; resizeInput(); send.disabled=true; const typing=addMessage('assistant',t('typing'),true); showBubble(t('typing'),'thinking',true);
  try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history})}); const data=await r.json(); if(!r.ok)throw new Error(data.error||'Request failed'); typing.remove(); if(data.reply){addMessage('assistant',data.reply,false,data.emotion); history.push({role:'assistant',content:data.reply})} if(Array.isArray(data.notes)&&data.notes.length)addNotes(data.notes); mode.dataset.demo=data.demo?'1':'0'; mode.textContent=data.demo?t('modeLocal'):`LIVE AI · ${data.model||''}`; showBubble(data.reply||t('notesDone'),data.emotion,false,12000)}catch(e){typing.remove();addMessage('assistant',t('connLost')+e.message); showBubble(t('connLost')+e.message,'sad',false,6000)}finally{send.disabled=false; input.focus()}}

// --- In-scene speech bubble ---
const sceneBubble=document.getElementById('sceneBubble'), sbAvatar=document.getElementById('sbAvatar'), sbText=document.getElementById('sbText');
let sbTimer=null;
function showBubble(text,emotion='default',typing=false,hideAfter=0){
  sbAvatar.src=`/stickers/t-${/^[a-z]+$/.test(emotion)?emotion:'default'}.png`;
  sbText.textContent=text; sbText.classList.toggle('typing',typing);
  sceneBubble.classList.remove('hidden'); sceneBubble.classList.remove('bob'); void sceneBubble.offsetWidth; sceneBubble.classList.add('bob');
  clearTimeout(sbTimer);
  if(hideAfter>0) sbTimer=setTimeout(()=>sceneBubble.classList.add('hidden'),hideAfter);
}
form.addEventListener('submit',e=>{e.preventDefault();ask(input.value)}); input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit()}});
function resizeInput(){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,120)+'px'} input.addEventListener('input',resizeInput);
document.querySelectorAll('#suggestions button').forEach(b=>b.onclick=()=>ask(b.textContent));

// Optional voice input in Chromium browsers.
const mic=document.getElementById('mic'); const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
if(SpeechRecognition){const rec=new SpeechRecognition();window.__rec=rec;rec.lang=LANG==='zh'?'zh-CN':'en-US';rec.interimResults=false;rec.onstart=()=>mic.classList.add('listening');rec.onend=()=>mic.classList.remove('listening');rec.onresult=e=>{input.value=e.results[0][0].transcript;resizeInput();input.focus()};mic.onclick=()=>rec.start()}else{mic.style.opacity=.35;mic.title=t('noSpeech')}
// --- Sticky notes pinned directly on the world background, persisted in localStorage ---
const NOTE_KEY = 'taotao_notes_v1';
const notesLayer = document.getElementById('notesLayer');
// Placement zones (percent of world size) — 只贴在上半部分的紫色背景区域，
// 避开中间的猫和底部被桌子/桌布覆盖的区域：
// 左墙、右墙（猫帽以上的高度），以及猫头顶上方的一条横带。
const ZONES = [
  { x: [3, 24], y: [5, 36] },
  { x: [73, 94], y: [5, 36] },
  { x: [30, 66], y: [3, 15] }
];
let zoneIdx = 0;
function nextPos(){
  const z = ZONES[zoneIdx % ZONES.length]; zoneIdx++;
  return {
    x: +(z.x[0] + Math.random() * (z.x[1] - z.x[0])).toFixed(1),
    y: +(z.y[0] + Math.random() * (z.y[1] - z.y[0])).toFixed(1)
  };
}
function onPurple(n){
  if (n.custom) return true;                            // 用户手动拖过的位置保留
  if (typeof n.x !== 'number' || typeof n.y !== 'number') return false;
  if (n.y <= 36 && (n.x <= 26 || n.x >= 71)) return true;   // 左右墙高处
  if (n.y <= 18 && n.x >= 28 && n.x <= 68) return true;      // 猫头顶横带
  return false;
}

let notes = [];
try { notes = JSON.parse(localStorage.getItem(NOTE_KEY) || '[]'); } catch { notes = []; }
// Migrate older notes saved without a wall position, or pinned outside the purple area.
let migrated = false;
for (const n of notes) {
  if (!onPurple(n)) { const p = nextPos(); n.x = p.x; n.y = p.y; n.rot = +(Math.random() * 6 - 3).toFixed(1); migrated = true; }
}
if (migrated) localStorage.setItem(NOTE_KEY, JSON.stringify(notes));

function saveNotes(){ localStorage.setItem(NOTE_KEY, JSON.stringify(notes)); }

function makeSticky(note){
  const el = document.createElement('div');
  el.className = `sticky q-${note.quadrant}` + (note.done ? ' done' : '');
  el.style.left = note.x + '%'; el.style.top = note.y + '%';
  el.style.setProperty('--rot', (note.rot ?? 0) + 'deg');
  el.dataset.id = note.id;
  const h = [...note.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const attach = h % 4 === 0
    ? `<span class="pin p${h % 3}"></span>`
    : `<span class="tape t${h % 4}"></span>`;
  // 象限表情包贴纸：先做=冲、计划=思考、速办=眨眼、改天=犯困
  const QUAD_EMOJI = { 'do-now': 't-excited', 'plan': 't-thinking', 'quick': 't-wink', 'someday': 't-tired' };
  const emo = QUAD_EMOJI[note.quadrant] || 't-default';
  let inner = `${attach}<img class="sticky-emoji" src="/stickers/${emo}.png" alt=""><p class="sticky-title">${esc(note.title)}</p>`;
  if (note.annotation) inner += `<p class="sticky-note">${esc(note.annotation)}</p>`;
  if (note.confidence === 'low') inner += `<span class="low-conf" title="${esc(t('lowConf'))}">?</span>`;
  inner += `<button class="sticky-del" title="${esc(t('tear'))}">✕</button>`;
  el.innerHTML = inner;
  el.querySelector('.sticky-title').onclick = () => {
    if (el.dataset.dragged === '1') { el.dataset.dragged = ''; return; } // 拖动后的抬起不算点击
    note.done = !note.done;
    el.classList.toggle('done', note.done);
    saveNotes();
  };
  el.querySelector('.sticky-del').onclick = (e) => {
    e.stopPropagation();
    notes = notes.filter(n => n.id !== note.id);
    el.remove(); saveNotes();
  };
  // ===== 拖动：按住便签任意位置拖动，松手后保存位置并收敛到画面内 =====
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();                    // 防止触发场景旋转（✕ 也要拦，否则 click 被 OrbitControls 捕获）
    if (e.target.closest('.sticky-del')) return;
    const layer = notesLayer.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const origL = parseFloat(el.style.left), origT = parseFloat(el.style.top);
    let moved = false;
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 5) return;  // 5px 内视为点击
      moved = true;
      el.classList.add('dragging');
      el.style.left = (origL + dx / (layer.width  / 100)) + '%';
      el.style.top  = (origT + dy / (layer.height / 100)) + '%';
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.classList.remove('dragging');
      if (!moved) return;
      el.dataset.dragged = '1';
      fitNote(el);                          // 拖出画面就拉回边缘
      note.x = parseFloat(el.style.left);
      note.y = parseFloat(el.style.top);
      note.custom = true;                   // 用户手动摆过，重载时不再强制归区
      saveNotes();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
  return el;
}

function renderAll(){
  notesLayer.innerHTML = '';
  for (const note of notes) notesLayer.appendChild(makeSticky(note));
  // 收敛：任何超出画面（含旋转后的视觉边界）的便签都拉回场景内
  for (const el of notesLayer.children) fitNote(el);
}

function fitNote(el){
  const layer = notesLayer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const M = 8;                                  // 离画面边缘的安全边距(px)
  let dx = 0, dy = 0;
  if (r.right  > layer.right  - M) dx = r.right  - (layer.right  - M);
  if (r.left   < layer.left   + M) dx = r.left   - (layer.left   + M);
  if (r.bottom > layer.bottom - M) dy = r.bottom - (layer.bottom - M);
  if (r.top    < layer.top    + M) dy = r.top    - (layer.top    + M);
  if (!dx && !dy) return;
  el.style.left = (parseFloat(el.style.left) - dx / (layer.width  / 100)).toFixed(1) + '%';
  el.style.top  = (parseFloat(el.style.top)  - dy / (layer.height / 100)).toFixed(1) + '%';
}

window.addEventListener('resize', renderAll);   // 窗口尺寸变化时重新收敛

// UI 元素上的按下不传给场景旋转（OrbitControls 挂在 .world 上，setPointerCapture 会吃掉 click）
for (const sel of ['.board-legend', '.composer', '.footer-line', '.scene-bubble', '.brand', '.lang-toggle']) {
  const uiEl = document.querySelector(sel);
  if (uiEl) uiEl.addEventListener('pointerdown', e => e.stopPropagation());
}

function addNotes(incoming){
  for (const n of incoming.slice(0, 1)) {   // 每次交互只贴一张便利贴
    const pos = nextPos();
    notes.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: String(n.title || '').slice(0, 120),
      quadrant: ['do-now','plan','quick','someday'].includes(n.quadrant) ? n.quadrant : 'someday',
      confidence: n.confidence === 'low' ? 'low' : 'high',
      annotation: typeof n.annotation === 'string' ? n.annotation.slice(0, 80) : '',
      x: pos.x, y: pos.y,
      rot: +(Math.random() * 6 - 3).toFixed(1),
      done: false
    });
  }
  saveNotes(); renderAll();
}

document.getElementById('clearBoard').onclick = () => {
  if (!notes.length) return;
  notes = []; saveNotes(); renderAll();
  showBubble(t('cleared'), 'happy', false, 5000);
};

// ===== 应用语言：刷新所有静态文案 + 重渲染便签（tooltip 随语言更新） =====
const langToggle = document.getElementById('langToggle');
function applyLang(){
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  langToggle.textContent = LANG === 'zh' ? 'EN' : '中';
  if (!loaderEl.classList.contains('done')) loadDetail.textContent = t('loadingDetail');
  if (window.__rec) window.__rec.lang = LANG === 'zh' ? 'zh-CN' : 'en-US';
  if (mode.dataset.demo !== '0') mode.textContent = t('modeLocal');
  renderAll();
}
langToggle.onclick = () => {
  LANG = LANG === 'zh' ? 'en' : 'zh';
  localStorage.setItem('paige_lang', LANG);
  applyLang();
};
applyLang();
