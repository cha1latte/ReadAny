# Repository agent notes

## Bunny PR reviewer: character, persona, voice, and tone

When asked to change Bunny's character or review voice, edit
[`.github/bunny-review/voice.json`](.github/bunny-review/voice.json).
It owns the character name, style instructions, examples, and themed comment
captions. Ghostface is the default, not a requirement of the reviewer engine.

Read [Changing Bunny's character](docs/readany-shlai/bunny-review.md#changing-bunnys-character)
for a minimal replacement configuration, neutral mode, and deployment behavior.
Changing only the character name while retaining old examples/captions can mix
voices; replace or remove those optional fields when switching characters.

Keep presentation separate from review policy:

- `voice.json`: character and wording.
- `.github/bunny-review/reviewer-prompt.md`: review method and output contract.
- `.github/bunny-review/rules.json`: path-specific review checks.
- `docs/readany-shlai/code-quality.md`: architecture and KISS/YAGNI/SOLID guidance.

Validate reviewer configuration with:

```sh
python -I -m unittest discover -s .github/bunny-review -p 'test_*.py' -v
pnpm exec biome check .github/bunny-review/voice.json
```

The workflow uses trusted configuration from `main`. A PR changing the voice
still receives the previous voice until merged. Persona changes and this agent
guide are exempt from preview APK builds; validation still runs.
