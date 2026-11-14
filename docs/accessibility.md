# Accessibility

What the platform's clients do for people who use a keyboard, a screen reader, high contrast or forced colours; what the automated checks cover; and what still needs a person to check with assistive technology before and after each release.

## The three surfaces

- **The sidebar** (`apps/sidebar`) is an ordinary web application in an iframe. Every control is a native button, link, input, select or checkbox, so the keyboard and screen readers get them for free. Cards are `article` elements named by their author, focusable (`tabindex="-1"`) so that activating a highlight in the page lands focus on them; the quoted text is a button that scrolls the page to the highlight; focusing anything in a card emphasises its highlight the way hovering does. The list is a live region (`aria-live="polite"`), so annotations arriving over the event stream are announced; the live-updates indicator has a text twin for assistive technology (`role="status"`); errors are `role="alert"`; the sharing panel is a table of labelled checkboxes.
- **The guest's highlights** (`packages/guest`) have no DOM footprint: the CSS Custom Highlight API paints them, and the overlay fallback is `aria-hidden`. The accessibility tree of the annotated page is therefore unchanged, which was the Phase 2 requirement (ADR 0017), and it also means the highlights are not focusable or announced in the page. The sidebar is the keyboard route to an annotation; selecting text with the keyboard or with assistive technology in the page works, because the guest watches `selectionchange` and not pointer events. In forced-colors mode the highlights use `Mark`/`MarkText` with a double underline, so they stay visible when backgrounds are flattened.
- **The PDF viewer** (`apps/pdf-viewer`) has a labelled toolbar (page number, zoom, annotations toggle) and an open form. PDF.js's text layer is what makes the document's text selectable and readable; its quality depends on the PDF's own tagging.
- **The management site** (`apps/web`) is server-rendered Nuxt pages with labelled forms and tables. In embedded mode (ADR 0028) it also has the account pages (sign in, sign up, invitation, forgot and reset password, address verification, account settings, applications): single-column forms with labelled fields, `autocomplete` hints so password managers work, errors and results in `role="alert"` and `role="status"`, and the pending-approval banner as a status message.

## Automated checks

| Check | Where | Runs |
| --- | --- | --- |
| axe (WCAG 2.1 A and AA plus best practices) over the sidebar in every state: list, composer, editor, sharing panel, reply editor, signed out | `apps/sidebar/e2e/guest/a11y.spec.ts` | CI `bookmarklet-e2e` |
| axe over the PDF viewer, empty and with a document (the rendered PDF itself excluded) | same | same |
| Keyboard: Tab reaches the quote button and every card action in order; focusing a card emphasises its highlight; Enter on the quote scrolls the page to it | same | same |
| Forced colours: the highlighted text is drawn differently from the page beside it | same | same |
| axe over the management site's landing page and groups page | `apps/web/e2e/groups.spec.ts` | CI `web-e2e` |
| axe over the embedded issuer's sign-in, sign-up and applications pages | `apps/web/e2e/groups.spec.ts`, `signup.spec.ts` with `E2E_AUTH=embedded` | CI `embedded-e2e` |
| Accessibility tree unchanged by highlights; tab stops unchanged; forced-colours visibility of the highlight techniques | `pnpm --filter @curanno/guest trial:a11y` (`packages/guest/trial/results/a11y.json`) | by hand, Phase 2 evaluation tooling |

axe-core is MPL-2.0 and admitted as a development-only dependency by ADR 0022.

## What a person must check with a screen reader

Automated rules cannot tell whether the experience makes sense. Before each release, a person runs through the following with VoiceOver (Safari and Chrome on macOS) and NVDA (Firefox and Chrome on Windows), against the compose stack with the bookmarklet on a corpus page (`pnpm --filter @curanno/guest dev -- --sidebar-origin http://localhost:3001`) and on a PDF in the viewer. Record the date, software versions and findings in the release notes.

1. **Finding the sidebar.** From the page, does the screen reader reach the "Annotations" frame, and is the frame's title read? Is the sign-in button announced, and does the popup sign-in complete with focus returning to the sidebar?
2. **Reading the list.** Are cards announced with the author's name, the quoted text, the comment, tags and the anchoring state ("Orphaned" badge)? Does a new annotation arriving from another user get announced by the live region without stealing focus?
3. **Annotating.** Select text in the page with the screen reader's or the keyboard's selection commands (caret browsing in Firefox, VoiceOver's text selection). Does "Annotate selection" appear and read the quote? Is the comment field labelled, do tags and phenotype terms announce as they are added and removed (Backspace in the empty field marks the last one and a second removes it; each one's button is named by its text), is the highlighted phenotype suggestion read as the arrows move through the list, are structured-body fields labelled with their titles and are validation errors announced?
4. **Highlights to cards.** Clicking a highlight with a pointer focuses its card; with a screen reader there is no highlight to click. Confirm that the quote button in the card scrolls the page and that the page's text at that point reads as the quote.
5. **Sharing.** Is the sharing table navigable cell by cell with row and column headers read (principal name, permission)? Does the principal search announce its matches?
6. **Replies and threads.** Is the nesting of replies conveyed? (Today it is visual indentation only; if this is confusing, a level attribute on the thread is the fix.)
7. **PDF viewer.** Is the toolbar operable and announced? Does reading the text layer page by page work, and does the sidebar card's quote button bring the right page into view?
8. **Forced colours and high contrast.** On Windows with a high-contrast theme, are highlights visible in the page, is the focused card outlined, and are primary buttons distinguishable?
9. **Zoom.** At 200% browser zoom and at a 320 px wide sidebar, is anything cut off or overlapping?

## Known limits

- Highlights are not in the accessibility tree, by design (ADR 0017): a screen reader reading the page does not learn where annotations are. The sidebar is the route to them.
- Reply nesting is visual only.
- The overlay highlight fallback (browsers without the CSS Custom Highlight API) has no automated check, since CI runs Chromium only.
