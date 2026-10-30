# Anchoring trial results

Generated 2026-10-29.

Each row counts one annotation on one variant. "Recall" is anchored plus approximate over all annotations whose text exists in the variant. "Must-not-match held" is the share of `mustNotMatch` annotations correctly reported as orphans. Verdicts are defined in `trial/src/classify.ts`.

## Candidates

- **recogito-default**: Recogito Text Annotator 4.3.7 with its bundled W3C adapter: revives by TextPosition offsets only.
- **recogito-quote**: Recogito Text Annotator 4.3.7 with our W3C adapter (keeps prefix and suffix) and a selectorReviveFn: position hit accepted only if its text equals the quote, else fuzzy quote matching with no score threshold (Hypothesis policy).
- **recogito-quote-strict**: Recogito Text Annotator 4.3.7 with our W3C adapter (keeps prefix and suffix) and a selectorReviveFn: position hit accepted only if its text equals the quote, else fuzzy quote matching rejecting matches scoring below 0.8.
- **hypothesis**: Hypothesis client anchoring (vendored): RangeSelector, then TextPosition, each checked against the quote, then fuzzy quote matching.

## All cases

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 108 | 16 | 6 | 77 | 60% | 2 | 18 | 10% |
| recogito-quote | 198 | 7 | 2 | 0 | 99% | 10 | 10 | 50% |
| recogito-quote-strict | 194 | 2 | 11 | 0 | 95% | 20 | 0 | 100% |
| hypothesis | 200 | 7 | 0 | 0 | 100% | 10 | 10 | 50% |

## Edited variants only

The original variant should anchor for every candidate; this table leaves it out.

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 17 | 16 | 5 | 70 | 31% | 2 | 17 | 11% |
| recogito-quote | 100 | 7 | 1 | 0 | 99% | 9 | 10 | 47% |
| recogito-quote-strict | 96 | 2 | 10 | 0 | 91% | 19 | 0 | 100% |
| hypothesis | 101 | 7 | 0 | 0 | 100% | 9 | 10 | 47% |

## By tag (edited variants)

### br

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 0 | 4 | 0 | 4 | 50% | 0 | 0 | – |
| recogito-quote | 7 | 0 | 1 | 0 | 88% | 0 | 0 | – |
| recogito-quote-strict | 6 | 0 | 2 | 0 | 75% | 0 | 0 | – |
| hypothesis | 8 | 0 | 0 | 0 | 100% | 0 | 0 | – |

### emoji

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 0 | 0 | 3 | 10 | 0% | 1 | 2 | 33% |
| recogito-quote | 12 | 1 | 0 | 0 | 100% | 1 | 2 | 33% |
| recogito-quote-strict | 11 | 1 | 1 | 0 | 92% | 3 | 0 | 100% |
| hypothesis | 12 | 1 | 0 | 0 | 100% | 1 | 2 | 33% |

### excluded

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 0 | 4 | 0 | 4 | 50% | 0 | 0 | – |
| recogito-quote | 7 | 0 | 1 | 0 | 88% | 0 | 0 | – |
| recogito-quote-strict | 6 | 0 | 2 | 0 | 75% | 0 | 0 | – |
| hypothesis | 8 | 0 | 0 | 0 | 100% | 0 | 0 | – |

### framework

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 16 | 0 | 0 | 10 | 62% | 0 | 2 | 0% |
| recogito-quote | 24 | 2 | 0 | 0 | 100% | 2 | 0 | 100% |
| recogito-quote-strict | 24 | 0 | 2 | 0 | 92% | 2 | 0 | 100% |
| hypothesis | 24 | 2 | 0 | 0 | 100% | 2 | 0 | 100% |

### hidden

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 0 | 4 | 0 | 4 | 50% | 0 | 0 | – |
| recogito-quote | 7 | 0 | 1 | 0 | 88% | 0 | 0 | – |
| recogito-quote-strict | 6 | 0 | 2 | 0 | 75% | 0 | 0 | – |
| hypothesis | 8 | 0 | 0 | 0 | 100% | 0 | 0 | – |

### long

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 0 | 2 | 0 | 7 | 22% | 0 | 2 | 0% |
| recogito-quote | 9 | 0 | 0 | 0 | 100% | 0 | 2 | 0% |
| recogito-quote-strict | 9 | 0 | 0 | 0 | 100% | 2 | 0 | 100% |
| hypothesis | 9 | 0 | 0 | 0 | 100% | 0 | 2 | 0% |

### mustNotMatch

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 0 | 11 | 5 | 40 | 20% | 2 | 13 | 13% |
| recogito-quote | 52 | 4 | 0 | 0 | 100% | 6 | 9 | 40% |
| recogito-quote-strict | 49 | 1 | 6 | 0 | 89% | 15 | 0 | 100% |
| hypothesis | 52 | 4 | 0 | 0 | 100% | 6 | 9 | 40% |

### non-latin

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 0 | 2 | 3 | 12 | 12% | 1 | 3 | 25% |
| recogito-quote | 16 | 1 | 0 | 0 | 100% | 1 | 3 | 25% |
| recogito-quote-strict | 15 | 1 | 1 | 0 | 94% | 4 | 0 | 100% |
| hypothesis | 16 | 1 | 0 | 0 | 100% | 1 | 3 | 25% |

### overlap

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 0 | 0 | 1 | 7 | 0% | 1 | 2 | 33% |
| recogito-quote | 8 | 0 | 0 | 0 | 100% | 2 | 1 | 67% |
| recogito-quote-strict | 8 | 0 | 0 | 0 | 100% | 3 | 0 | 100% |
| hypothesis | 8 | 0 | 0 | 0 | 100% | 2 | 1 | 67% |

### pdf

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 1 | 1 | 0 | 4 | 33% | 0 | 1 | 0% |
| recogito-quote | 6 | 0 | 0 | 0 | 100% | 1 | 0 | 100% |
| recogito-quote-strict | 6 | 0 | 0 | 0 | 100% | 1 | 0 | 100% |
| hypothesis | 6 | 0 | 0 | 0 | 100% | 1 | 0 | 100% |

### real

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 0 | 11 | 3 | 32 | 24% | 1 | 6 | 14% |
| recogito-quote | 42 | 4 | 0 | 0 | 100% | 3 | 4 | 43% |
| recogito-quote-strict | 39 | 1 | 6 | 0 | 87% | 7 | 0 | 100% |
| hypothesis | 42 | 4 | 0 | 0 | 100% | 3 | 4 | 43% |

### scroll

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 0 | 0 | 0 | 3 | 0% | 0 | 0 | – |
| recogito-quote | 3 | 0 | 0 | 0 | 100% | 0 | 0 | – |
| recogito-quote-strict | 3 | 0 | 0 | 0 | 100% | 0 | 0 | – |
| hypothesis | 3 | 0 | 0 | 0 | 100% | 0 | 0 | – |

### synthetic

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 17 | 5 | 2 | 38 | 35% | 1 | 11 | 8% |
| recogito-quote | 58 | 3 | 1 | 0 | 98% | 6 | 6 | 50% |
| recogito-quote-strict | 57 | 1 | 4 | 0 | 94% | 12 | 0 | 100% |
| hypothesis | 59 | 3 | 0 | 0 | 100% | 6 | 6 | 50% |

### wikipedia

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 0 | 4 | 3 | 19 | 15% | 1 | 4 | 20% |
| recogito-quote | 23 | 3 | 0 | 0 | 100% | 2 | 3 | 40% |
| recogito-quote-strict | 21 | 0 | 5 | 0 | 81% | 5 | 0 | 100% |
| hypothesis | 23 | 3 | 0 | 0 | 100% | 2 | 3 | 40% |

## By case and variant

| Case | Variant | recogito-default | recogito-quote | recogito-quote-strict | hypothesis |
| --- | --- | --- | --- | --- | --- |
| gutenberg-pride-prejudice | original | 6/6 | 6/6 | 6/6 | 6/6 |
| gutenberg-pride-prejudice | edited | 0/6 (5 wrong, 1 guessed) | 5/6 (1 guessed) | 6/6 | 5/6 (1 guessed) |
| mdn-textcontent | original | 8/8 | 8/8 | 8/8 | 8/8 |
| mdn-textcontent | edited-light | 3/8 (5 wrong, 3 approx) | 8/8 | 7/8 (1 missed) | 8/8 |
| mdn-textcontent | edited-heavy | 4/8 (3 wrong, 1 guessed, 4 approx) | 8/8 (1 approx) | 8/8 (1 approx) | 8/8 (1 approx) |
| pdf-generated-report | original | 7/7 | 7/7 | 7/7 | 7/7 |
| pdf-generated-report | edited | 2/7 (4 wrong, 1 guessed, 1 approx) | 7/7 | 7/7 | 7/7 |
| pdf-plos-ten-rules | original | 4/5 (1 guessed) | 5/5 | 5/5 | 5/5 |
| react-rerender | original | 7/7 | 7/7 | 7/7 | 7/7 |
| react-rerender | remount | 7/7 | 7/7 | 7/7 | 7/7 |
| react-rerender | data-2 | 1/7 (5 wrong, 1 guessed) | 7/7 (1 approx) | 6/7 (1 missed) | 7/7 (1 approx) |
| synth-duplicates | original | 7/7 | 7/7 | 7/7 | 7/7 |
| synth-duplicates | edited | 0/7 (1 missed, 1 wrong, 5 guessed) | 3/7 (4 guessed) | 7/7 | 3/7 (4 guessed) |
| synth-hidden | original | 0/8 (1 missed, 7 wrong) | 7/8 (1 missed) | 7/8 (1 missed) | 8/8 |
| synth-hidden | edited | 4/8 (4 wrong, 4 approx) | 7/8 (1 missed) | 6/8 (2 missed) | 8/8 |
| synth-overlap | original | 11/11 | 11/11 | 11/11 | 11/11 |
| synth-overlap | edited | 1/11 (1 missed, 7 wrong, 2 guessed) | 10/11 (1 guessed) | 11/11 | 10/11 (1 guessed) |
| synth-scroll | original | 3/3 | 3/3 | 3/3 | 3/3 |
| synth-scroll | edited | 0/3 (3 wrong) | 3/3 | 3/3 | 3/3 |
| synth-unicode | original | 10/10 | 10/10 | 10/10 | 10/10 |
| synth-unicode | edited | 0/10 (9 wrong, 1 guessed) | 9/10 (1 guessed, 1 approx) | 10/10 (1 approx) | 9/10 (1 guessed, 1 approx) |
| vue-rerender | original | 7/7 | 7/7 | 7/7 | 7/7 |
| vue-rerender | remount | 7/7 | 7/7 | 7/7 | 7/7 |
| vue-rerender | data-2 | 1/7 (5 wrong, 1 guessed) | 7/7 (1 approx) | 6/7 (1 missed) | 7/7 (1 approx) |
| wp-ar-www | original | 5/5 | 5/5 | 5/5 | 5/5 |
| wp-ar-www | rev-2025-05 | 2/5 (2 wrong, 1 guessed, 2 approx) | 4/5 (1 guessed) | 5/5 | 4/5 (1 guessed) |
| wp-en-web-annotation | original | 10/10 | 10/10 | 10/10 | 10/10 |
| wp-en-web-annotation | rev-2024-12 | 2/10 (8 wrong, 2 approx) | 10/10 (1 approx) | 9/10 (1 missed) | 10/10 (1 approx) |
| wp-en-web-annotation | rev-2023-10 | 0/10 (8 wrong, 2 guessed) | 9/10 (1 guessed, 2 approx) | 7/10 (3 missed) | 9/10 (1 guessed, 2 approx) |
| wp-ja-emoji | original | 6/6 | 6/6 | 6/6 | 6/6 |
| wp-ja-emoji | rev-2023-02 | 1/6 (3 missed, 1 wrong, 1 guessed) | 5/6 (1 guessed) | 5/6 (1 missed) | 5/6 (1 guessed) |

## Failures in detail

| Case | Variant | Annotation | Candidate | Verdict | Got |
| --- | --- | --- | --- | --- | --- |
| gutenberg-pride-prejudice | edited | pg-header | recogito-default | guessed | “ PREFACE. List of Illustrations. Chapter: I.,” |
| gutenberg-pride-prejudice | edited | opening | recogito-default | wrong | “ in a chaise and four to see the place, and was so much deli” |
| gutenberg-pride-prejudice | edited | dialogue | recogito-default | wrong | “cerns, as I often see done." "My fingers," s” |
| gutenberg-pride-prejudice | edited | mr-darcy | recogito-default | wrong | “inly shall not. You know how I detest it, unless I am partic” |
| gutenberg-pride-prejudice | edited | preface | recogito-default | wrong | “as no way out of it for a man of sense and spirit but the ir” |
| gutenberg-pride-prejudice | edited | ending | recogito-default | wrong | “A. By reading or using any part of” |
| gutenberg-pride-prejudice | edited | pg-header | recogito-quote | guessed | “the Project Gutenberg mission of promoting free acce” |
| gutenberg-pride-prejudice | edited | pg-header | hypothesis | guessed | “the Project Gutenberg mission of promoting free acce” |
| mdn-textcontent | edited-light | innertext-heading-sentence | recogito-default | wrong | “r triggers layout, which makes it the cheaper of the two pro” |
| mdn-textcontent | edited-light | innerhtml-xss | recogito-default | wrong | “possible.) Differences from innerHTML Element.innerHTML gets” |
| mdn-textcontent | edited-light | code-block | recogito-default | wrong | “v id="divA">This is <span>some</span> text!</div> You ” |
| mdn-textcontent | edited-light | sidebar-link | recogito-default | wrong | “enodeValueownerDocumentpa” |
| mdn-textcontent | edited-light | footer-note | recogito-default | wrong | “ ” |
| mdn-textcontent | edited-light | innertext-heading-sentence | recogito-quote-strict | missed | — |
| mdn-textcontent | edited-heavy | innerhtml-xss | recogito-default | guessed | “v> You can use textContent to get the element's text content” |
| mdn-textcontent | edited-heavy | code-block | recogito-default | wrong | “ DOM# dom-n” |
| mdn-textcontent | edited-heavy | sidebar-link | recogito-default | wrong | “tFragmentDocumentTypeElem” |
| mdn-textcontent | edited-heavy | footer-note | recogito-default | wrong | “extContentInstance methodsappe” |
| pdf-generated-report | edited | habit | recogito-default | wrong | “o annotated published papers for a reading list. Theeditoria” |
| pdf-generated-report | edited | table-row | recogito-default | wrong | “ quarter. Changes r” |
| pdf-generated-report | edited | orphans-sentence | recogito-default | wrong | “change Documents Annotations Re-anchored OrphanedTypo or pun” |
| pdf-generated-report | edited | recommendation-3 | recogito-default | guessed | “rs in the sidebar and for annotations on figures, neither of” |
| pdf-generated-report | edited | appendix | recogito-default | wrong | “document wascounted ” |
| pdf-plos-ten-rules | original | decoy | recogito-default | guessed | “ to allow success-ful repetition and extension of analysesba” |
| react-rerender | data-2 | title-101 | recogito-default | wrong | “Keyboard selection does not open the annotation toolb” |
| react-rerender | data-2 | body-101 | recogito-default | wrong | “lights disappear after the comment list re-rendersopened by ” |
| react-rerender | data-2 | comment-101 | recogito-default | wrong | “nd every highlight inside it is lost. The sele” |
| react-rerender | data-2 | body-102 | recogito-default | wrong | “d on each poll.tomas: Switching to the comment id as the key” |
| react-rerender | data-2 | body-103 | recogito-default | guessed | “r every emoji before the quote.ines: This is the offset unit” |
| react-rerender | data-2 | body-104 | recogito-default | wrong | “e hidden replies are not in the document, and an annotation ” |
| react-rerender | data-2 | title-101 | recogito-quote-strict | missed | — |
| synth-duplicates | edited | heading-4-2 | recogito-default | guessed | “Section 4.3 Tissue” |
| synth-duplicates | edited | number-only | recogito-default | guessed | “4.3” |
| synth-duplicates | edited | saliva-para | recogito-default | guessed | “Store at −80 °C within 15 minutes of arrival. Record the fre” |
| synth-duplicates | edited | log-sentence | recogito-default | guessed | “zer position in the intake log. Section 5.2 S” |
| synth-duplicates | edited | table-value | recogito-default | guessed | “ager t” |
| synth-duplicates | edited | tissue-para | recogito-default | wrong | “ing the building travel on dry ice. Record th” |
| synth-duplicates | edited | signoff | recogito-default | missed | — |
| synth-duplicates | edited | heading-4-2 | recogito-quote | guessed | “Section 5.2 Shi” |
| synth-duplicates | edited | number-only | recogito-quote | guessed | “4.” |
| synth-duplicates | edited | log-sentence | recogito-quote | guessed | “Record the freezer position in the intake log.” |
| synth-duplicates | edited | table-value | recogito-quote | guessed | “4.0 ml” |
| synth-duplicates | edited | heading-4-2 | hypothesis | guessed | “Section 5.2 Shi” |
| synth-duplicates | edited | number-only | hypothesis | guessed | “4.” |
| synth-duplicates | edited | log-sentence | hypothesis | guessed | “Record the freezer position in the intake log.” |
| synth-duplicates | edited | table-value | hypothesis | guessed | “4.0 ml” |
| synth-hidden | original | after-hidden | recogito-default | wrong | “t 4411) crash on star” |
| synth-hidden | original | across-hidden-span | recogito-default | wrong | “p when the configuration file is missing, and it add” |
| synth-hidden | original | across-br | recogito-default | wrong | “I gains a /health endpoint. ★ Clients should” |
| synth-hidden | original | aria-hidden-glyph | recogito-default | wrong | “e a minute. <p>Enable JavaScript t” |
| synth-hidden | original | inside-details | recogito-default | wrong | “ is planned for 3.2.1. Upgrading Back up th” |
| synth-hidden | original | excluded-toolbar | recogito-default | wrong | “for version 3.2 ” |
| synth-hidden | original | noscript | recogito-default | wrong | “to PDF loses footnote” |
| synth-hidden | original | end-of-main | recogito-default | missed | — |
| synth-hidden | original | excluded-toolbar | recogito-quote | missed | — |
| synth-hidden | original | excluded-toolbar | recogito-quote-strict | missed | — |
| synth-hidden | edited | after-hidden | recogito-default | wrong | “sion 3.2 Version 3.2 ” |
| synth-hidden | edited | inside-details | recogito-default | wrong | “ents.</p> Known issues Exporting to PDF los” |
| synth-hidden | edited | excluded-toolbar | recogito-default | wrong | “mand linePlugins” |
| synth-hidden | edited | end-of-main | recogito-default | wrong | “names the owner column to create” |
| synth-hidden | edited | excluded-toolbar | recogito-quote | missed | — |
| synth-hidden | edited | across-hidden-span | recogito-quote-strict | missed | — |
| synth-hidden | edited | excluded-toolbar | recogito-quote-strict | missed | — |
| synth-overlap | edited | whole-sentence | recogito-default | wrong | “s in the original minutes were wrong and have been fixed bel” |
| synth-overlap | edited | inner-phrase | recogito-default | wrong | “ wrong and have been fixed below. Pro” |
| synth-overlap | edited | straddle | recogito-default | guessed | “s of the review board, 14 March The board met to rev” |
| synth-overlap | edited | vote-b | recogito-default | wrong | “e anchoring code Proposal” |
| synth-overlap | edited | vote-c | recogito-default | wrong | “ in search as well as on si” |
| synth-overlap | edited | proposal-a-para | recogito-default | guessed | “ew three proposals for the annotation platform and to settle” |
| synth-overlap | edited | disc-1 | recogito-default | wrong | “isio” |
| synth-overlap | edited | disc-2 | recogito-default | wrong | “ Run ” |
| synth-overlap | edited | disc-3 | recogito-default | wrong | “ial o” |
| synth-overlap | edited | closing | recogito-default | missed | — |
| synth-overlap | edited | straddle | recogito-quote | guessed | “from February. Proposal B: build on an existing li” |
| synth-overlap | edited | straddle | hypothesis | guessed | “from February. Proposal B: build on an existing li” |
| synth-scroll | edited | deep-section | recogito-default | wrong | “thing shown attributable every and repai” |
| synth-scroll | edited | last-section | recogito-default | wrong | “ores and hand keeps is every is a. The so verbat” |
| synth-scroll | edited | appendix | recogito-default | wrong | “ hand is and lost the verbatim is shown. Appe” |
| synth-unicode | edited | emoji-pair | recogito-default | wrong | “e day went well 🎉” |
| synth-unicode | edited | flags | recogito-default | wrong | “ed with the 🇮🇪, 🇯🇵 an” |
| synth-unicode | edited | zwj-sequences | recogito-default | wrong | “es. Thanks to 👩🏽‍💻 Priya and” |
| synth-unicode | edited | family | recogito-default | wrong | “x, and to t” |
| synth-unicode | edited | hindi | recogito-default | wrong | “ उपलब्ध है और पहले दो सप्ताह में कोई” |
| synth-unicode | edited | thai | recogito-default | guessed | “ली। การแปลภาษาไทยพร้อมใช” |
| synth-unicode | edited | arabic | recogito-default | wrong | “ليمين إلى اليسار ” |
| synth-unicode | edited | ligature | recogito-default | wrong | “ت. The li” |
| synth-unicode | edited | combining | recogito-default | wrong | “and the decomposed ” |
| synth-unicode | edited | time | recogito-default | wrong | “nd twenty-” |
| synth-unicode | edited | thai | recogito-quote | guessed | “ทยพร้อมใช้งานแล้วในรุ่นนี้” |
| synth-unicode | edited | thai | hypothesis | guessed | “ทยพร้อมใช้งานแล้วในรุ่นนี้” |
| vue-rerender | data-2 | title-101 | recogito-default | wrong | “Keyboard selection does not open the annotation toolb” |
| vue-rerender | data-2 | body-101 | recogito-default | wrong | “lights disappear after the comment list re-rendersopened by ” |
| vue-rerender | data-2 | comment-101 | recogito-default | wrong | “nd every highlight inside it is lost. The sele” |
| vue-rerender | data-2 | body-102 | recogito-default | wrong | “d on each poll.tomas: Switching to the comment id as the key” |
| vue-rerender | data-2 | body-103 | recogito-default | guessed | “r every emoji before the quote.ines: This is the offset unit” |
| vue-rerender | data-2 | body-104 | recogito-default | wrong | “e hidden replies are not in the document, and an annotation ” |
| vue-rerender | data-2 | title-101 | recogito-quote-strict | missed | — |
| wp-ar-www | rev-2025-05 | march-1989 | recogito-default | wrong | “1989، قدم مذكرة بعن” |
| wp-ar-www | rev-2025-05 | http | recogito-default | wrong | “وتوكول نقل النص الفائق).[22] مصطلحات ذات” |
| wp-ar-www | rev-2025-05 | new-synonym | recogito-default | guessed | “ة العالمية أو النسيج الع” |
| wp-ar-www | rev-2025-05 | new-synonym | recogito-quote | guessed | “الشبكة العنكبوتية العالمي” |
| wp-ar-www | rev-2025-05 | new-synonym | hypothesis | guessed | “الشبكة العنكبوتية العالمي” |
| wp-en-web-annotation | rev-2024-12 | lede | recogito-default | wrong | “annotations of web resources such as web pages or parts of t” |
| wp-en-web-annotation | rev-2024-12 | data-structures | recogito-default | wrong | “being annotated, e.g., a web document or a part” |
| wp-en-web-annotation | rev-2024-12 | recogito-row | recogito-default | wrong | “ht 0.1em center/12px no-repeat}body:not(.skin-timeless):not(” |
| wp-en-web-annotation | rev-2024-12 | mosaic | recogito-default | wrong | “in-minerva) .mw-parser-output .id-lock-subscription a,body:n” |
| wp-en-web-annotation | rev-2024-12 | critlink | recogito-default | wrong | “mw-parser-output .cs1-code{color:inherit;background:inherit;” |
| wp-en-web-annotation | rev-2024-12 | feb-2015 | recogito-default | wrong | “limited a,.mw-parser-output .id-lock-registration.i” |
| wp-en-web-annotation | rev-2024-12 | bullet-purpose | recogito-default | wrong | “ between information fragments. to save, retain and synthesi” |
| wp-en-web-annotation | rev-2024-12 | see-also-perusall | recogito-default | wrong | “of org m” |
| wp-en-web-annotation | rev-2024-12 | data-structures | recogito-quote-strict | missed | — |
| wp-en-web-annotation | rev-2023-10 | lede | recogito-default | wrong | “annotations of web resources such as web pages or parts of t” |
| wp-en-web-annotation | rev-2023-10 | data-structures | recogito-default | wrong | “being annotated, e.g., a web document or a part” |
| wp-en-web-annotation | rev-2023-10 | annotea | recogito-default | wrong | “ersedes other standardization initiatives for annotations on” |
| wp-en-web-annotation | rev-2023-10 | rfc-7111 | recogito-default | wrong | “gment identifiers for the application/pdf media type)[15] SV” |
| wp-en-web-annotation | rev-2023-10 | recogito-row | recogito-default | guessed | “r,#bf3c2c)}.mw-parser-output .cs1-visible-error{color:var(--” |
| wp-en-web-annotation | rev-2023-10 | mosaic | recogito-default | wrong | “ht:inherit}@media screen{.mw-parser-output .cs1-format{font-” |
| wp-en-web-annotation | rev-2023-10 | critlink | recogito-default | wrong | “olor-scheme:dark){html.skin-theme-clientpref-os .mw-parser-o” |
| wp-en-web-annotation | rev-2023-10 | feb-2015 | recogito-default | wrong | “w-parser-output .id-lock-limited a,body:not(.skin-t” |
| wp-en-web-annotation | rev-2023-10 | bullet-purpose | recogito-default | wrong | “ between information fragments. to save, retain and synthesi” |
| wp-en-web-annotation | rev-2023-10 | see-also-perusall | recogito-default | guessed | “ital lib” |
| wp-en-web-annotation | rev-2023-10 | see-also-perusall | recogito-quote | guessed | “ters all” |
| wp-en-web-annotation | rev-2023-10 | data-structures | recogito-quote-strict | missed | — |
| wp-en-web-annotation | rev-2023-10 | annotea | recogito-quote-strict | missed | — |
| wp-en-web-annotation | rev-2023-10 | feb-2015 | recogito-quote-strict | missed | — |
| wp-en-web-annotation | rev-2023-10 | see-also-perusall | hypothesis | guessed | “ters all” |
| wp-ja-emoji | rev-2023-02 | lede | recogito-default | wrong | “たり、アップル社のiOSとグーグル社のGmailで絵文字が使える” |
| wp-ja-emoji | rev-2023-02 | co-59 | recogito-default | missed | — |
| wp-ja-emoji | rev-2023-02 | baseball | recogito-default | missed | — |
| wp-ja-emoji | rev-2023-02 | emoji-day | recogito-default | missed | — |
| wp-ja-emoji | rev-2023-02 | navbox | recogito-default | guessed | “ように、フォント” |
| wp-ja-emoji | rev-2023-02 | navbox | recogito-quote | guessed | “ 絵文字類型” |
| wp-ja-emoji | rev-2023-02 | lede | recogito-quote-strict | missed | — |
| wp-ja-emoji | rev-2023-02 | navbox | hypothesis | guessed | “ 絵文字類型” |

## Score threshold sweep for recogito-quote

Edited variants only. Each row re-reads the same answers, treating any quote match whose score is below the threshold as an orphan. Position hits (score 1) are unaffected. This is the lever between recall and false anchors; the Hypothesis matcher scores identically, so the curve applies to it too.

| Minimum score | Recall | Must-not-match held | Missed | Guessed |
| ---: | ---: | ---: | ---: | ---: |
| 0.00 | 99% | 47% | 1 | 10 |
| 0.50 | 99% | 58% | 1 | 8 |
| 0.60 | 99% | 63% | 1 | 7 |
| 0.65 | 99% | 74% | 1 | 5 |
| 0.70 | 98% | 89% | 2 | 2 |
| 0.75 | 98% | 100% | 2 | 0 |
| 0.80 | 91% | 100% | 10 | 0 |
| 0.85 | 87% | 100% | 14 | 0 |
| 0.90 | 81% | 100% | 20 | 0 |

## Timing

Milliseconds to anchor all of a variant's annotations, by candidate (longest documents first).

| Case | Variant | Text length | recogito-default | recogito-quote | recogito-quote-strict | hypothesis |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| gutenberg-pride-prejudice | original | 738349 | 11 | 10 | 10 | 2 |
| gutenberg-pride-prejudice | edited | 736324 | 10 | 64 | 62 | 44 |
| wp-ar-www | original | 36847 | 3 | 3 | 3 | 1 |
| wp-ar-www | rev-2025-05 | 36538 | 3 | 9 | 9 | 6 |
| wp-en-web-annotation | original | 26551 | 5 | 5 | 5 | 1 |
| pdf-plos-ten-rules | original | 24073 | 3 | 5 | 5 | 4 |
| mdn-textcontent | edited-light | 22897 | 5 | 13 | 13 | 5 |
| mdn-textcontent | original | 22785 | 5 | 5 | 5 | 1 |
| mdn-textcontent | edited-heavy | 22372 | 5 | 13 | 13 | 7 |
| wp-ja-emoji | original | 21617 | 3 | 3 | 3 | 1 |
| wp-en-web-annotation | rev-2024-12 | 20936 | 5 | 14 | 14 | 4 |
| wp-en-web-annotation | rev-2023-10 | 19360 | 5 | 15 | 15 | 9 |
| wp-ja-emoji | rev-2023-02 | 13992 | 5 | 9 | 9 | 6 |
| synth-scroll | edited | 7352 | 2 | 4 | 4 | 2 |
| synth-scroll | original | 6916 | 2 | 2 | 2 | 1 |
| pdf-generated-report | edited | 3284 | 3 | 3 | 3 | 3 |
| pdf-generated-report | original | 3049 | 2 | 3 | 2 | 1 |
| react-rerender | data-2 | 1488 | 3 | 4 | 4 | 2 |
| vue-rerender | data-2 | 1488 | 3 | 4 | 4 | 2 |
| react-rerender | original | 1436 | 2 | 3 | 2 | 1 |
| react-rerender | remount | 1436 | 2 | 2 | 2 | 1 |
| vue-rerender | original | 1436 | 2 | 2 | 2 | 1 |
| vue-rerender | remount | 1436 | 2 | 2 | 2 | 1 |
| synth-overlap | original | 1426 | 3 | 3 | 3 | 1 |
| synth-overlap | edited | 1242 | 2 | 4 | 4 | 2 |
| synth-hidden | edited | 980 | 3 | 4 | 4 | 2 |
| synth-duplicates | original | 907 | 2 | 2 | 3 | 1 |
| synth-hidden | original | 839 | 3 | 3 | 3 | 1 |
| synth-duplicates | edited | 762 | 2 | 4 | 5 | 3 |
| synth-unicode | edited | 672 | 3 | 4 | 4 | 2 |
| synth-unicode | original | 644 | 2 | 2 | 2 | 1 |

