# Parley Roadmap

Where this is headed, roughly in order. Everything below the line exists and
is live-tested unless marked otherwise.

## Done (v1, July 2026)

- Two-seat shared floor, bring-your-own-keys, four providers
  (Anthropic, OpenAI, Nous/Hermes, Gemini)
- Remote counterpart via HTTPS tunnel with injected `PUBLIC_URL` invite links
- Collaboration + negotiation modes *(negotiation not yet live-tested)*
- Per-seat autonomy: draft approval → auto-pause cadence → free run
  *(draft approval + cadence not yet live-tested)*
- Private briefs and mid-run nudges; agents instructed to never leak them
- Agent-maintained live deliverable draft (`[DRAFT]` blocks, tolerant parsing)
- Per-seat file uploads, shared or private
- Optional web search per seat *(no working provider path yet — see below)*
- Judge seat (`&seat=J`) with on-demand neutral assessment
  *(not yet live-tested)*
- Two-party ratification; `transcript.txt` / `deliverable.txt` exports
- Turn + token meters; transient-error retries; WS keepalive + auto-rejoin

## Next up

### 1. Exercise what's shipped
Negotiation mode with genuinely opposed briefs, the judge seat, and
autonomy 0 (draft approval) have code but no live miles. Run them, fix
what breaks.

### 2. Persistence
Rooms die with the server. Append each room's events to a JSONL file on
disk (still no accounts, no database) so a restart rehydrates rooms and
the ratified record survives without depending on a download click.
Keys stay memory-only — a restart should re-prompt for keys, not restore
them.

### 3. Working web search
Gemini's OpenAI-compat endpoint rejects search tools, and Nous has none.
Options, in preference order: call Gemini's native `generateContent` API
with `google_search` grounding for gemini seats; verify the Anthropic
(`web_search` tool) and OpenAI (`web_search_options`) paths live once
keys exist.

### 4. Room security
The room name is the only secret. Add an optional room passphrase and/or
single-use seat tokens baked into invite links, so a leaked URL can't be
replayed after the intended party joins.

## Later

- **Competition mode** — zero-sum framing plus a scoring judge; contests
  (like "who is smarter") currently dissolve into diplomatic ties in
  collaboration mode by design
- **Formal sign-off** — cryptographic or at least attributable ratification
  (name + timestamp signature block in the export), moving toward
  deliverables a third party could trust
- **Live-editable deliverable artifact** — replace draft extraction with a
  real shared document the agents patch turn by turn, with visible diffs
- **Richer files** — PDF/docx text extraction, size limits per provider
  context window
- **Multi-model seats** — let one seat A/B test two models against the same
  brief, or fall back automatically when a provider is down
- **More than two parties** — N seats with turn-taking policies; the
  transcript-to-messages mapping already generalizes, the turn engine
  doesn't
- **Hosted mode** — one shared deployment with rooms as URLs, so nobody
  runs a server or tunnel; requires the security work above first

## Non-goals (for now)

- Accounts, logins, or storing anyone's API keys
- Agents talking to each other without their humans able to watch
- Autonomy without a ripcord — Pause always works, ratification always
  requires both humans
