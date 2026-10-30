# Anchoring trial results

Generated 2026-10-30.

Each row counts one annotation on one variant. "Recall" is anchored plus approximate over all annotations whose text exists in the variant. "Must-not-match held" is the share of `mustNotMatch` annotations correctly reported as orphans. Verdicts are defined in `trial/src/classify.ts`.

## Candidates

- **guest**: The guest on the text model (ADR 0012, 0013): RangeSelector, then TextPosition, each checked against the quote, then quote matching with the minimum score and quote-length floor from ADR 0017.
- **guest-sweep**: The same code with the score threshold and quote-length floor turned off, recorded for the threshold sweep only.

## All cases

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 197 | 7 | 1 | 0 | 100% | 20 | 0 | 100% |
| guest-sweep | 197 | 8 | 0 | 0 | 100% | 10 | 10 | 50% |

## Edited variants only

The original variant should anchor for every candidate; this table leaves it out.

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 99 | 7 | 1 | 0 | 99% | 19 | 0 | 100% |
| guest-sweep | 99 | 8 | 0 | 0 | 100% | 9 | 10 | 47% |

## By tag (edited variants)

### br

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 7 | 0 | 0 | 0 | 100% | 0 | 0 | – |
| guest-sweep | 7 | 0 | 0 | 0 | 100% | 0 | 0 | – |

### emoji

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 12 | 1 | 0 | 0 | 100% | 3 | 0 | 100% |
| guest-sweep | 12 | 1 | 0 | 0 | 100% | 1 | 2 | 33% |

### excluded

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 7 | 0 | 0 | 0 | 100% | 0 | 0 | – |
| guest-sweep | 7 | 0 | 0 | 0 | 100% | 0 | 0 | – |

### framework

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 24 | 2 | 0 | 0 | 100% | 2 | 0 | 100% |
| guest-sweep | 24 | 2 | 0 | 0 | 100% | 2 | 0 | 100% |

### hidden

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 7 | 0 | 0 | 0 | 100% | 0 | 0 | – |
| guest-sweep | 7 | 0 | 0 | 0 | 100% | 0 | 0 | – |

### long

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 9 | 0 | 0 | 0 | 100% | 2 | 0 | 100% |
| guest-sweep | 9 | 0 | 0 | 0 | 100% | 0 | 2 | 0% |

### mustNotMatch

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 52 | 3 | 1 | 0 | 98% | 15 | 0 | 100% |
| guest-sweep | 52 | 4 | 0 | 0 | 100% | 6 | 9 | 40% |

### non-latin

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 16 | 1 | 0 | 0 | 100% | 4 | 0 | 100% |
| guest-sweep | 16 | 1 | 0 | 0 | 100% | 1 | 3 | 25% |

### overlap

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 8 | 0 | 0 | 0 | 100% | 3 | 0 | 100% |
| guest-sweep | 8 | 0 | 0 | 0 | 100% | 2 | 1 | 67% |

### pdf

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 6 | 0 | 0 | 0 | 100% | 1 | 0 | 100% |
| guest-sweep | 6 | 0 | 0 | 0 | 100% | 1 | 0 | 100% |

### real

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 42 | 3 | 1 | 0 | 98% | 7 | 0 | 100% |
| guest-sweep | 42 | 4 | 0 | 0 | 100% | 3 | 4 | 43% |

### scroll

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 2 | 1 | 0 | 0 | 100% | 0 | 0 | – |
| guest-sweep | 2 | 1 | 0 | 0 | 100% | 0 | 0 | – |

### synthetic

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 57 | 4 | 0 | 0 | 100% | 12 | 0 | 100% |
| guest-sweep | 57 | 4 | 0 | 0 | 100% | 6 | 6 | 50% |

### wikipedia

| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 23 | 2 | 1 | 0 | 96% | 5 | 0 | 100% |
| guest-sweep | 23 | 3 | 0 | 0 | 100% | 2 | 3 | 40% |

## By case and variant

| Case | Variant | guest | guest-sweep |
| --- | --- | --- | --- |
| gutenberg-pride-prejudice | original | 6/6 | 6/6 |
| gutenberg-pride-prejudice | edited | 6/6 | 5/6 (1 guessed) |
| mdn-textcontent | original | 8/8 | 8/8 |
| mdn-textcontent | edited-light | 8/8 | 8/8 |
| mdn-textcontent | edited-heavy | 8/8 (1 approx) | 8/8 (1 approx) |
| pdf-generated-report | original | 7/7 | 7/7 |
| pdf-generated-report | edited | 7/7 | 7/7 |
| pdf-plos-ten-rules | original | 5/5 | 5/5 |
| react-rerender | original | 7/7 | 7/7 |
| react-rerender | remount | 7/7 | 7/7 |
| react-rerender | data-2 | 7/7 (1 approx) | 7/7 (1 approx) |
| synth-duplicates | original | 7/7 | 7/7 |
| synth-duplicates | edited | 7/7 | 3/7 (4 guessed) |
| synth-hidden | original | 7/7 | 7/7 |
| synth-hidden | edited | 7/7 | 7/7 |
| synth-overlap | original | 11/11 | 11/11 |
| synth-overlap | edited | 11/11 | 10/11 (1 guessed) |
| synth-scroll | original | 3/3 | 3/3 |
| synth-scroll | edited | 3/3 (1 approx) | 3/3 (1 approx) |
| synth-unicode | original | 10/10 | 10/10 |
| synth-unicode | edited | 10/10 (1 approx) | 9/10 (1 guessed, 1 approx) |
| vue-rerender | original | 7/7 | 7/7 |
| vue-rerender | remount | 7/7 | 7/7 |
| vue-rerender | data-2 | 7/7 (1 approx) | 7/7 (1 approx) |
| wp-ar-www | original | 5/5 | 5/5 |
| wp-ar-www | rev-2025-05 | 5/5 | 4/5 (1 guessed) |
| wp-en-web-annotation | original | 10/10 | 10/10 |
| wp-en-web-annotation | rev-2024-12 | 10/10 (1 approx) | 10/10 (1 approx) |
| wp-en-web-annotation | rev-2023-10 | 9/10 (1 missed, 1 approx) | 9/10 (1 guessed, 2 approx) |
| wp-ja-emoji | original | 6/6 | 6/6 |
| wp-ja-emoji | rev-2023-02 | 6/6 | 5/6 (1 guessed) |

## Failures in detail

| Case | Variant | Annotation | Candidate | Verdict | Got |
| --- | --- | --- | --- | --- | --- |
| gutenberg-pride-prejudice | edited | pg-header | guest-sweep | guessed | “the Project Gutenberg mission of promoting free acce” |
| synth-duplicates | edited | heading-4-2 | guest-sweep | guessed | “Section 5.2 Shi” |
| synth-duplicates | edited | number-only | guest-sweep | guessed | “4.” |
| synth-duplicates | edited | log-sentence | guest-sweep | guessed | “Record the freezer position in the intake log.” |
| synth-duplicates | edited | table-value | guest-sweep | guessed | “4.0 ml” |
| synth-overlap | edited | straddle | guest-sweep | guessed | “from February. Proposal B: build on an existing li” |
| synth-unicode | edited | thai | guest-sweep | guessed | “ทยพร้อมใช้งานแล้วในรุ่นนี้” |
| wp-ar-www | rev-2025-05 | new-synonym | guest-sweep | guessed | “الشبكة العنكبوتية العالمي” |
| wp-en-web-annotation | rev-2023-10 | annotea | guest | missed | error: best quote match scored 0.70, below 0.75 |
| wp-en-web-annotation | rev-2023-10 | see-also-perusall | guest-sweep | guessed | “ters all” |
| wp-ja-emoji | rev-2023-02 | navbox | guest-sweep | guessed | “。 絵文字類型” |

## Score threshold sweep for guest-sweep

Edited variants only. Each row re-reads the same answers, treating any quote match whose score is below the threshold as an orphan. Position hits (score 1) are unaffected. This is the lever between recall and false anchors; the Hypothesis matcher scores identically, so the curve applies to it too.

| Minimum score | Recall | Must-not-match held | Missed | Guessed |
| ---: | ---: | ---: | ---: | ---: |
| 0.00 | 100% | 47% | 0 | 10 |
| 0.50 | 100% | 58% | 0 | 8 |
| 0.60 | 100% | 63% | 0 | 7 |
| 0.65 | 100% | 74% | 0 | 5 |
| 0.70 | 99% | 89% | 1 | 2 |
| 0.75 | 99% | 100% | 1 | 0 |
| 0.80 | 93% | 100% | 7 | 0 |
| 0.85 | 92% | 100% | 9 | 0 |
| 0.90 | 87% | 100% | 14 | 0 |

## Timing

Milliseconds to anchor all of a variant's annotations, by candidate (longest documents first).

| Case | Variant | Text length | guest | guest-sweep |
| --- | --- | ---: | ---: | ---: |
| gutenberg-pride-prejudice | original | 738349 | 64 | 55 |
| gutenberg-pride-prejudice | edited | 736324 | 95 | 92 |
| wp-ar-www | original | 36847 | 7 | 7 |
| wp-ar-www | rev-2025-05 | 36538 | 9 | 9 |
| wp-en-web-annotation | original | 26551 | 6 | 6 |
| pdf-plos-ten-rules | original | 24073 | 7 | 7 |
| mdn-textcontent | edited-light | 22897 | 7 | 7 |
| mdn-textcontent | original | 22785 | 7 | 5 |
| mdn-textcontent | edited-heavy | 22372 | 7 | 7 |
| wp-ja-emoji | original | 21617 | 8 | 5 |
| wp-en-web-annotation | rev-2024-12 | 20936 | 7 | 8 |
| wp-en-web-annotation | rev-2023-10 | 19360 | 10 | 9 |
| wp-ja-emoji | rev-2023-02 | 13992 | 6 | 6 |
| synth-scroll | edited | 7352 | 3 | 4 |
| synth-scroll | original | 6916 | 2 | 2 |
| pdf-generated-report | edited | 3284 | 2 | 2 |
| pdf-generated-report | original | 3049 | 1 | 2 |
| react-rerender | data-2 | 1488 | 3 | 3 |
| vue-rerender | data-2 | 1488 | 3 | 3 |
| react-rerender | original | 1436 | 2 | 1 |
| react-rerender | remount | 1436 | 2 | 2 |
| vue-rerender | original | 1436 | 1 | 2 |
| vue-rerender | remount | 1436 | 1 | 2 |
| synth-overlap | original | 1426 | 2 | 2 |
| synth-overlap | edited | 1242 | 4 | 3 |
| synth-hidden | edited | 980 | 2 | 2 |
| synth-duplicates | original | 907 | 1 | 1 |
| synth-hidden | original | 839 | 2 | 2 |
| synth-duplicates | edited | 762 | 3 | 3 |
| synth-unicode | edited | 672 | 3 | 3 |
| synth-unicode | original | 644 | 1 | 2 |

