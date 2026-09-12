import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const wrap = document.getElementById('modelWrap');
const loaderEl = document.getElementById('loader');
const loadDetail = document.getElementById('loadDetail');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
camera.position.set(0, .53, 2.55);
const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
wrap.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xfff1dd, 0x8a7a9a, 1.6));
const key = new THREE.DirectionalLight(0xffd9a8, 2.6); key.position.set(-2,3,3); scene.add(key);
const rim = new THREE.DirectionalLight(0x9fb4ff, 1.2); rim.position.set(3,1,-2); scene.add(rim);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = .055;
controls.enableRotate = false; // 镜头锁定：不允许转动
controls.enableZoom = false;   // 大小锁定：不允许缩放
controls.minDistance = 1.5; controls.maxDistance = 3.4; controls.target.set(0,.5,0);
controls.autoRotate = false;
let character = null;
let mixer = null;

function fit(){const w=wrap.clientWidth,h=wrap.clientHeight; camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h,false)}
new ResizeObserver(fit).observe(wrap); fit();

new GLTFLoader().load('/character.glb', gltf => {
  character = gltf.scene;
  const box = new THREE.Box3().setFromObject(character); const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
  // 水平居中，脚底精确落在地面线 y=0 上，保持直立
  character.position.sub(center);
  character.position.y += size.y / 2;

  // ===== 柔和绘本风渲染：平滑光照 + 微妙高光 =====
  const meshes = [];
  character.traverse(child=>{ if(child.isMesh) meshes.push(child); });
  for (const child of meshes) {
    child.frustumCulled = false; // skinned meshes can vanish when bones move outside the static bounds
    const src = child.material;
    const phong = new THREE.MeshPhongMaterial({
      map: src?.map || null,
      color: (src?.color ? src.color.clone() : new THREE.Color(0xffffff)).lerp(new THREE.Color(0xfff2e6), .12), // 微暖粉彩
      shininess: 16,                        // 低光泽度 = 柔和哑光 + 一点点高光
      specular: new THREE.Color(0x2a1f18),  // 暖调弱高光
      transparent: !!src?.transparent, alphaTest: src?.alphaTest || 0
    });
    child.material = phong;
  }
  scene.add(character);
  if (gltf.animations.length) {
    mixer = new THREE.AnimationMixer(character);
    const action = mixer.clipAction(gltf.animations[0]);
    action.setLoop(THREE.LoopRepeat).play();
    loadDetail.textContent = `动画：${gltf.animations[0].name || 'clip 1'}`;
    // 该动画预设整体转向侧面 90°，用固定旋转把正脸转向镜头
    character.rotation.y = -Math.PI / 2;
  }
  loaderEl.classList.add('done');
  showBubble('你终于来了。今天，你想找一个地方，还是想找一个答案？','greet',false,9000);
}, xhr => {
  if(xhr.total){ const pct=Math.min(99,Math.round(xhr.loaded/xhr.total*100)); loadDetail.textContent=`3D 模型 ${pct}%`; }
  else loadDetail.textContent=`已载入 ${(xhr.loaded/1024/1024).toFixed(0)} MB`;
}, err => { console.error(err); loadDetail.textContent='模型载入失败，请刷新重试'; });

const clock=new THREE.Clock();
function animate(){requestAnimationFrame(animate); const dt=clock.getDelta(); if(mixer)mixer.update(dt); controls.update(); renderer.render(scene,camera)} animate();

const messagesEl=document.getElementById('messages'); const form=document.getElementById('composer'); const input=document.getElementById('input'); const send=document.getElementById('send'); const mode=document.getElementById('modeText');
const history=[];
function esc(s){return s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function addMessage(role,text,typing=false,emotion=null){const el=document.createElement('article'); el.className=`msg ${role==='assistant'?'npc':'user'}${typing?' typing':''}`; const av=role==='assistant'?`<img class="avatar-img" src="/stickers/t-${emotion&&/^[a-z]+$/.test(emotion)?emotion:'default'}.png" alt="">`:'Y'; el.innerHTML=`<div class="avatar">${av}</div><div><span class="speaker">${role==='assistant'?'PAIGE':'YOU'}</span><p>${esc(text).replace(/\n/g,'<br>')}</p></div>`; messagesEl.appendChild(el); messagesEl.scrollTop=messagesEl.scrollHeight; return el}
async function ask(text){text=text.trim();if(!text)return; addMessage('user',text); history.push({role:'user',content:text}); input.value=''; resizeInput(); send.disabled=true; const typing=addMessage('assistant','正在翻阅地图',true); showBubble('正在翻阅地图…','thinking',true);
  try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history})}); const data=await r.json(); if(!r.ok)throw new Error(data.error||'Request failed'); typing.remove(); addMessage('assistant',data.reply,false,data.emotion); history.push({role:'assistant',content:data.reply}); mode.textContent=data.demo?'DEMO MODE · ADD API KEY FOR LIVE AI':`LIVE AI · ${data.model||''}`; showBubble(data.reply,data.emotion,false,12000); speak(data.reply)}catch(e){typing.remove();addMessage('assistant',`连接似乎断了：${e.message}`); showBubble(`连接似乎断了：${e.message}`,'sad',false,6000)}finally{send.disabled=false; input.focus()}}

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
if(SpeechRecognition){const rec=new SpeechRecognition();rec.lang='zh-CN';rec.interimResults=false;rec.onstart=()=>mic.classList.add('listening');rec.onend=()=>mic.classList.remove('listening');rec.onresult=e=>{input.value=e.results[0][0].transcript;resizeInput();input.focus()};mic.onclick=()=>rec.start()}else{mic.style.opacity=.35;mic.title='当前浏览器不支持语音识别'}
// --- Speech output: server TTS (OpenAI) with browser speechSynthesis fallback ---
let ttsEnabled = localStorage.getItem('paige_tts') !== 'off';
const ttsBtn = document.getElementById('ttsToggle');
function renderTtsBtn(){ ttsBtn.textContent = ttsEnabled ? '🔊' : '🔇'; ttsBtn.classList.toggle('muted', !ttsEnabled); }
ttsBtn.onclick = () => {
  ttsEnabled = !ttsEnabled;
  localStorage.setItem('paige_tts', ttsEnabled ? 'on' : 'off');
  if (!ttsEnabled) { if (currentAudio) currentAudio.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  renderTtsBtn();
};
renderTtsBtn();

let currentAudio = null;
function speakBrowser(text){
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = /[\u3400-\u9fff]/.test(text) ? 'zh-CN' : 'en-US';
  u.rate = .96; u.pitch = .92;
  speechSynthesis.speak(u);
}
async function speak(raw){
  const text = raw.replace(/[*#_`]/g, '');
  if (!ttsEnabled || !text.trim()) return;
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  try {
    const r = await fetch('/api/tts', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text }) });
    if (!r.ok) throw new Error('tts unavailable');
    const blob = await r.blob();
    currentAudio = new Audio(URL.createObjectURL(blob));
    currentAudio.onended = () => URL.revokeObjectURL(currentAudio.src);
    await currentAudio.play();
  } catch { speakBrowser(text); }
}
