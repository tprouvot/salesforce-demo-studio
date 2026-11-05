# sfdemo, a guided tour

A five-minute video that shows how to use sfdemo, recorded by sfdemo itself: no slides, only live windows. A
terminal runs the commands, VS Code shows the script being written, and the web UI shows the result.

| File | What it is |
| --- | --- |
| [sfdemo-tour.md](sfdemo-tour.md) | the tour: seven chapters, the narration, the live steps |
| [hello.md](hello.md) | the small demo the tour writes, records and watches |
| [my-demos.sh](my-demos.sh) | the starting point of each chapter in `/tmp/my-demos`, run by its `prepare:` lines |

Record it from the root of the repository, on macOS or Linux, with VS Code installed:

```sh
sfdemo demo docs/tour/sfdemo-tour.md
```

The VS Code windows open on your screen while they are filmed: leave them alone until their chapter ends. They
run with sfdemo's own VS Code profile, signed in to nothing. The tour makes and deletes `/tmp/my-demos`, and
starts `sfdemo ui` on port 4477 for a moment: keep that port free.

What it shows, chapter by chapter:

1. The script of the tour itself, in VS Code: settings, chapters, narration, live steps.
2. `sfdemo setup --check`: what sfdemo needs, checked.
3. `sfdemo init` and `sfdemo voices`: a project, and a voice to pick.
4. A demo script typed in VS Code: `hello.md`.
5. `sfdemo narrate`, then `sfdemo demo`: the voice-over, then the recording and the video.
6. `sfdemo ui`: the same demo in the web interface, its link opened from the terminal.
7. The skills: Claude writes and records a demo for you.
