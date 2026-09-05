# ReadAny Shlai Justified Text Design

## Goal

Make ordinary EPUB prose consistently justified in ReadAny Shlai while preserving intentional book formatting and giving readers a simple way to return to the EPUB's original alignment.

## Reader Setting

Reader Settings adds a **Justify body text** switch backed by `justifyBodyText`. It is enabled by default for new and existing Shlai users. When disabled, the reader removes its justification override and respects the EPUB's original alignment.

The setting is persisted with the existing reading settings and sent through the existing React Native-to-reader bridge. Existing persisted settings that do not contain the new field migrate to the enabled default.

## Rendering Behavior

The override applies only to reflowable, horizontal EPUB body paragraphs. It must not alter:

- centered or right-aligned paragraphs, including title and dedication pages;
- headings;
- paragraphs containing explicit line breaks, which commonly represent poetry or verse;
- preformatted text, code, tables, captions, or form controls;
- vertical-writing documents;
- fixed-layout content, PDFs, or comics; or
- non-reader application screens.

Eligible paragraphs receive `text-align: justify` and `text-justify: inter-word`. The reader determines eligibility before applying its override so its own rule does not hide the EPUB's original computed alignment. The behavior is reapplied whenever a new EPUB document is loaded and whenever the setting changes.

Disabling the switch removes the reader-owned markers and styles without mutating the EPUB source.

## Compatibility

The feature belongs to the general reader settings model rather than Shlai branding, so the implementation remains suitable for a focused upstream contribution. The new persisted field is optional at the type boundary so old settings deserialize safely, but runtime defaults normalize it to enabled.

## Verification

Automated regression coverage must prove that:

- missing persisted state defaults to justification enabled;
- the bridge sends the setting to the reader;
- ordinary left-aligned body paragraphs become justified;
- centered and right-aligned paragraphs remain unchanged;
- headings, line-break poetry, vertical text, and fixed-layout/PDF content are excluded;
- switching the setting off restores book alignment; and
- the generated mobile reader asset contains the same behavior as its source template.

Manual Android proof uses a deliberately left-aligned reflowable book. The acceptance screenshot must show a normal prose paragraph justified on both edges, then show the original left alignment after the switch is disabled.

## Scope

This change does not add desktop UI, change EPUB files, alter AI output, justify arbitrary application text, or publish a stable Shlai release. It produces a new pull-request preview APK for Celia and Decidetto to test before any merge or release decision.
