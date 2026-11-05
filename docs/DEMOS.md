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
| `wait for: Saved` | waits until the text shows |
| `wait: 2` | holds two seconds |
| `1. How much is a ride?` | types a message into the window's chat and waits for the answer |
| `   - expect: \$8` | checks the answer (also `expect-not:`, `expect-button:`, `max-seconds:`); a failed check retries the chapter |
| ```` ```apex ```` block | runs the Apex in the Developer Console (Execute Anonymous), then shows its debug lines |
| `ai: open the newest case of Acme` | Claude turns the sentence into the steps above, once; see below |

A paragraph right after a chat message plays while the agent answers: the checks under the message wait for the
answer, the voice does not. When an answer takes more than 20 seconds, the voice says the `filler` line.

### `ai:` steps

For a step that is easier to say than to pin down, write `ai:` and the sentence. The first take asks Claude, through
Claude Code on your machine (`claude -p`, your own login), to turn it into fixed steps from what the page shows.
The answer is saved next to the script, in `<name>.ai-steps.json`: every later take replays it with no call, so the
demo stays repeatable. Commit that file with the script; edit it, or replace the `ai:` line with fixed steps, when
Claude got it wrong.

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
