# Demo scripts

A demo script is one Markdown file (`demos/<name>.md`) that holds a whole narrated demo: what the voice says, on
which slide, and what happens live. `sfdemo demo demos/<name>.md` turns it into one video with chapters and
subtitles. A complete example: [examples/apex-callout-tour/](../examples/apex-callout-tour/apex-callout-tour.md).

```markdown
---
type: demo
title: Apex HTTP callouts, a guided tour
org: myOrg
voice: en_US-amy-medium
windows:
  Admin: { path: /lightning/setup/SetupOneHome/home, label: "Admin · Setup" }
---

# The Named Credential points to the API

- slide: 4

Next, the Named Credential. It holds the base URL of the API.

- window: Admin
- setup: Named Credentials
- click: Demo ERP API

Here it is.
```

Three kinds of lines:

- **A paragraph is spoken.** Consecutive lines make one paragraph; a blank line starts the next.
- **A heading (`#`) starts a chapter**: a chapter mark in the video, and the unit that is recorded again when
  something fails.
- **A list item (`-`, `1.`), or a line starting with a step word and a colon, is a live step.**

A code block (```` ``` ````) belongs to the window above it: Apex runs in the Developer Console of a Salesforce
window, shell lines run one after the other in a terminal window, and any code is typed into the open file of a
VS Code or Cursor window.

HTML comments (`<!-- -->`) and lines starting with `>` are notes for you: never spoken, never played.

## Settings (front matter)

| Setting | What it does | Default |
| --- | --- | --- |
| `title` | the demo's name, and the first chapter's when the file starts without a heading | the file name |
| `org` | the sf alias every window signs in to, unless a window names its own (`--org` replaces it) | |
| `voice` | a Piper voice: `sfdemo voices --language en` lists them | the project's (`voice` in sfdemo.config.json: `sfdemo init` asks), else `en_US-amy-medium` |
| `pace` | `slow`, `presenter`, `normal`, `brisk`, or a number (1 = the voice's own speed) | the project's, else `presenter` |
| `pause` | seconds of silence between two paragraphs | `0.7` |
| `say` | how the voice reads a word: `{ SOQL: sockle }` (whole words, case-sensitive) | English acronyms |
| `slides` | the folder of slide images: `01.png`, `02.png`... (also `Slide1.png`, `slide-01.png`) | `slides` |
| `deck` | the Google Slides deck, for the record (the demo-deck skill uses it) | |
| `windows` | the people or screens shown live, each signed in off camera (below) | |
| `takes` | how many times a live chapter is tried when a step fails | `3` |
| `reply timeout` | seconds to wait for an Agentforce answer | `90` |
| `size` | the video's size | `1920x1080` |
| `filler`, `retry` | what the voice says while an answer is slow, and before a chapter is tried again | English lines |
| `type: demo` | marks the file as a demo (also when it has `voice`, `windows`, `slides`, `deck` or `pace`) | |

### Windows

Each window is a browser window, signed in before the camera rolls. It takes the demo's `org` unless it names its
own, and shows `label` in a corner of the video (the window's name by default).

| Window | Settings | Signed in as |
| --- | --- | --- |
| Lightning, as the CLI user | `{ org: myOrg, path: /lightning/setup/SetupOneHome/home }` (or `app: Sales`) | the sf alias's user |
| Lightning, as someone else | `{ user: jordan.lee }` | Login-As by the alias's admin |
| An Experience Cloud site | `{ site: https://example.my.site.com/s/ }` | a guest |
| The site, signed in | `{ site: ..., user: rider.lane }` | Login-As to the site (an Experience Cloud user) |
| Any web page | `{ url: https://github.com/... }` | nobody |
| A page whose link a terminal printed | `{ url: http://127.0.0.1:4477/, from: Shell }` | what the link carries (a token) |
| A terminal | `{ terminal: ~/my-project }` | you, on this machine |
| VS Code | `{ vscode: ., files: [README.md] }` | nobody: a profile of its own, signed in to nothing |
| Cursor | `{ cursor: ., files: [src/app.ts] }` | the Cursor login you make once (`sfdemo editor cursor`) |

A window that receives a chat message (`1. ...`) opens its chat off camera: the Agentforce panel in Lightning, the
Embedded Messaging widget on a site (with a first "Hi" to open the conversation; `warmup: false` to skip it).
Development orgs can use `credentials:` (a file of usernames and passwords), as conversation scenarios do.

## Live steps

| Step | Does |
| --- | --- |
| `slide: 3` | shows slide 3 of the deck |
| `window: Admin` | brings the Admin window to the screen; the steps below happen in it |
| `setup: Named Credentials` | opens Setup, types the page's name in Quick Find, opens it |
| `open: /lightning/o/Case/list` | opens a path of the org (or a full URL; or clicks a tab with that label) |
| `record: Account Acme` | opens the newest Account named Acme (found with SOQL) |
| `click: Save` | clicks what is labeled Save (a button, link, tab, menu item); an exact label wins over a partial one |
| `point: Allow Formulas in HTTP Header` | moves the cursor to it and rings it, without clicking |
| `scroll: down` | scrolls (`up`, `top`, `bottom`, or a text to bring into view) |
| `fill: Subject = Leaking faucet` | types into the field labeled Subject, one key at a time |
| `select: Status = Active` | picks an option (a list or a Lightning combobox) |
| `press: Enter` | presses a key |
| `wait for: Saved` | waits until the text shows (in a terminal: until a command prints it) |
| `wait: 2` | holds two seconds |
| `type: Acme` | types into what has the focus; in a terminal, into the command that runs (it asked a question) |
| `run: npm test` | terminal and editor windows: types the command, runs it, waits for its end; an error ends the take |
| `start: sfdemo ui` | the same without waiting (a server): the next steps happen while it runs; `press: Control+C` stops it |
| `open: src/app.js:12` | VS Code and Cursor: opens the file through Quick Open (`:12` goes to line 12) |
| `command: File: Save` | VS Code and Cursor: runs a command of the Command Palette, by its name there |
| `prepare: cp -R template/ work/` | runs a command off camera before the chapter is filmed, each take (below) |
| `1. How much is a ride?` | types a message into the window's chat and waits for the answer |
| `   - expect: \$8` | checks the answer (also `expect-not:`, `expect-button:`, `max-seconds:`); a failed check retries the chapter |
| ```` ```apex ```` block | runs the Apex in the Developer Console (Execute Anonymous), then shows its debug lines |
| ```` ```sh ```` block, in a terminal | runs each line, as `run:` does (lines starting with `#` are not run) |
| a code block, in an editor | types it into the open file where the cursor is, line by line (each line ends with Enter), indented as written |
| `ai: open the newest case of Acme` | Claude turns the sentence into the steps above, once; see below |

A paragraph right after a chat message plays while the agent answers: the checks under the message wait for the
answer, the voice does not. When an answer takes more than 20 seconds, the voice says the `filler` line.

### `ai:` steps

For a step that is easier to say than to pin down, write `ai:` and the sentence. The first take asks Claude, through
Claude Code on your machine (`claude -p`, your own login), to turn it into fixed steps from what the page shows.
The answer is saved next to the script, in `<name>.ai-steps.json`: every later take replays it with no call, so the
demo stays repeatable. Commit that file with the script; edit it, or replace the `ai:` line with fixed steps, when
Claude got it wrong.

## Terminal, VS Code and Cursor windows

A demo can show the work around Salesforce too: a command line, a project in VS Code or Cursor. These windows run
on your machine, for real, in the folder they name (relative to the script: `.` is the script's folder; `~` is your
home folder).

````markdown
---
type: demo
title: Deploy from VS Code
windows:
  Shell: { terminal: ~/projects/acme, label: "Terminal" }
  Code: { vscode: ~/projects/acme, files: [force-app/main/default/classes/Invoice.cls] }
  Admin: { org: myOrg, path: /lightning/setup/ApexClasses/home }
---

# The class, in VS Code

- prepare: cd ~/projects/acme && git checkout -- .
- window: Code

Here is the class. We add one line to it.

- open: force-app/main/default/classes/Invoice.cls:12
```apex
    public Decimal total { get; set; }
```
- command: File: Save

# Deployed from the terminal

- window: Shell
- run: sf project deploy start --source-dir force-app --target-org myOrg
- wait for: Deploy Succeeded
````

A whole demo made of them: [the tour of sfdemo](tour/sfdemo-tour.md).

**A terminal window** is drawn by sfdemo and filmed like the other windows. Each command is typed at the prompt one
key at a time, then runs in a real terminal (colours, spinners and progress bars show as they do for you; on
Windows, without them). `cd <folder>` and `clear` work as in a shell; each other command runs on its own, so a
variable set by one is not seen by the next. `sfdemo` in it is the sfdemo that records. A terminal runs one
command at a time: stop a server with `press: Control+C` before the next `run:`, or give it a second terminal
window. Settings: `label`, `title` (its title bar), `prompt` (what the prompt shows: the folder's name by default),
`theme` (`dark` or `light`).

**A VS Code or Cursor window** is the real application, started for the recording with a profile of its own
(`~/.sfdemo/editors/vscode`, `~/.sfdemo/editors/cursor`), never yours: your extensions, notifications and recent
files do not show, and your own editor can stay open. Its window opens on your screen while it is filmed: leave it
alone until the chapter ends. `open:` uses Quick Open, `command:` the Command Palette (by the name it shows
there), a code block is typed into the open file (the profile adds no brackets, indentation or suggestions of its
own), and `run:` types the command in the integrated terminal. `click:`, `point:`, `wait for:`, `press:` and
`scroll:` work there as on any page. Settings:

| Setting | What it does |
| --- | --- |
| `vscode:` / `cursor:` | the folder to open |
| `files` | files open when the chapter starts |
| `extensions` | Marketplace ids (`salesforce.salesforcedx-vscode`): installed in the demo profile the first time, the only ones on; none by default |
| `settings` | VS Code settings for this window: `{ "editor.fontSize": 18 }` |
| `theme`, `zoom` | the colour theme (`Default Light Modern`), the zoom level: `1` (120 %, easier to read in a video) by default, `0` for 100 % |

sfdemo never signs in to anything in these editors. In VS Code, the profile turns its AI features off, so no
GitHub or Copilot sign-in comes up. Cursor does not open without its own login: once, run `sfdemo editor cursor`,
log in in the window it opens, and close it; demos then use that login. `sfdemo editor vscode` opens VS Code's demo
profile the same way, to look at it or try an extension. Use `command:` for shortcuts when you can: `press:`
sends keys as on a US keyboard.

**`prepare:` gives each take the same start.** A chapter that changes files (a `sfdemo init`, a typed and saved
file, a deploy) leaves them changed for its next take. `prepare:` lines run, off camera, before each take of their
chapter, in the script's folder: copy a template, reset a folder, check out a branch. A `prepare:` that fails ends
the take before anything is filmed.

**What runs is what the script says**, on your machine, with your files and your logins (the sf CLI's, git's):
script only what you want to happen. Each chapter is recorded on its own (and again when it fails), so each one
names its window before its first live step.

## Speaker notes

`sfdemo notes demos/<name>.md` prints what each slide's speaker notes should hold: the narration said on the
slide, then the live part that follows it, as cues (`▶ Setup › Named Credentials`) with what to say there. The
demo-deck skill writes them into the Google Slides deck, so the same script serves a recorded video and a live
presentation.

## Recording

```bash
sfdemo narrate demos/<name>.md                 # read every line once; the length of each chapter
sfdemo demo demos/<name>.md --org <alias>      # record and assemble: <recordings>/<name>/<name>.mp4 and .srt
sfdemo demo demos/<name>.md --only 3 --retake  # chapter 3 again
sfdemo demo demos/<name>.md --video-only       # the video again (new slide images), without recording
```

Live chapters are recorded in real time (1440x810 pages, scaled to the video's size); chapters of slides and
narration need no browser. Takes are kept in `<recordings>/<name>/takes/`: a chapter uses its last complete take,
so trying again never loses a good one. `assembly.json` says which take each chapter used.
