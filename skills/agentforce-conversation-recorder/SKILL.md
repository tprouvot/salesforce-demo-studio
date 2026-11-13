---
name: agentforce-conversation-recorder
description: Records scripted Agentforce conversations with the sfdemo CLI (no AI at record time) - screenshots per answer, an MP4 and a GIF with thinking pauses cut, a transcript and an HTML report with checks - on the Lightning Agentforce panel and Embedded Messaging widgets, and keeps the tool working across Salesforce releases (doctor, repair bundles, selector packs). Use when the user wants screenshots, a video, a GIF or a demo recording of an Agentforce conversation (only the chat, or the whole page around it), wants to replay a .md or .csv conversation script, or when sfdemo reports broken or healed locators.
---

# Agentforce conversation recorder

`sfdemo` does the recording deterministically; your job is to prepare scenarios, launch runs, read the results, and
repair selector packs when a Salesforce release changes the chat. A whole narrated demo (slides, a voice-over, live
steps beyond the chat) is the [salesforce-demo-studio](../salesforce-demo-studio/SKILL.md) skill's: a conversation
recorded here can become one of its chapters. Reference: [README](../../README.md), scenario
format in [docs/SCENARIOS.md](../../docs/SCENARIOS.md), maintenance in [docs/RELEASE-PROOF.md](../../docs/RELEASE-PROOF.md).

## Setup

```bash
sfdemo --version                 # missing? from a clone of the repository: npm install && npm link
sfdemo setup                     # Chromium, ffmpeg, sf CLI
sfdemo init --org <alias>        # in the user's project folder, when it has no sfdemo.config.json
```

Install only from the repository (or the npm package its README names once it is published); never guess a
package name.

## Recording

1. **Scenarios**: when the user has none, or only an idea of the conversation, write them with the
   [agentforce-scenario-generate](../agentforce-scenario-generate/SKILL.md) skill: it starts from what the agent
   can do (`sfdemo new --org <alias> --json`) and calibrates the checks. Given a script, put it in `scenarios/*.md`
   (one conversation) or a `.csv` (several), with the surface (Lightning panel, or the URL of the page carrying
   the widget) and who is signed in (the sf alias's user, Login-As of a user, a guest). Add checks instead of
   planning to read every answer: `expect:`, `expect-not:`, `expect-button:`, `max-seconds:`. For one-time codes
   use `type-from: prompt one-time code`: the user types it in `sfdemo ui` or the terminal when asked.
2. **What the recording shows**: by default the answer screenshots and the GIF show only the chat, the MP4 the
   whole page. When the user wants only the Agentforce conversation ("just the chat", a video for a slide), set
   `area: chat` in the scenario's front matter, or run `sfdemo run --area chat`: the screenshots, the MP4 and the
   GIF then all show the Lightning panel or the Messaging widget alone. When the page around the chat matters (the
   record the agent works on), `area: page`. For every scenario of a project, `"defaults": { "area": "chat" }` in
   `sfdemo.config.json`. `sfdemo` never films the desktop: for the whole screen, point the user to their
   system's recorder (macOS: Shift-Command-5).
3. **Dry run**: `sfdemo run --dry-run`. Fix every error it prints, and show the user the plan (it says "the chat
   only" or "the whole page" when `area` is set).
4. **Warn about side effects** before recording: every message spends agent credits and can run real actions.
5. **Record**: `sfdemo run` (in the background for long batches), or point the user to `sfdemo ui`.
6. **Review** `report.md` (flags, warnings, failures) rather than every transcript; open a few PNGs only when a
   flag says a screenshot is blank or misses its question. Report failures with the reason the tool gave; a failed
   conversation keeps `error.png` and its raw video.

Never print passwords, frontdoor URLs or sfdx auth URLs. Prefer Login-As to `credentials:` (development only).

## When the chat markup changed

Signs: a run says "Running on healed locators", or "the message never appeared in the chat", or a doctor check
is degraded or broken.

1. `sfdemo doctor --org <alias>` (Lightning) and/or `sfdemo doctor --site <url> [--org <alias>]` (Messaging).
2. Healed and now confirmed: `sfdemo selectors promote`.
3. Broken: `sfdemo heal` writes a repair bundle. Read its `README.md` and follow it: edit only `pack.json` (new
   candidates first, old ones kept; roles and names, then SLDS classes, then tags; bump `version`), then

   ```bash
   sfdemo selectors check <bundle>/pack.json
   sfdemo fixtures test <bundle>/fixture --pack <bundle>/pack.json
   ```

   Both must pass. In the salesforce-demo-studio repository, copy the pack over `packs/<id>.json`, add
   the fixture under `fixtures/<surface>/<release>/`, run `npm run check`, and propose a pull request. Elsewhere,
   tell the user to open that pull request (or copy the pack to `~/.sfdemo/packs/` to use it at once).
4. A fixture or bundle must never contain customer, program, org or agent names: the denylist
   (`.sfdemo/denylist.txt`) blocks them; add a term there rather than editing it out by hand.
