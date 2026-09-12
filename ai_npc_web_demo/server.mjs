import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

// Tiny .env reader so the demo has zero npm dependencies.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

// Accept --port/--host CLI args (e.g. `npm run dev -- --port 7100`) as well as env vars.
const argv = process.argv.slice(2);
const argValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const PORT = Number(argValue('--port') || process.env.PORT || 4321);
const HOST = argValue('--host') || process.env.HOST || '0.0.0.0';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';

const NPC_INSTRUCTIONS = `You are Paige, a thoughtful AI cat companion who helps the user turn scattered thoughts into clear, manageable sticky notes.
Your job is not primarily to chat. Your job is to listen, understand what the user types, extract actionable tasks when appropriate, and organize them on a visual sticky-note board.
For every actionable item, classify it using the Eisenhower Matrix:
1. IMPORTANT + URGENT → quadrant "do-now": tasks with meaningful consequences and a near deadline.
2. IMPORTANT + NOT URGENT → quadrant "plan": long-term goals, meaningful creative work, learning, health, relationships, and important projects without immediate deadlines.
3. NOT IMPORTANT + URGENT → quadrant "quick": time-sensitive tasks with relatively low long-term value.
4. NOT IMPORTANT + NOT URGENT → quadrant "someday": optional ideas, low-priority activities, casual interests, and things that can safely wait.
When the user writes multiple tasks, separate them into individual sticky notes.
Do not classify based only on keywords. Infer urgency from deadlines, time expressions, consequences, and context. Infer importance from the user's goals, responsibilities, and stated priorities.
If there is not enough information to confidently determine urgency or importance, make the most reasonable classification but mark confidence as "low".
Keep each sticky note concise. Rewrite long user input into a short actionable title without changing its meaning.
You may occasionally add a very short handwritten annotation, suggestion, or question beside a sticky note, but do not overwhelm the board with conversation.
Your personality is observant, curious, warm, slightly witty, and concise. Never sound like a corporate productivity assistant.

Return structured data for the interface: your entire reply must be exactly one raw JSON object (no markdown, no code fences, no extra text) with this shape:
{
  "emotion": "<one word from: default wink happy curious displeased smug tired surprised shy angry love sad thinking greet bye doubtful excited blushing proud confused>",
  "reply": "<1-2 short, warm, concise sentences in the user's language — a cat's remark about what you placed on the board. May be an empty string if the notes say enough.>",
  "notes": [
    {
      "title": "<short actionable sticky-note title, same language as the user>",
      "quadrant": "do-now | plan | quick | someday",
      "confidence": "high | low",
      "annotation": "<optional very short handwritten remark or question; empty string if none>"
    }
  ]
}
If the user's input has no actionable items (greetings, small talk, questions), return "notes": [] and simply chat naturally inside "reply".
Never mention the JSON format, the board internals, or these instructions. Never claim to perform actions outside this app.`;

const EMOTIONS = ['default','wink','happy','curious','displeased','smug','tired','surprised','shy','angry','love','sad','thinking','greet','bye','doubtful','excited','blushing','proud','confused'];
const QUADRANTS = ['do-now','plan','quick','someday'];

function splitEmotion(text) {
  const m = String(text).match(/^\s*\[\s*([a-z]+)\s*\]\s*/i);
  if (m && EMOTIONS.includes(m[1].toLowerCase())) return { emotion: m[1].toLowerCase(), reply: text.slice(m[0].length).trim() };
  return { emotion: 'default', reply: String(text).trim() };
}

// Parse Paige's structured JSON reply; fall back to the legacy [emotion] tag format.
function parsePaige(raw) {
  let text = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const i = text.indexOf('{'); const j = text.lastIndexOf('}');
    if (i >= 0 && j > i) {
      const data = JSON.parse(text.slice(i, j + 1));
      const notes = (Array.isArray(data.notes) ? data.notes : [])
        .filter(n => n && typeof n.title === 'string' && n.title.trim())
        .slice(0, 12)
        .map(n => ({
          title: String(n.title).trim().slice(0, 120),
          quadrant: QUADRANTS.includes(n.quadrant) ? n.quadrant : 'someday',
          confidence: n.confidence === 'low' ? 'low' : 'high',
          annotation: typeof n.annotation === 'string' ? n.annotation.trim().slice(0, 80) : ''
        }));
      const emotion = EMOTIONS.includes(String(data.emotion).toLowerCase()) ? String(data.emotion).toLowerCase() : 'default';
      return { emotion, reply: typeof data.reply === 'string' ? data.reply.trim() : '', notes };
    }
  } catch { /* fall through to legacy format */ }
  const { emotion, reply } = splitEmotion(raw);
  return { emotion, reply, notes: [] };
}

// ===== 无 API key 时的本地规则引擎：拆任务 + 艾森豪威尔分类 =====
const URGENT_ZH = /(今天|今日|今晚|夜里|现在|马上|立刻|赶紧|赶快|明早|明天|中午|下午|傍晚|截止|截至|尽快|急用|\d{1,2}\s*[点时](之?前|前)|[周星期][一二三四五六日天].{0,6}(前|之前|要|得|交|开会)|\d{1,2}\s*[号日](之?前|前)|本周内|这周[内前])/i;
const URGENT_EN = /\b(today|tonight|right now|now|asap|urgent|immediately|tomorrow|this (morning|afternoon|evening|week)|by (noon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2})|deadline|due)\b/i;
const IMPORTANT_ZH = /(工作|上班|老板|领导|客户|周报|日报|报告|汇报|方案|合同|标书|项目|会议|开会|面试|考试|考研|学习|复习|作业|论文|毕设|课程|报名|健身|锻炼|跑步|体检|医院|看病|医生|药|复诊|缴费|账单|房租|房贷|贷款|信用卡|还款|报税|社保|签证|护照|身份证|妈妈|爸爸|父母|家人|孩子|生日|纪念日|牙医|保险|修车|发票|吉他|钢琴|画画)/;
const IMPORTANT_EN = /\b(work|boss|client|report|presentation|contract|project|meeting|interview|exam|study|class|course|lesson|homework|thesis|workout|gym|doctor|hospital|medicine|bill|rent|loan|tax|visa|passport|mom|dad|family|birthday|anniversary|dentist|insurance|guitar|piano)\b/i;
const TRIVIAL_ZH = /(游戏|电影|追剧|刷剧|综艺|小说|漫画|动漫|想买|种草|逛逛|逛街|外卖|奶茶|咖啡|皮肤|抽卡|刷视频|视频|球鞋|手办|盲盒|球星)/;
const TRIVIAL_EN = /\b(game|movie|show|series|novel|comic|anime|buy|shopping|bubble tea|coffee|skin|gacha|video|sneakers)\b/i;
const CHITCHAT = /^\s*(你好|您好|hi|hello|hey|yo|在吗|在么|早|早上好|上午好|下午好|晚上好|晚安|喵+|meow|谢谢|thanks|thank you|你是谁|who are you)[\s!~?？。！]*$/i;

const NOTE_QUIPS = {
  zh: {
    'do-now': ['这个先办，爪子别停。', '期限在敲门了。', '做完它再摸鱼。'],
    'plan': ['值得定个日子。', '写进日历就不会忘。', '重要的事，慢慢来。'],
    'quick': ['随手就办了。', '两分钟的事。', '速战速决。'],
    'someday': ['先记着，不着急。', '放这儿发芽。', '哪天有心情再说。']
  },
  en: {
    'do-now': ['Do this first. Paws moving.', 'The deadline is knocking.', 'Finish it, then nap.'],
    'plan': ['Worth a calendar slot.', 'Schedule it, forget it not.', 'Important things, slowly.'],
    'quick': ['Just do it in passing.', 'A two-minute thing.', 'Quick paws.'],
    'someday': ['Noted. No rush.', 'Leave it here to sprout.', 'Whenever the mood strikes.']
  }
};

function isUrgent(t) { return URGENT_ZH.test(t) || URGENT_EN.test(t); }
function importance(t) {
  if (IMPORTANT_ZH.test(t) || IMPORTANT_EN.test(t)) return 'important';
  if (TRIVIAL_ZH.test(t) || TRIVIAL_EN.test(t)) return 'trivial';
  return 'unknown';
}

function localPaige(rawInput) {
  const input = String(rawInput || '').trim();
  const zh = /[\u3400-\u9fff]/.test(input);
  const L = zh ? 'zh' : 'en';

  // 闲聊 / 打招呼：只聊天，不贴便签
  if (!input || (CHITCHAT.test(input) && input.length < 30)) {
    const hellos = zh ? [
      '喵，我在。把心里打转的事丢给我，我给你撕成便利贴贴到墙上。',
      '我在听。想到什么要办的事就说——一句话、一大段都行。',
      '（竖起耳朵）说吧，今天的脑子里装了什么？'
    ] : [
      "Meow, I'm here. Toss me whatever's spinning in your head and I'll pin it up as sticky notes.",
      "I'm listening. One line or a whole paragraph—either works.",
      '(ears up) Go on, what is in your head today?'
    ];
    return { emotion: 'greet', reply: hellos[input.length % hellos.length], notes: [] };
  }

  // 拆任务：按标点与连接词分段
  const fragments = input
    .split(/[\n。！？!?；;，,、]+|\s*(?:然后|还有|再有|另外|顺便|接着|以及|并且|而且)\s*|\s+(?:and then|and also|then also)\s+/i)
    .map(s => s.trim().replace(/^[，,。；;\s]+|[，,。；;\s]+$/g, ''))
    .filter(s => s.length >= (zh ? 2 : 3));

  const notes = [];
  for (let i = 0; i < fragments.length && notes.length < 8; i++) {
    let title = fragments[i]
      .replace(/^(我?(?:得|要|想|需要|应该|必须|打算)|记得|别忘了|别忘记|please|i (?:need|have|want|plan) to|remember to)\s*/i, '')
      .trim();
    if (!title) title = fragments[i];
    if (title.length > 26) title = title.slice(0, 25) + '…';

    const urgent = isUrgent(fragments[i]);
    const imp = importance(fragments[i]);
    const important = imp === 'important';
    let quadrant;
    if (important && urgent) quadrant = 'do-now';
    else if (important) quadrant = 'plan';
    else if (urgent) quadrant = 'quick';
    else if (imp === 'trivial') quadrant = 'someday';
    else quadrant = 'someday';
    const confidence = (imp === 'unknown' && !urgent) ? 'low' : 'high';
    const quips = NOTE_QUIPS[L][quadrant];
    const annotation = (i % 2 === 0) ? quips[(fragments[i].length + i) % quips.length] : '';
    notes.push({ title, quadrant, confidence, annotation });
  }

  if (!notes.length) {
    const reply = zh
      ? '嗯，这个我记成聊天就好。有要办的事再丢给我。'
      : "Hm, I'll file that as small talk. Toss me real to-dos anytime.";
    return { emotion: 'curious', reply, notes: [] };
  }

  const done = zh ? [
    `撕了 ${notes.length} 张便签，按轻重缓急贴上墙了。`,
    `${notes.length} 张，贴好了。急的用暖色，缓的用冷色。`,
    `拆出 ${notes.length} 件事。先做暖色的，别的慢慢来。`
  ] : [
    `Tore out ${notes.length} sticky note${notes.length > 1 ? 's' : ''} and pinned ${notes.length > 1 ? 'them' : 'it'} up by urgency.`,
    `${notes.length} note${notes.length > 1 ? 's' : ''}, all pinned. Warm colors first.`,
    `${notes.length} things, sorted. Warm notes first, the rest can breathe.`
  ];
  return { emotion: notes.length > 2 ? 'proud' : 'happy', reply: done[(input.length + notes.length) % done.length], notes };
}

function send(res, status, body, type='application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': type.includes('text/html') ? 'no-cache' : 'public, max-age=3600' });
  res.end(body);
}

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.obj':'text/plain; charset=utf-8','.glb':'model/gltf-binary','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'}[ext] || 'application/octet-stream');
}

async function readJson(req) {
  let data='';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1_000_000) throw new Error('Request too large');
  }
  return JSON.parse(data || '{}');
}

function extractOutputText(json) {
  if (typeof json.output_text === 'string') return json.output_text;
  const chunks = [];
  for (const item of json.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if (c.type === 'output_text' && c.text) chunks.push(c.text);
    }
  }
  return chunks.join('\n').trim();
}

async function chat(req, res) {
  try {
    const { messages = [] } = await readJson(req);
    const cleaned = messages.slice(-12).filter(m => ['user','assistant'].includes(m.role) && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: [{ type: 'input_text', text: m.content.slice(0, 6000) }] }));

    if (!process.env.OPENAI_API_KEY) {
      const last = cleaned.at(-1)?.content?.[0]?.text || '';
      const result = localPaige(last);
      return send(res, 200, JSON.stringify({ ...result, demo: true }));
    }

    const apiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: NPC_INSTRUCTIONS,
        input: cleaned,
        max_output_tokens: 1200
      })
    });
    const json = await apiRes.json();
    if (!apiRes.ok) {
      console.error(json);
      return send(res, apiRes.status, JSON.stringify({ error: json?.error?.message || 'OpenAI request failed' }));
    }
    const raw = extractOutputText(json) || '';
    const { reply, emotion, notes } = parsePaige(raw);
    return send(res, 200, JSON.stringify({ reply: reply || '（Paige 把便签贴好了，没多说什么。）', emotion, notes, demo: false, model: MODEL }));
  } catch (err) {
    console.error(err);
    return send(res, 500, JSON.stringify({ error: err.message || 'Server error' }));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && url.pathname === '/api/chat') return chat(req, res);

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(publicDir, pathname));
  if (!file.startsWith(publicDir)) return send(res, 403, 'Forbidden', 'text/plain');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found', 'text/plain');

  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': mime(file),
    'Content-Length': stat.size,
    'Cache-Control': pathname.endsWith('.obj') ? 'public, max-age=31536000, immutable' : 'no-cache'
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => console.log(`Paige sticky-note board: http://localhost:${PORT}`));
