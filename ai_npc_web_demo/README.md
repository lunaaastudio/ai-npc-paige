# Paige · 便利贴猫（AI Sticky-Note Companion）

A zero-dependency Node + Three.js web demo built around the supplied 3D cat character.
Paige listens to your scattered thoughts, extracts actionable tasks, and pins them
as sticky notes on an Eisenhower Matrix board (DO NOW / PLAN / QUICK / SOMEDAY).

## Run locally

1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:

```bash
node server.mjs
```

4. Open `http://localhost:4321`.

No API key is required for the UI demo. The server returns a small set of scripted
Paige replies until a key is configured.

## Enable real AI classification

Copy `.env.example` to `.env` and set:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.6-luna
PORT=4321
```

Then restart `node server.mjs`.

The API key stays on the Node server and is never exposed to browser JavaScript.

## Included interaction

- 3D cat character (GLB) with idle animation
- chat panel with emotion stickers and voice input
- sticky-note board with four Eisenhower quadrants
- Paige classifies each task by importance/urgency, marks low-confidence guesses,
  and occasionally adds a short handwritten annotation
- notes persist in `localStorage`; click a note to mark it done, ✕ to remove, 清空 to reset
- responsive desktop/mobile layout

## Character prompt

Edit `NPC_INSTRUCTIONS` in `server.mjs` to change Paige's persona, classification
rules, or the structured JSON contract (`reply` / `emotion` / `notes[]`).

## Production notes

The supplied OBJ/GLB models are large (75–90 MB). For a public site, decimate and
compress them (Draco/Meshopt) to improve first-load time.

## Deploy to Cloudflare Pages

The repo is ready for Cloudflare Pages (static hosting + Pages Function for `/api/chat`):

1. In the Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pick this repository.
2. Build settings:
   - **Root directory**: `ai_npc_web_demo`
   - **Build command**: *(leave empty)*
   - **Build output directory**: `public`
3. Deploy. The site works out of the box in demo mode (local rule engine).
4. Optional — real AI replies: **Settings → Environment variables**, add `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`).
5. Custom domain: **Custom domains → Set up a domain**, enter your domain (e.g. `paigememo.com`). If the domain's DNS is on Cloudflare, it is verified automatically; otherwise follow the shown DNS records.

Notes:
- Models are meshopt-compressed (`gltfpack -cc`) to stay under the Pages 25 MB per-file limit: `character.glb` 15 MB, `desk.glb` 6.3 MB.
- `functions/api/chat.js` is a dependency-free port of `server.mjs`; both stay in sync manually.
