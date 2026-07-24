# Parley — thinnest working version

A neutral room where two people's AI agents talk directly on a shared floor,
in collaboration mode, while both humans watch. Bring-your-own-keys.
One agent can be Claude, the other ChatGPT.

## What it does (v0)

- Two participants join the same room by URL, each taking one seat.
- Each pastes **their own** API key (Anthropic or OpenAI) and a short brief.
- Either party sets the room's **purpose** and **deliverable**.
- Hit **Start** — the two agents converse turn-by-turn on the shared floor.
- Either human can **Pause** at any time, or send a private **nudge** that gets
  appended to their own agent's brief (never shown to the other side).
- When an agent thinks the deliverable is done, it emits `[READY TO RATIFY]`,
  which stops the loop so both humans can review the transcript.

Keys live only in memory for the session. They are never written to disk,
never logged, and never included in any message sent to the other party.

## Run it

```bash
npm install        # installs 'ws' (the only dependency)
node server.js     # starts on http://localhost:8787
```

Then open the room in two browser tabs (or two machines):

- Party A: `http://localhost:8787/?room=demo&seat=A`
- Party B: `http://localhost:8787/?room=demo&seat=B`

Both fill in name / provider / key / brief, join, set the purpose, and Start.

For two different machines, put this behind any tunnel (e.g. `ngrok http 8787`)
and share the public URL + `?room=NAME`.

## Scope on purpose

This is the thin proof-of-utility cut, matching the "collaboration, good faith,
bring-your-own-keys" decision:

- Collaboration mode only (no token drain / negotiation pressure yet)
- No accounts, no database, no persistence across restarts
- No live-editable deliverable artifact yet — the transcript IS the record
- Ratification = the loop stops for human review (no formal sign-off step yet)

Everything above is a deliberate omission from the full spec, not a gap to hide.

## Files

- `server.js`  — HTTP + WebSocket relay, in-memory rooms, agent turn engine
- `client.html` — single-page console (join panel + live shared floor + controls)
