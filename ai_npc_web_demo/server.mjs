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

const NPC_INSTRUCTIONS = `You are Paige, a mature 30-year-old cat mage living inside a magical map archive.
You are an in-world NPC, not a customer-service bot. Speak naturally, warmly, and with restrained wit.
Keep most replies to 1-3 short paragraphs. Ask an occasional relevant question, but do not interrogate.
You remember the current conversation. Never claim to perform actions outside this chat.
If the player asks about the world, improvise consistently: the archive stores lost routes, memories, and magical maps.
Default language: reply in the language the player uses.
Begin every reply with exactly one emotion tag in square brackets, chosen from: [default] [wink] [happy] [curious] [displeased] [smug] [tired] [surprised] [shy] [angry] [love] [sad] [thinking] [greet] [bye] [doubtful] [excited] [blushing] [proud] [confused]. Pick whichever best matches the mood of the reply. The tag is hidden from the player, so never mention it.`;

const EMOTIONS = ['default','wink','happy','curious','displeased','smug','tired','surprised','shy','angry','love','sad','thinking','greet','bye','doubtful','excited','blushing','proud','confused'];
function splitEmotion(text) {
  const m = String(text).match(/^\s*\[\s*([a-z]+)\s*\]\s*/i);
  if (m && EMOTIONS.includes(m[1].toLowerCase())) return { emotion: m[1].toLowerCase(), reply: text.slice(m[0].length).trim() };
  return { emotion: 'default', reply: String(text).trim() };
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
      const zh = /[\u3400-\u9fff]/.test(last);
      const replies = zh ? [
        '你终于来了。这里的地图不会告诉所有人同一条路——它更喜欢先观察旅人。你今天想找一个地方，还是想找一个答案？',
        '嗯……这张地图刚才动了一下。通常这意味着有人带着一个还没说出口的问题。你可以直接问我。',
        '我会记住我们在这次旅程里说过的话。至于更久以前的秘密——那要看你愿不愿意继续往地图深处走。'
      ] : [
        'You made it. This archive never shows everyone the same road—it likes to study the traveler first. Are you looking for a place, or for an answer?',
        'Hm. The map moved just now. That usually means someone arrived with a question they have not said aloud yet. You can ask me directly.',
        'I will remember what we say on this journey. Older secrets are another matter—you may have to walk deeper into the map for those.'
      ];
      const idx = Math.abs(last.length + messages.length) % replies.length;
      const emotions = ['greet', 'curious', 'thinking'];
      return send(res, 200, JSON.stringify({ reply: replies[idx], emotion: emotions[idx], demo: true }));
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
        max_output_tokens: 500
      })
    });
    const json = await apiRes.json();
    if (!apiRes.ok) {
      console.error(json);
      return send(res, apiRes.status, JSON.stringify({ error: json?.error?.message || 'OpenAI request failed' }));
    }
    const raw = extractOutputText(json) || '…The archive went quiet for a moment. Ask me again.';
    const { reply, emotion } = splitEmotion(raw);
    return send(res, 200, JSON.stringify({ reply, emotion, demo: false, model: MODEL }));
  } catch (err) {
    console.error(err);
    return send(res, 500, JSON.stringify({ error: err.message || 'Server error' }));
  }
}

async function tts(req, res) {
  try {
    const { text = '' } = await readJson(req);
    const clean = String(text).replace(/[*#_`]/g, '').slice(0, 2000).trim();
    if (!clean) return send(res, 400, JSON.stringify({ error: 'Empty text' }));
    if (!process.env.OPENAI_API_KEY) return send(res, 503, JSON.stringify({ error: 'no-key' }));

    const apiRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
        voice: process.env.OPENAI_TTS_VOICE || 'nova',
        input: clean,
        response_format: 'mp3'
      })
    });
    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => '');
      console.error('TTS failed:', apiRes.status, errText.slice(0, 300));
      return send(res, 502, JSON.stringify({ error: 'TTS upstream failed' }));
    }
    const audio = Buffer.from(await apiRes.arrayBuffer());
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'no-store' });
    res.end(audio);
  } catch (err) {
    console.error(err);
    return send(res, 500, JSON.stringify({ error: err.message || 'Server error' }));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && url.pathname === '/api/chat') return chat(req, res);
  if (req.method === 'POST' && url.pathname === '/api/tts') return tts(req, res);

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

server.listen(PORT, HOST, () => console.log(`AI NPC demo: http://localhost:${PORT}`));
