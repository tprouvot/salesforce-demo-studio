---
name: salesforce-demo-studio
description: Makes a whole narrated Salesforce demo video with the sfdemo CLI - slides from a Google Slides deck, a voice-over read by a local Piper voice in the user's language, and live steps recorded in Lightning, Setup, Experience Cloud sites, Agentforce chats, plain web pages, a terminal, VS Code or Cursor - assembled into one MP4 with chapters and subtitles. Use when the user wants to record a demo, a walkthrough, a product tour or a video with voice-over of Salesforce (not only an Agentforce chat), turn a deck and a script into a video, or redo a chapter of a recorded demo.
---

# Salesforce demo studio

The people asking are often not technical: speak in their words (chapter, slide, voice, take), do the files and
the commands yourself, and show them the result (the video, the plan, the speaker notes) rather than the YAML.
`sfdemo` records deterministically, with no AI at record time except the `ai:` steps it resolves once.
Format reference: [docs/DEMOS.md](../../docs/DEMOS.md). A complete example:
[examples/apex-callout-tour/](../../examples/apex-callout-tour/apex-callout-tour.md).

## 1. Settle the demo, one question at a time

Ask only what the user has not said, with your suggestion:

- **Goal and audience**: what should the viewer understand or believe at the end? (Suggest one sentence.)
- **Length**: 3 to 5 minutes for a feature, 10 to 20 for a solution walkthrough. About 140 spoken words a minute.
- **Language** of the voice-over (Piper speaks 58), and whether a deck exists (Google Slides link) or should be made.
- **Org and people**: the sf alias (`sfdemo orgs`), and who appears live: the alias's own user, users opened with
  Login-As (internal or Experience Cloud), guests on a site. Never a customer's production org without them saying so.
- **Around the org**: a terminal, VS Code or Cursor on a project folder, when the demo shows how it is built or
  deployed. Editors run with a demo profile signed in to nothing; Cursor needs the user's own login once
  (`sfdemo editor cursor`, done by them: never log in for them, never copy their tokens).

## 2. Build it, with the other skills

1. **Script**: [demo-script-write](../demo-script-write/SKILL.md) writes `demos/<name>.md` (chapters, what the
   voice says, the live steps) from the goal and from what the org really has.
2. **Voice**: [demo-voice](../demo-voice/SKILL.md) picks the voice and the pace, and fixes words it reads badly.
3. **Deck**: [demo-deck](../demo-deck/SKILL.md) creates or updates the Google Slides deck: one slide per point,
   the narration in the speaker notes, and the slide images in the demo's `slides/` folder. No deck: the demo is
   live only (leave out `slide:` steps).

## 3. Check, record, review

```bash
sfdemo setup --voice                         # once: Chromium, ffmpeg, the sf CLI, Piper and a voice
sfdemo narrate demos/<name>.md               # every line read: the length of each chapter, missing slide images
sfdemo demo demos/<name>.md --org <alias>    # voice-over, live recording, the video
```

- Before recording, say what it does in the org: it signs in, clicks and runs what the script says (Apex, chat
  messages that spend agent credits and can create records). Never script a Save, a Delete or a deploy the user
  did not ask for. Terminal and editor windows run their commands on the user's machine, with their logins: the
  same care. Editor windows open on their screen while filmed: tell them to leave them alone.
- A live chapter is recorded in real time and tried up to `takes:` times (3) when a step fails; the take that
  completed is kept. Slides-only chapters need no browser.
- The video is `<recordings>/<name>/<name>.mp4`, with `<name>.srt` and `assembly.json` (which take each chapter
  used). Look at a few frames before showing it: `ffmpeg -ss <seconds> -i <mp4> -frames:v 1 frame.png`.
- To redo one chapter: `sfdemo demo demos/<name>.md --only 3 --retake`. Only the video again (after editing
  slides): `--video-only`. A line of narration changed: run it again; only that line is re-read.

## When something fails

| Says | Do |
| --- | --- |
| `no button or link "X" visible in <window>` | the label differs on the page: open it (`--headed`), use the label people see, or `point:`/`scroll:` first |
| `no Setup page "X" in Quick Find` | the page's name in Setup's Quick Find, exactly (`Named Credentials`, not `Named credential`) |
| `no answer` / `the reply does not match` | the agent: rerun the chapter; if it repeats, adjust the message or the check |
| `ai: ... came back without any step` | write the step as fixed steps, or reword it; the answer is saved in `<name>.ai-steps.json` (edit it to fix it) |
| `Piper ... not installed` | `sfdemo setup --voice` |
| `no image for slide(s)` | export the deck's slides ([demo-deck](../demo-deck/SKILL.md)) |
| `"<command>" ended with exit code N: ...` | the command failed in the terminal: run it yourself in that folder, fix the cause or the script; add a `prepare:` when a previous take left files behind |
| `"<command>" still runs in <window>` | a started server holds that terminal: `press: Control+C` first, or a second terminal window |
| `Cursor shows its login screen` | ask the user to run `sfdemo editor cursor` and log in there, once |
| `no command "X" in <window>'s Command Palette` | its name differs: open the palette in that editor and copy the name it shows |

Never print passwords, frontdoor URLs, sfdx auth URLs or one-time codes. Conversations alone (an Agentforce chat
without slides or voice) stay with [agentforce-conversation-recorder](../agentforce-conversation-recorder/SKILL.md).
