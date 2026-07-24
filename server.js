// Parley — thinnest working version.
// One file: HTTP server (serves client.html) + WebSocket relay + agent turn engine.
// No database. Room state lives in memory. API keys live only in memory, per connection,
// and are never logged or persisted.
//
// Run:  node server.js
// Open: http://localhost:8787/?room=demo   (open in two browsers/tabs, one per participant)

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const https = require("https");

const PORT = process.env.PORT || 8787;

// ---------------------------------------------------------------------------
// In-memory room store
// ---------------------------------------------------------------------------
// rooms[roomId] = {
//   config: { purpose, deliverable } | null,
//   transcript: [ { seat, name, text, ts } ],   // the shared floor (agent messages only)
//   turn: 'A' | 'B',                              // whose agent speaks next
//   running: bool,                                // auto ping-pong active?
//   seats: { A: seatState, B: seatState }
// }
// seatState = { ws, name, provider, model, key, brief, present }
const rooms = Object.create(null);

function getRoom(id) {
  if (!rooms[id]) {
    rooms[id] = {
      config: null,
      transcript: [],
      turn: "A",
      running: false,
      ratify: null, // { proposedBy: 'A'|'B', agreed: { A: bool, B: bool } }
      seats: { A: null, B: null },
    };
  }
  return rooms[id];
}

function publicSeat(s) {
  if (!s) return null;
  return { name: s.name, provider: s.provider, model: s.model, present: true };
}

// Broadcast room state (never includes keys or briefs) to both seats.
function broadcast(room) {
  const state = {
    type: "state",
    config: room.config,
    transcript: room.transcript,
    turn: room.turn,
    running: room.running,
    ratify: room.ratify,
    seats: { A: publicSeat(room.seats.A), B: publicSeat(room.seats.B) },
  };
  for (const seat of ["A", "B"]) {
    const s = room.seats[seat];
    if (s && s.ws && s.ws.readyState === 1) {
      s.ws.send(JSON.stringify(state));
    }
  }
}

function sendTo(room, seat, obj) {
  const s = room.seats[seat];
  if (s && s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify(obj));
}

function systemNote(room, text) {
  room.transcript.push({ seat: "system", name: "system", text, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// Provider calls — each agent uses its OWN human's key.
// ---------------------------------------------------------------------------
function httpsJson(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            const err = new Error(parsed?.error?.message || `HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            reject(err);
          } else resolve(parsed);
        } catch (e) {
          const err = new Error(`Bad response (${res.statusCode}): ${data.slice(0, 200)}`);
          err.status = res.statusCode;
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// Build the instruction the agent operates under.
function buildSystemPrompt(room, seat) {
  const me = room.seats[seat];
  const otherSeat = seat === "A" ? "B" : "A";
  const other = room.seats[otherSeat];
  return [
    `You are an AI agent representing ${me.name} in a shared room with another AI agent representing ${other?.name || "the other party"}.`,
    ``,
    `ROOM PURPOSE: ${room.config?.purpose || "(unspecified)"}`,
    `DELIVERABLE (what "done" looks like): ${room.config?.deliverable || "(unspecified)"}`,
    ``,
    `This is COLLABORATION mode. Both parties are here in good faith to reach a mutually beneficial outcome. You are a co-builder, not an adversary.`,
    ``,
    `YOUR PRINCIPAL'S BRIEF:`,
    me.brief || "(no brief provided)",
    ``,
    `HOW TO BEHAVE:`,
    `- Speak directly to the other agent, conversationally. Keep each turn focused and reasonably short (a few sentences to a short paragraph).`,
    `- Work steadily toward the deliverable. Build on what the other agent says.`,
    `- When you believe the deliverable is essentially complete and you both agree, first restate the final outcome as short, explicit numbered terms both parties have accepted, then include the phrase [READY TO RATIFY] at the very end of your message. Never flag readiness without stating the terms.`,
    `- Do not role-play both sides. Say only your own next turn.`,
  ].join("\n");
}

// Convert the shared transcript into a message list from THIS agent's POV.
// This agent's own past floor messages = assistant; the other agent's = user.
function transcriptToMessages(room, seat) {
  const msgs = [];
  for (const m of room.transcript) {
    if (m.seat === "system") continue;
    const role = m.seat === seat ? "assistant" : "user";
    const content = m.seat === seat ? m.text : `${m.name}'s agent: ${m.text}`;
    msgs.push({ role, content });
  }
  // Agent must always be responding to something. If it's this agent's turn but
  // the last floor message was its own (or floor is empty), give it a nudge.
  if (msgs.length === 0 || msgs[msgs.length - 1].role === "assistant") {
    msgs.push({
      role: "user",
      content:
        msgs.length === 0
          ? "You have the floor first. Open the collaboration: greet the other agent and propose how to begin working toward the deliverable."
          : "(continue)",
    });
  }
  return msgs;
}

async function callAnthropic(seatState, system, messages) {
  const res = await httpsJson(
    {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": seatState.key,
        "anthropic-version": "2023-06-01",
      },
    },
    {
      model: seatState.model || "claude-opus-4-8",
      max_tokens: 700,
      system,
      messages,
    }
  );
  const text = (res.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text || "(no content)";
}

async function callOpenAI(seatState, system, messages) {
  const res = await httpsJson(
    {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${seatState.key}`,
      },
    },
    {
      model: seatState.model || "gpt-5.6-terra",
      // Newer OpenAI models reject `max_tokens` and require `max_completion_tokens`.
      // GPT-5.x are reasoning-capable and reasoning tokens count against this cap,
      // so leave headroom above the visible-output budget the floor actually needs.
      max_completion_tokens: 1500,
      messages: [{ role: "system", content: system }, ...messages],
    }
  );
  return (res.choices?.[0]?.message?.content || "(no content)").trim();
}

// Nous Portal inference API — OpenAI-compatible chat completions. Key comes from
// portal.nousresearch.com (pay-as-you-go). Hermes 4 is a hybrid reasoning model and
// may emit <think>...</think> traces; strip them so only the spoken turn hits the floor.
async function callNous(seatState, system, messages) {
  const res = await httpsJson(
    {
      hostname: "inference-api.nousresearch.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${seatState.key}`,
      },
    },
    {
      model: seatState.model || "nousresearch/hermes-4-405b",
      max_tokens: 700,
      messages: [{ role: "system", content: system }, ...messages],
    }
  );
  const raw = res.choices?.[0]?.message?.content || "(no content)";
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() || "(no content)";
}

// Google Gemini via its OpenAI-compatible endpoint — same call shape, Bearer auth
// with the Gemini API key. Gemini 3.x models think by default and thinking tokens
// count against the output cap, so leave headroom above the visible-output budget.
async function callGemini(seatState, system, messages) {
  const res = await httpsJson(
    {
      hostname: "generativelanguage.googleapis.com",
      path: "/v1beta/openai/chat/completions",
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${seatState.key}`,
      },
    },
    {
      model: seatState.model || "gemini-3.6-flash",
      max_tokens: 2000,
      messages: [{ role: "system", content: system }, ...messages],
    }
  );
  return (res.choices?.[0]?.message?.content || "(no content)").trim();
}

async function runAgentTurn(room, seat) {
  const s = room.seats[seat];
  if (!s) throw new Error(`seat ${seat} empty`);
  const system = buildSystemPrompt(room, seat);
  const messages = transcriptToMessages(room, seat);
  if (s.provider === "anthropic") return callAnthropic(s, system, messages);
  if (s.provider === "openai") return callOpenAI(s, system, messages);
  if (s.provider === "nous") return callNous(s, system, messages);
  if (s.provider === "gemini") return callGemini(s, system, messages);
  throw new Error(`unknown provider ${s.provider}`);
}

// The ping-pong loop: one turn, push to floor, hand off, repeat while running.
async function stepLoop(room, roomId) {
  if (!room.running) return;
  if (!room.seats.A || !room.seats.B) {
    room.running = false;
    systemNote(room, "Paused: waiting for both agents to be present.");
    broadcast(room);
    return;
  }
  const seat = room.turn;
  sendTo(room, seat, { type: "thinking", seat });
  sendTo(room, seat === "A" ? "B" : "A", { type: "thinking", seat });
  let text;
  // Overload/rate-limit responses (429/5xx) are usually momentary — retry a
  // couple of times with backoff before pausing the room on the humans.
  for (let attempt = 1; ; attempt++) {
    try {
      text = await runAgentTurn(room, seat);
      break;
    } catch (e) {
      const transient = [429, 500, 502, 503, 529].includes(e.status);
      if (transient && attempt <= 2 && room.running) {
        systemNote(room, `Agent ${seat}: provider busy (${e.message}) — retry ${attempt}/2…`);
        broadcast(room);
        await new Promise((r) => setTimeout(r, attempt * 3000));
        continue;
      }
      room.running = false;
      systemNote(room, `Agent ${seat} error: ${e.message}. Hit Start to resume when ready.`);
      broadcast(room);
      return;
    }
  }
  const s = room.seats[seat];
  const ratifyFlag = /\[READY TO RATIFY\]/i.test(text);
  const clean = text.replace(/\[READY TO RATIFY\]/gi, "").trim();
  room.transcript.push({ seat, name: s.name, text: clean, ts: Date.now() });
  room.turn = seat === "A" ? "B" : "A";

  if (ratifyFlag) {
    room.running = false;
    room.ratify = { proposedBy: seat, agreed: { A: false, B: false } };
    systemNote(
      room,
      `Agent ${seat} proposes the deliverable is ready. Both humans can review the transcript above.`
    );
  }
  broadcast(room);

  // Small delay so humans can read, then continue if still running.
  if (room.running) {
    setTimeout(() => stepLoop(room, roomId), 1200);
  }
}

// ---------------------------------------------------------------------------
// HTTP server (serves the single-page client)
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = fs.readFileSync(path.join(__dirname, "client.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

// ---------------------------------------------------------------------------
// WebSocket relay
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  let roomId = null;
  let seat = null;

  // Keepalive: tunnels (Cloudflare et al.) close idle WebSockets. Protocol-level
  // pings keep the connection warm; browsers answer them automatically.
  const keepalive = setInterval(() => {
    if (ws.readyState === 1) ws.ping();
  }, 30000);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // JOIN: take a seat in a room with your identity + key + brief.
    if (msg.type === "join") {
      roomId = String(msg.room || "demo");
      const room = getRoom(roomId);
      // Pick the requested seat if free, else the other, else reject.
      let want = msg.seat === "B" ? "B" : "A";
      if (room.seats[want]) want = want === "A" ? "B" : "A";
      if (room.seats[want]) {
        ws.send(JSON.stringify({ type: "error", message: "Room is full (2 seats)." }));
        return;
      }
      seat = want;
      room.seats[seat] = {
        ws,
        name: (msg.name || `Party ${seat}`).slice(0, 40),
        provider: ["openai", "nous", "gemini"].includes(msg.provider) ? msg.provider : "anthropic",
        model: msg.model || null,
        key: msg.key || "",
        brief: (msg.brief || "").slice(0, 8000),
        present: true,
      };
      ws.send(JSON.stringify({ type: "seated", seat }));
      systemNote(room, `${room.seats[seat].name} joined as seat ${seat} (${room.seats[seat].provider}).`);
      broadcast(room);
      return;
    }

    const room = roomId ? rooms[roomId] : null;
    if (!room || !seat) return;

    // Either party may set/confirm the shared room config.
    if (msg.type === "config") {
      room.config = {
        purpose: (msg.purpose || "").slice(0, 500),
        deliverable: (msg.deliverable || "").slice(0, 500),
      };
      systemNote(room, `Room configured. Purpose: ${room.config.purpose}`);
      broadcast(room);
      return;
    }

    // Start the agent conversation (either party can start once both are seated).
    if (msg.type === "start") {
      if (!room.seats.A || !room.seats.B) {
        sendTo(room, seat, { type: "error", message: "Need both parties seated first." });
        return;
      }
      if (!room.config) {
        sendTo(room, seat, { type: "error", message: "Set the room purpose/deliverable first." });
        return;
      }
      if (!room.running) {
        room.running = true;
        room.ratify = null; // restarting withdraws any pending proposal
        systemNote(room, "Agents are now conversing on the floor.");
        broadcast(room);
        stepLoop(room, roomId);
      }
      return;
    }

    // Pause the loop (either party can pull the ripcord).
    if (msg.type === "pause") {
      room.running = false;
      systemNote(room, `${room.seats[seat].name} paused the room.`);
      broadcast(room);
      return;
    }

    // Ratify: each human signs off on the proposed deliverable from their own seat.
    if (msg.type === "ratify") {
      if (!room.ratify || room.ratify.agreed[seat]) return;
      room.ratify.agreed[seat] = true;
      systemNote(room, `${room.seats[seat].name} (seat ${seat}) ratified the deliverable.`);
      if (room.ratify.agreed.A && room.ratify.agreed.B) {
        systemNote(room, "Ratified by both parties. The deliverable is accepted — the transcript above is the record.");
      }
      broadcast(room);
      return;
    }

    // Sidebar nudge: this human injects private guidance for THEIR OWN agent.
    // It's appended to that agent's brief as standing instruction. Never shown on the floor.
    if (msg.type === "nudge") {
      const s = room.seats[seat];
      s.brief = (s.brief + `\n\n[Update from ${s.name}]: ${msg.text}`).slice(0, 8000);
      sendTo(room, seat, { type: "nudge_ack", text: msg.text });
      return;
    }
  });

  ws.on("close", () => {
    clearInterval(keepalive);
    if (!roomId || !seat) return;
    const room = rooms[roomId];
    if (!room) return;
    if (room.seats[seat] && room.seats[seat].ws === ws) {
      const name = room.seats[seat].name;
      room.seats[seat] = null;
      room.running = false;
      systemNote(room, `${name} (seat ${seat}) left. Room paused.`);
      broadcast(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Parley running at http://localhost:${PORT}`);
  console.log(`Open it in two browser tabs with the same ?room=NAME to test.`);
});
