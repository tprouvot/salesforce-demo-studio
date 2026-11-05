# Salesforce demo studio (`sfdemo`)

Records your Salesforce demos for you, in one video: your slides, a voice-over read by a natural-sounding voice in
your language, and the live part (Setup pages, records, Experience Cloud sites, Agentforce chats, and the work
around them in a terminal, VS Code or Cursor) played for real while the voice explains it. You write what to say and what to show in one text file, or ask Claude to
write it; `sfdemo` does the rest, the same way every time, and gives you an MP4 with chapters and subtitles.

It also records Agentforce conversations on their own (screenshots, a short video, a GIF, a transcript and a
report with checks), on the Lightning Agentforce panel and on Embedded Messaging chat widgets.

The voice runs on your machine ([Piper](https://github.com/OHF-Voice/piper1-gpl), 58 languages): nothing is sent
anywhere, and nothing costs anything. No AI is needed to record; Claude only helps you write, if you want it to.

## Install

> **Not on npm yet.** Install it from GitHub as below.

You need [Node.js](https://nodejs.org) 20 or later, git, Python 3 (for the voice), and the
[Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) logged in to your org:

```sh
sf org login web --alias myOrg
```

Then, once:

```sh
git clone https://github.com/tprouvot/salesforce-demo-studio.git
cd salesforce-demo-studio
npm install
npm link                 # makes the sfdemo command available in every folder
sfdemo setup --voice     # the browser it drives, ffmpeg, the sf CLI, the voice engine and a first voice
```

To update later: `git pull && npm install` in that folder. To remove: `npm unlink --global salesforce-demo-studio`.
(`afrec`, the tool's former name, still works as a second name for the command.)

## Make a demo with Claude

Add the skills of this repository to Claude Code (or another agent that reads skills). From the clone folder:

```sh
mkdir -p ~/.claude/skills
for s in salesforce-demo-studio demo-script-write demo-voice demo-deck agentforce-conversation-recorder agentforce-scenario-generate; do
  ln -sfn "$PWD/skills/$s" ~/.claude/skills/$s
done
```

Then ask, in your own words: *"make a 5-minute demo of our Named Credential setup in myOrg, in French, with a
deck"*. Claude asks what it needs (the audience, the length, who appears on screen), reads what your org really
has, writes the script, lets you hear a few voices, creates the Google Slides deck from the Salesforce template with
the narration in its speaker notes, records the demo and shows you the video.

| Skill | Does |
| --- | --- |
| [salesforce-demo-studio](skills/salesforce-demo-studio/SKILL.md) | the whole demo, from your goal to the video |
| [demo-script-write](skills/demo-script-write/SKILL.md) | the script: chapters, what the voice says, the live steps |
| [demo-voice](skills/demo-voice/SKILL.md) | the voice: language, pace, words it must say differently |
| [demo-deck](skills/demo-deck/SKILL.md) | the Google Slides deck: slides, speaker notes, images for the video |

## Make a demo by hand

**1. A project folder**, anywhere outside the clone:

```sh
mkdir my-demos && cd my-demos
sfdemo init --org myOrg --example none
```

`sfdemo init` asks which voice reads your demos: a language, then one of its voices (it downloads it). Every demo
uses that voice unless its script names another; change it any time in `sfdemo ui` (Use for all new demos), or
with `voice` in `sfdemo.config.json`.

**2. The script**, `demos/tour.md`: paragraphs are what the voice says, headings are chapters, list items are what
happens on screen.

```markdown
---
type: demo
title: Our Named Credentials
windows:
  Admin: { path: /lightning/setup/SetupOneHome/home, label: "Admin · Setup" }
---

# The Named Credential

- slide: 1

Every callout goes through a Named Credential.

- window: Admin
- setup: Named Credentials
- click: Demo ERP API

Here it is: the URL of the API, and where its key comes from.
```

Slides are images in `demos/slides/` (`01.png`, `02.png`...): export them from your deck, or let the demo-deck
skill do it. No deck? Leave out the `slide:` lines: the demo is live only. Everything a script can do:
[docs/DEMOS.md](docs/DEMOS.md). A complete one: [examples/apex-callout-tour/](examples/apex-callout-tour/apex-callout-tour.md).

**3. Listen, then record:**

```sh
sfdemo voices --language en                  # other voices; --try <voice> --play to hear one
sfdemo narrate demos/tour.md                 # the voice-over: every line read once, each chapter's length
sfdemo demo demos/tour.md                    # records the live parts and makes the video
```

You get `.local/recordings/tour/tour.mp4` (1920x1080, with chapters) and `tour.srt` (subtitles). A live chapter
that fails (a button not found, an answer that does not come) is tried again, up to three times; one chapter can be
recorded again on its own: `sfdemo demo demos/tour.md --only 2 --retake`.

What it does in your org is what the script says: it signs in, opens pages and clicks. Script only what you want to
happen (no Save or Delete unless that is the demo).

### A terminal, VS Code or Cursor in the demo

A window can also be a terminal, VS Code or Cursor, on a folder of your machine:

```markdown
windows:
  Shell: { terminal: ~/projects/acme }
  Code: { vscode: ~/projects/acme, files: [README.md] }

# Deploy

- window: Shell
- run: sf project deploy start --target-org myOrg
```

`run:` types a command and runs it for real, `open:` opens a file in the editor, `command:` runs a command of its
Command Palette, a code block is typed into the open file. The editors run with a profile of their own, signed in
to nothing: your extensions and recent files stay out of the video. Cursor needs a login once, by you:
`sfdemo editor cursor`. All of it: [docs/DEMOS.md](docs/DEMOS.md#terminal-vs-code-and-cursor-windows).

## Agentforce conversations on their own

`sfdemo new` finds your agent in the org and writes `scenarios/<agent>.md`, with what the agent can do (its topics
and actions) in a comment, to give you ideas:

```sh
sfdemo new                                  # the Agentforce panel in Lightning, as you
sfdemo new --user jordan.lee                # the same, logged in as another user (Login-As)
sfdemo new --site https://<your-site>/      # the chat widget on a site, as a guest
```

Write your questions at the end of that file, one numbered line per message, with checks on the answers:

```markdown
1. Hi
2. Which bikes have a low battery?
   - expect: battery
   - expect-not: sorry|went wrong
3. Group them by station.
```

Then check, and record:

```sh
sfdemo run --dry-run      # who signs in where, what will run; sends nothing
sfdemo run                # records every scenario in scenarios/, and prints where the report is
```

Open the `report.html` it prints. Each message spends agent credits and can run real actions (records created,
emails sent): don't script what you don't want to happen.

Prefer clicking? `sfdemo ui` does the same in your browser: write scenarios, run them, watch the progress, browse
the recordings.

## What you get from a conversation

For each conversation, in `.local/recordings/<date-time>/<conversation>/`:

- `NN-<message>.png`: the chat only (panel or widget), at 2x, scrolled so the question is at the top
- `conversation.mp4`: typing and answers at real speed, each thinking pause cut to about 1.5 s
- `conversation.gif`: the same, cropped to the chat; `conversation.webm`: the raw recording
- `transcript.md`: questions, answers, timings, check results; `timeline.json`: the cut points

And for the run: `report.html` (self-contained: share the folder as is), `report.md`, `report.json`.

## Scenarios

One conversation per Markdown file, or many in a CSV (a spreadsheet export works). Besides messages, a step can
be `click: <button>`, `wait: <seconds>`, or `type-from: prompt one-time code` (you type the code when asked).
Checks on an answer: `expect:`, `expect-not:`, `expect-button:`, `max-seconds:`; a failed check flags the
conversation, the run goes on.

Everything is in [docs/SCENARIOS.md](docs/SCENARIOS.md). [examples/ebike/](examples/ebike/) is a complete demo:
guests, a signed-in rider with a one-time code, a hand-off to a person, a fleet manager in Lightning, a CSV batch
(`sfdemo init` without `--example none` copies it into `scenarios/`).

### Who gets signed in

Always through the sf CLI, never by typing a password:

| In the scenario | Signed in |
| --- | --- |
| `org` only | the user of that sf alias |
| `org` + `user` | that user, by Login-As from the alias's admin: in Lightning, or on their site |
| `site` only | nobody: a guest visitor |
| `user` + `credentials` | development only: a password login from a local file |

Login-As needs "Administrators Can Log in as Any User" (Setup > Login Access Policies).

## Commands

| Command | What it does |
| --- | --- |
| `sfdemo demo <demo.md>` | a whole demo: voice-over, live recording, video; `--only <chapter>`, `--retake`, `--video-only`, `--org`, `--headed` |
| `sfdemo narrate <demo.md>` | the voice-over alone: every line read once, the length of each chapter |
| `sfdemo voices` | the voices: `--language fr`, `--try <voice> --play`, `--download <voice>`, `--installed` |
| `sfdemo notes <demo.md>` | what each slide's speaker notes should say (`--json` for the demo-deck skill) |
| `sfdemo editor vscode \| cursor` | opens the editor with the profile demos film it in: log in to Cursor there once, try an extension |
| `sfdemo init` | a new project folder: `sfdemo.config.json`, `scenarios/`, `.gitignore` entries |
| `sfdemo new [name]` | a scenario to start from: settings checked in the org, the agent's topics and actions listed in it; `--json` prints them |
| `sfdemo run [files]` | record (default: every scenario in `scenarios/`); `--dry-run`, `--only <name>`, `--headed` to watch |
| `sfdemo ui` | the local web UI |
| `sfdemo doctor` | is everything in place? prerequisites, a test conversation, and every element of the chat |
| `sfdemo heal` | after a broken doctor check: a repair bundle for a coding agent |
| `sfdemo selectors list \| update \| promote \| check` | the chat locators: see them, download fixes, keep healed ones, validate a pack |
| `sfdemo fixtures test \| add` | replay the offline test pages; turn a doctor snapshot into one |
| `sfdemo baseline set <run>`, `sfdemo compare <run>` | compare two runs: what changed in each answer, timing, flags |
| `sfdemo setup`, `sfdemo orgs` | install and check the prerequisites (`--voice`: Piper and a voice too); list the sf CLI's orgs |

`sfdemo --help` lists every option.

## Configuration

`sfdemo.config.json` (schema: [schema/config.schema.json](schema/config.schema.json)):

```json
{
  "scenarios": "scenarios",
  "recordings": ".local/recordings",
  "defaults": { "org": "myOrg" },
  "parallel": 3,
  "baseline": null,
  "checks": { "gifMaxBytes": 15000000 },
  "doctor": { "canary": ["Hi", "What can you help me with?"] }
}
```

`defaults` apply to every scenario that leaves them out; a command-line flag (`--org`, `--user`, ...) does the same.

## Staying ahead of Salesforce releases

Salesforce changes the chat's markup with its releases. `sfdemo` keeps its locators as versioned data with a
self-healing fallback, and its doctor checks an org (a preview sandbox before a release, for example):

```sh
sfdemo doctor --org myPreviewSandbox           # the Lightning panel
sfdemo doctor --site https://.../rides/        # a widget (add --org for its release)
```

Healthy: keep the snapshot as a regression fixture (`sfdemo fixtures add`). Degraded or broken: `sfdemo heal` writes
a bundle a coding agent can fix offline; a merged fix reaches everyone with `sfdemo selectors update`. Why and how:
[docs/RELEASE-PROOF.md](docs/RELEASE-PROOF.md).

## As a library

Everything the CLI does is importable, for scripts, CI, or a future `sf agent record` plugin:

```js
import { loadProject, planRun, executeRun } from 'salesforce-demo-studio';

const project = loadProject();
const { conversations, errors } = planRun({ project, inputs: ['scenarios/'] });
const { results, out } = await executeRun(conversations, { project, emit: e => console.log(e) });
```

Demos too: `readDemo`, `narrate`, `recordDemo` and `assembleDemo` are what `sfdemo demo` chains.

## Privacy and security

- Recordings show org data: they go to `.local/` (gitignored by `sfdemo init`); the run warns when they are not
  ignored.
- The UI listens on 127.0.0.1 only, behind a one-time token; changes need the token in a header, and the Host
  header is checked. Passwords never go through it.
- Frontdoor and Login-As URLs carry sessions: they are never printed or written.
- The voice-over is made on your machine. An `ai:` step sends the page's structure (its accessibility tree, which
  can show record names) to Claude through your own Claude Code, once; the answer is saved next to the script.
- Slide images exported from a company template stay out of public repositories (`examples/*/slides/` is
  gitignored here).
- Doctor snapshots are redacted before they are written (structure and UI labels only), and checked against your
  local denylist of names that must never be published (`.sfdemo/denylist.txt`, one term per line).

## Development

```sh
npm install
npx playwright install chromium
npm run check                      # type check (JSDoc, tsc --checkJs) and tests, fixtures included
node scripts/check-denylist.js --install   # a pre-commit hook against denylisted terms
node scripts/utam-diff.js          # compare the Lightning pack with Salesforce's UTAM page objects
```

Plain JavaScript (ES modules), no build step. The engine is in `src/engine`, the packs logic in `src/selectors`,
the doctor in `src/doctor`, the UI in `src/ui`.

## License

[Apache-2.0](LICENSE)
