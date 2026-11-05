---
name: demo-voice
description: Chooses and tunes the narrator of an sfdemo demo - the language, a Piper voice from its catalogue (58 languages, local, free), the pace and pauses, and how the voice must say product names, acronyms and code - with samples the user can hear. Use when the user wants another voice, a voice in their language, a slower or faster voice-over, or says the voice reads a word badly.
---

# The narrator

`sfdemo` reads the narration with [Piper](https://github.com/OHF-Voice/piper1-gpl), on the user's machine:
nothing is sent anywhere. One voice per demo: the project's (`voice` in sfdemo.config.json, asked by `sfdemo init`),
or the one the demo's front matter names. Setup: `sfdemo setup --voice` installs Piper and the project's voice.

## Pick a voice

```bash
sfdemo voices --language fr                 # the French voices: key, country, quality, size (✓ = installed)
sfdemo voices --try fr_FR-siwis-medium --text "Bonjour, voici la démonstration." --play
```

- Offer two or three voices of their language and let them listen; `--try` downloads the voice (30 to 120 MB)
  the first time. `high` and `medium` qualities sound best; `low` is smaller.
- `sfdemo voices --json` also gives each voice's sample on Hugging Face, for a quick listen in a browser.
- Then set it: `voice: fr_FR-siwis-medium` in the demo's front matter, or for every demo of the project: `voice` in
  `sfdemo.config.json` (`sfdemo ui`: Use for all new demos).
- Voices sound more natural at `pace: normal`; `presenter` (the default) is slower, for a dense demo. When the user
  finds a voice robotic, try `normal` first, then another voice: `medium` voices often sound as good as `high` ones.

## Tune it

```yaml
voice: en_US-amy-medium
pace: presenter      # slow, presenter (the default), normal, brisk, or a number (1 = the voice's own speed)
pause: 0.7           # seconds of silence between two paragraphs
say:                 # how to read a word: whole words, case-sensitive
  SOQL: sockle
  x-api-key: x A P I key
filler: Un instant, l'agent prépare sa réponse.    # said while an answer is slow (default in English)
retry: Je relance cette partie.                     # said before a chapter is tried again
```

English voices already read the usual acronyms right (API, AI, URL, SOQL, Agentforce, GitHub...). When the user
says a word sounds wrong, add it to `say:` and run `sfdemo narrate`: only the lines holding that word are read
again. Keep the narration text itself readable: `say:` changes only what the voice hears.
