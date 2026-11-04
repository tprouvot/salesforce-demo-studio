---
name: demo-script-write
description: Writes or improves an sfdemo demo script (demos/<name>.md) - the chapters, the narration the voice reads, and the live steps in Lightning, Setup, Experience Cloud sites and Agentforce chats - from the user's goal and from what the Salesforce org really has, in the user's language, then checks it with sfdemo narrate. Use when the user wants a demo script, a voice-over text, a talk track or speaker notes written for a Salesforce demo, or wants an existing demo script shortened, translated or fixed.
---

# Writing a demo script

A demo script is the presenter's talk track and the recorder's instructions in one file. Format:
[docs/DEMOS.md](../../docs/DEMOS.md); a full example: [examples/apex-callout-tour/](../../examples/apex-callout-tour/apex-callout-tour.md).
Paragraphs are spoken. `#` headings are chapters. List items are what happens on screen.

## 1. Learn what the org shows

Read before you write, and only read (no data changes):

- Setup pages and records: `sf data query --target-org <alias> --query "SELECT Name FROM ..."`, and for metadata
  `--use-tooling-api`. Use the labels people see in the UI for `click:`, `point:`, `setup:` and `record:`.
- An Agentforce agent: `sfdemo new --org <alias> --json` lists its topics and actions: script questions it can answer.
- People: users for Login-As (`windows:` with `user:`), Experience Cloud members (`site:` plus `user:`), guests.
- When unsure of a label, open the page once with Playwright or `--headed` and read it; do not guess.

## 2. Write it

- **One idea per chapter**, each opening on its slide (`- slide: N`) when there is a deck, then the live part
  (`- window: <name>`, then steps), and back to a slide to conclude when it helps.
- **Narration is spoken**: short sentences, one idea each; say what the viewer sees ("Here is the Named
  Credential"), then why it matters. No bullet lists, no parentheses, no URLs read aloud; numbers as words where
  a voice stumbles. About 140 words a minute: count to fit the length agreed.
- **Order on screen**: a paragraph plays, then the steps below it run. Put the line that introduces a page before
  the step that opens it; put the explanation after it. A paragraph right after a chat message plays while the
  agent answers (its checks wait for the answer).
- **Live steps**, the fewest that show the point: `setup:` (Quick Find), `open:` (a path), `record:` (an object and
  a name), `click:`, `point:` (show without clicking), `scroll:`, `fill:`, `select:`, `wait for:`, chat messages
  (`1. ...`) with `- expect:` checks, an ```` ```apex ```` block, and `ai:` for a step that is easier said than
  pinned down (resolved once by Claude, saved next to the demo).
- **Safe by default**: show, do not change. No Save, Delete, Deploy, Send or Activate unless the user asked for
  that action in the demo, and then in an org they named for it.
- **Their language**: write the narration in the voice's language, with `filler:` and `retry:` lines in it too
  (what the voice says while an answer is slow, and before a chapter is tried again).

## 3. Check it

```bash
sfdemo narrate demos/<name>.md     # errors with their line, then each chapter's length
sfdemo notes demos/<name>.md       # what goes in each slide's speaker notes
```

Fix every error. Read the plan to the user: chapters, length, who appears live. Then the
[demo-voice](../demo-voice/SKILL.md) and [demo-deck](../demo-deck/SKILL.md) skills, and the recording
([salesforce-demo-studio](../salesforce-demo-studio/SKILL.md)).
