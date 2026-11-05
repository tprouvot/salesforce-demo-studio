---
type: demo
title: sfdemo, a guided tour
voice: en_US-amy-medium
pace: presenter
windows:
  Repo: { vscode: ../.., files: [docs/tour/sfdemo-tour.md], label: "VS Code · salesforce-demo-studio" }
  Shell: { terminal: /tmp/my-demos, label: "Terminal" }
  Code: { vscode: /tmp/my-demos, label: "VS Code · my-demos" }
  UI: { url: "http://127.0.0.1:4477/", from: Shell, label: "sfdemo ui" }
say: { sfdemo: S F demo, init: in it, ui: U I }
---

<!--
  A tour of sfdemo, recorded by sfdemo: a terminal, VS Code and the web UI, no slides. Record it from the
  repository (the first and last chapters open it in VS Code), on macOS or Linux:
    sfdemo demo docs/tour/sfdemo-tour.md
  The project it builds lives in /tmp/my-demos; my-demos.sh gives each chapter its starting point.
-->

# One text file, one video

- window: Repo

Welcome to sfdemo, the Salesforce demo studio. This video was recorded by sfdemo itself, from the text file you see here.

At the top, the settings: the voice that reads it, and the windows it films. Here, a terminal, VS Code, and the web interface.

- scroll: down

Below, the demo itself. A heading starts a chapter. A paragraph is what I say. And a line that starts with a dash is what happens on screen: open a file, run a command, click a button.

- scroll: down

Let's make one, from the start.

# Set up once

- prepare: sh my-demos.sh empty
- window: Shell

You need Node, git, and the Salesforce CLI, logged in to your org. Then one command checks the rest, and installs what is missing: the browser it drives, the video tools, and the voice.

- run: sfdemo setup --check

Everything is in place. The voice runs on this machine, in fifty-eight languages. Nothing is sent anywhere, and nothing costs anything.

# A project, and a voice

- prepare: sh my-demos.sh empty
- window: Shell

A project is a folder. sfdemo init writes its settings, with the org it records in.

- run: sfdemo init --org myOrg --example none
- run: ls

Then, choose a voice.

- run: sfdemo voices --language en

Here are the English ones. With try, you hear one before you pick it. When it reads a word badly, one line of the script tells it how to say it.

# Write the script

- prepare: sh my-demos.sh project
- window: Code

Now the script, in any editor. Here, VS Code, on the project.

- open: demos/hello.md

First, the voice, and the windows to film. This demo films one: a terminal.

```markdown
---
title: Hello
voice: en_US-amy-medium
windows:
  Shell: { terminal: .., label: Terminal }
---

```

Then a chapter: what happens on screen, and what to say about it.

```markdown
# Hello

- window: Shell

This is a terminal, filmed by sfdemo.

- run: sf --version

The command ran for real, on this machine.
```

- command: File: Save

That is the whole script. The same way, sfdemo films Lightning pages, Setup, Experience Cloud sites and Agentforce chats, and the work around them: a terminal, VS Code, or Cursor.

# Hear it, then record it

- prepare: sh my-demos.sh hello
- window: Shell

Before recording, sfdemo narrate reads every line once, and gives the length of each chapter.

- run: sfdemo narrate demos/hello.md

Then, sfdemo demo records it.

- start: sfdemo demo demos/hello.md

It reads the voice-over, opens each window off camera, and films every live part in real time. When a step fails, a button not found, an answer that does not come, it records that chapter again, up to three times.

- wait for: Video:

Here it is: one video, with chapters and subtitles.

# The web interface

- prepare: sh my-demos.sh recorded
- window: Shell

Prefer clicking? sfdemo ui opens the same studio in your browser.

- start: sfdemo ui --no-open
- wait for: token=
- window: UI

Your demos are on the left.

- click: Hello

Here is the video, ready to watch, or to record again.

- point: Record again

Below it, the voice: the language, the voice, and the pace.

- scroll: Use this voice
- point: Use this voice

And each chapter can be recorded again, on its own.

- scroll: Record this chapter again
- point: Record this chapter again
- window: Shell
- press: Control+C

Control C, and the studio closes.

# Or ask Claude

- window: Repo
- open: skills/salesforce-demo-studio/SKILL.md

You can also ask Claude. The skills in this repository write the script from your goal, and from what your org really has. They pick the voice, make the Google Slides deck, record the demo, and show you the video.

- open: README.md

Install it from GitHub, run sfdemo setup, and make your first demo. Thank you for watching.
