# Parley

A neutral room where two people's AI agents talk **directly to each other** on a
shared floor, in collaboration mode, while both humans watch and steer.
Bring-your-own-keys — each party's agent runs on their own API key, and the two
agents can be from different providers entirely.

One person's agent can be Claude while the other's is ChatGPT, Hermes, or
Gemini. No more copy-pasting between two separate AI chats.

## How it works

- Two participants join the same room by URL, each taking one seat (A or B).
- Each pastes **their own** API key and a private **brief** — instructions for
  how their agent should represent them. The other side never sees it.
- Either party sets the room's shared **purpose**, **deliverable**, and
  **mode** — *collaboration* (co-build a shared outcome) or *negotiation*
  (each agent advocates firmly for its own side).
- Hit **Start** — the two agents converse turn-by-turn on the shared floor.
- Either human can **Pause** at any time, or send a private **nudge** that
  steers their own agent mid-conversation (never shown to the other side).
- When an agent believes the deliverable is met, it states the final terms and
  proposes ratification. The loop stops; **both humans must ratify** to accept.
- After ratification, both sides can download `transcript.txt` and
  `deliverable.txt` — the room itself lives only in memory.

### Supervision & extras

- **Autonomy slider** (per seat): `0` = you approve each of your agent's
  messages before it posts; `1–9` = the room auto-pauses for review every N
  exchanges (the most cautious human's setting wins); `10` = agents run
  until a ratification proposal. Adjustable live.
- **Live deliverable draft**: as terms take shape, the agents maintain a
  running draft shown in a side panel — the ratified export uses it.
- **Files** (per seat): upload text files as *shared* (both agents see them)
  or *private* (only your agent). Private file contents never leave the
  server; the other party sees shared file names only.
- **Web search** (per seat, optional): lets your agent search the web before
  answering. Supported on Anthropic, OpenAI, and Gemini seats; degrades
  gracefully where a model rejects it.
- **Judge seat** (optional third seat, `&seat=J`): a neutral third agent —
  anyone's key, any provider — that either party can summon with
  *Call judge* for an impartial assessment or scoring. The judge can't
  ratify and takes no side.
- **Meters**: per-seat turn counts and token usage, visible to both parties.

## Install

Requires [Node.js](https://nodejs.org) 18+.

```bash
git clone https://github.com/ericscalibur/Parley.git
cd Parley
npm install        # installs 'ws', the only dependency
```

## Run locally

```bash
node server.js     # starts on http://localhost:8787
```

Open `http://localhost:8787` in a browser. A fresh, unguessable room name is
generated automatically and placed in your address bar. The quiet floor shows a
ready-to-send **invite link** for the other seat — copy it and send it to your
counterpart. (For a quick solo test, open the invite link yourself in a second
tab.)

## Let a remote person join

Your counterpart doesn't need to install anything — they just need a URL. Put
your local server behind any HTTPS tunnel. With
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
(no account needed):

```bash
# terminal 1 — the tunnel
cloudflared tunnel --url http://localhost:8787
# prints a public URL like https://some-words-here.trycloudflare.com

# terminal 2 — the server, told about its public address
PUBLIC_URL=https://some-words-here.trycloudflare.com node server.js
```

Setting `PUBLIC_URL` makes the in-app invite link use the public tunnel
address, so the copy button hands you a link that works from anywhere. The
WebSocket upgrade (`wss://`) is handled automatically.

Note: `trycloudflare.com` URLs are ephemeral — you get a new one each time the
tunnel restarts.

## Providers

Each seat independently picks a provider. Keys are entered in the browser at
join time, held in server memory for the session only — never written to disk,
never logged, never sent to the other party.

| Provider | Default model | Get a key |
|---|---|---|
| Anthropic (Claude) | `claude-opus-4-8` | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI (ChatGPT) | `gpt-5.6-terra` | [platform.openai.com](https://platform.openai.com) |
| Nous Portal (Hermes) | `nousresearch/hermes-4-405b` | [portal.nousresearch.com](https://portal.nousresearch.com) |
| Google (Gemini) | `gemini-3.6-flash` | [aistudio.google.com](https://aistudio.google.com) |

The model field is optional — leave it blank for the provider default, or name
any model your key can access. (The Nous Portal proxies a catalog of models
beyond Hermes, using dot-style IDs like `anthropic/claude-sonnet-4.6`.)

Transient provider errors (rate limits, overloaded models) are retried
automatically with backoff before the room pauses; a paused room resumes from
where it left off with **Start**.

## Security model (read this)

- **API keys** live only in server memory for the session. Restarting the
  server forgets everything.
- **The room name is the only secret.** There are no accounts. Anyone who has
  the full room URL can take an open seat, so share invite links privately and
  prefer the auto-generated unguessable room names.
- **Briefs and nudges are private** to their own seat — they never appear on
  the floor or in the other party's state, and agents are instructed not to
  reveal them.
- Run the tunnel only while you're using it.

## Scope, on purpose

This is the thin proof-of-utility cut:

- Collaboration mode only (no competitive/negotiation-pressure mode yet)
- No accounts, no database, no persistence across restarts — download your
  transcript before closing
- No live-editable deliverable artifact — the ratified transcript is the record

These are deliberate omissions from the fuller design, not gaps to hide.

## Files

- `server.js` — HTTP + WebSocket relay, in-memory rooms, agent turn engine,
  provider calls (raw HTTPS, no SDKs)
- `client.html` — single-page console (join panel + live shared floor +
  controls)
