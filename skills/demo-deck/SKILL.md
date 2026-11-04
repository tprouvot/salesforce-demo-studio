---
name: demo-deck
description: Creates or updates the Google Slides deck of an sfdemo demo through the Google Workspace connector - a new deck from the Salesforce Corporate Template 2026, or the user's own - writes each slide's speaker notes from the demo script (what to say, and the live steps as cues), and exports the slide images the video needs into the demo's slides folder. Use when the user gives a Google Slides link for a demo, wants a deck made for a demo, wants the speaker notes filled from the script, or the video says slide images are missing.
---

# The deck

The demo script is the source: the deck carries its slides and, in the speaker notes, its words. Use the Google
Workspace connector's tools (load them with ToolSearch: `copy_drive_file`, `get_presentation`, `get_page`,
`batch_update_presentation`, `get_page_thumbnail`, `get_drive_file_permissions`). PowerPoint files: not yet; offer
to import the .pptx into Google Slides first. Never share a deck, and change only decks the user named or you made.

## A new deck from the Salesforce template

1. `copy_drive_file` of the **Salesforce Corporate Template 2026** (`1hs9PP-nW57anBFOsQNWlcMRRVdTyiSsjkuPr8R-irF8`),
   named after the demo; check with `get_drive_file_permissions` that only the user has access.
2. Plan one slide per `- slide: N` of the script, from the template's layouts (`get_page` shows their shapes):
   cover with speakers `g3e205dbdc03_2032_1451` (title `_1490`, subtitle `_1491`, speakers `_1492`, `_1493`),
   single column `g3e205dbdc03_2032_1662` (title `_1681`, subtitle `_1682`, body `_1683`, footer `_1684`),
   segue `g3e205dbdc03_2032_1968`, closing thank you `g3e205dbdc03_2032_2396` (text `_2427`). The tpm-slides:generate
   skill maps more layouts (agenda, cards, stats, quotes).
3. One `batch_update_presentation`: a `duplicateObject` per slide with `objectIds` naming the copy and its shapes
   (`{"<layout>": "s1", "<title shape>": "s1_title", ...}`), then per shape `deleteText` (`textRange: {type: ALL}`)
   and `insertText`. Delete a shape you do not use (`deleteObject`). Keep slide text short: the voice says the rest.
4. A second batch: `deleteObject` of every original template slide (their IDs from `get_presentation`), then put
   the copies in order with one `updateSlidesPosition` per slide (`{"slideObjectIds": ["s2"], "insertionIndex": 1}`,
   and so on): several slides in one request must already be in presentation order.

## Speaker notes

- The notes come from the script: `sfdemo notes demos/<name>.md --json` gives `[{ slide, notes }]` (the narration
  of the slide, then the live part as ▶ cues). Slide N is the N-th slide of the deck.
- The notes page of slide `<id>` is `<id>:notes`: `get_page` on it shows its text box (the second shape). For each
  slide, `insertText` into that shape (after a `deleteText` of `ALL` when it already holds text).
- An existing deck: match its slides to the script's `slide:` numbers with the user before writing, and say which
  notes you will replace.

## Slide images for the video

For each slide, `get_page_thumbnail` with `thumbnail_size: LARGE` (1600x900), then download it to the demo's
slides folder as `01.png`, `02.png`... (`slides:` in the front matter, `slides/` next to the script by default):

```bash
curl -sfL "<thumbnail url>" -o demos/slides/01.png
```

Export again after every change to the deck, then `sfdemo demo demos/<name>.md --video-only` rebuilds the video
without recording again. Slide images made from a company template stay out of public repositories.
