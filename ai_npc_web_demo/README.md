# Paige · Web AI NPC Demo

A zero-dependency Node + Three.js web demo built around the supplied OBJ character.

## Run locally

1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:

```bash
node server.mjs
```

4. Open `http://localhost:4321`.

No API key is required for the UI demo. The server returns a small set of scripted NPC replies until a key is configured.

## Enable real AI dialogue

Copy `.env.example` to `.env` and set:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.6-luna
PORT=4321
```

Then restart `node server.mjs`.

The API key stays on the Node server and is never exposed to browser JavaScript.

## Included interaction

- supplied OBJ model, using its embedded vertex colors
- drag to rotate / wheel to zoom / reset camera
- subtle idle floating motion
- streaming-style dialogue state
- AI or offline demo dialogue
- conversation history within the current session
- browser speech-to-text where supported
- browser text-to-speech for NPC replies
- responsive desktop/mobile layout

## Character prompt

Edit `NPC_INSTRUCTIONS` in `server.mjs` to change Paige's identity, lore, tone, speaking style, quest logic, or game-world rules.

## Production notes

The supplied OBJ is very large (~90 MB). For a public site, convert/decimate it to GLB/GLTF and optionally use Draco/Meshopt compression. This will dramatically improve first-load time.
