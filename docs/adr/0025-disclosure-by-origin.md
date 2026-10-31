# 0025. A page is sent only its own origin's annotations, public ones, and those the user allows

**Status:** Accepted

**Date:** 2026-10-31

## Context

Document identity (ADR 0014) lets a page attach its own URL to an existing document through a canonical link, DOI or similar; that is how annotations made on a publisher's page are found on a mirror. Any authenticated user can serve such a page. When another user opens it with the sidebar, search by the page's URL returns the linked document's annotations that this user may read, private and group ones included, and the sidebar used to send all of their targets to the page for highlighting. Selectors carry the quoted text, so a page linked to a private document learned what the user had quoted on it. The security review had accepted the alias risk as showing "public annotations of the linked document"; it was wider than that (code review of 2026-10-30, finding 2).

The sidebar's list is on our own origin, so showing such annotations there leaks nothing; only what is sent to the guest reaches the page. Since ADR 0024 the sidebar knows each guest's origin from the browser, so a rule keyed on it holds.

Options considered:

- **Stop learning aliases from pages.** It would close the hole and break the feature: DOI and publisher links are how the same article is found across sites.
- **Never send another origin's annotations.** Safe, and loses highlighting on every legitimate mirror.
- **Send another origin's annotations only when they are public or the user allows it.** Public annotations are readable by anyone through the API, so sending them discloses nothing new; for the rest the user, who can see which site they come from, decides.

## Decision

- The API marks each annotation with `public`: whether the `public` principal holds `read`. It is server-populated and ignored on input, like `permissions`.
- The sidebar sends a guest an annotation only when every target's source is on the guest's origin (host and port, `http` and `https` alike, as document identity compares them), when it is public, when the guest is the trusted PDF viewer (ADR 0021), or when the user has allowed annotations from that source origin on pages of the guest's origin. A source that is not a web URL counts as its own origin. The check is made per guest at the one place the sidebar sends requests, so it covers every frame and the requests meant for all guests.
- `highlights.focus` names to each guest only annotations it was sent. An annotation that stops being public is withdrawn from guests that may no longer have it.
- The sidebar lists withheld annotations as usual, marked with the site they were made on, and offers per site: "Highlight on ⟨page host⟩", saying that this sends their quoted text to that site.
- Consent is a pair of page origin and source origin, kept in the sidebar origin's `sessionStorage`, where the page cannot read or set it. It lasts as long as the tab, which is how long the sidebar's sign-in lasts (ADR 0019).

## Consequences

- A page linked to another site's document learns the quoted text of that document's non-public annotations only after the user chooses to send it. Same-origin annotations, the common case, are unchanged.
- On a legitimate mirror, private and group annotations from the original site need one click per site and tab. Public ones highlight as before.
- The click is the user's judgement of a site they are looking at; a page that tricks the user into clicking (by covering the sidebar, say) gets what the click allows. Clickjacking defences remain `frame-ancestors` (security review, finding 19).
- The API and its generated client gain a field; the protocol does not change, since the flag never leaves the sidebar.
- Consent is not shared between tabs and does not survive closing the tab. Something longer would need a place to review and revoke it.

## References

- [Document identity](../document-identity.md), sections 5 and 8
- [Security review](../security-review.md), finding 22 and the accepted limits
- ADR 0014, ADR 0019, ADR 0021, ADR 0024
