# User guide

How to annotate web pages and PDFs with the platform, share what you write, and work in groups. Your administrator gives you two addresses: the **platform address** (where the sidebar and the management site live, say `https://curanno.example`) and your **login**, which is the organisation's usual sign-in.

## 1. Install the bookmarklet

The platform works through a bookmarklet: a bookmark that, when clicked on any page, loads the annotation tools into that page.

1. Open the platform address in your browser and sign in.
2. On the landing page, find **Annotate** and drag it to your bookmarks bar (or right-click it and add it to your bookmarks). The bookmark holds no credentials; it only knows where the platform is.
3. Go to a page you want to annotate and click the bookmark. A sidebar opens on the right. Click the bookmark again to hide or show it.

The bookmarklet runs on `http` and `https` pages. It cannot run on your browser's own pages (settings, new tab, the built-in PDF viewer) or on pages whose security policy forbids added scripts; for PDFs see section 3.

### Or use the browser extension

In Chrome and other Chromium browsers, the CurAnno extension does the same job without those limits: it works on pages that refuse the bookmarklet, in frames from other sites, and sends PDFs to the viewer. Your administrator tells you how to install it. Then open its options (right-click its toolbar button, **Options**), enter the sidebar address (`https://curanno.example/sidebar/`) and the viewer address, and save. Click the button to turn the annotation tools on in a tab; they stay on as you move between pages in that tab until you click it again. The number on the button is how many annotations the sidebar shows for the page. The options can also show the number of public annotations on every page while the tools are off, which tells the platform each address you visit, so it is off unless you turn it on.

## 2. Annotate a web page

1. Click the bookmark. The sidebar shows the annotations on this page that you may read, newest first, and highlights their text in the page.
2. **Sign in** from the sidebar's button if you are not already. Sign-in opens a small window from your organisation's login; close it when it has finished. Public annotations are visible without signing in.
3. **Select text** in the page. The sidebar shows the selected text and an **Annotate selection** button. Press it, write your comment (Markdown, as on GitHub: `**bold**`, `_italic_`, `` `code` ``, lists, `- [ ]` task lists, tables, `~~strikethrough~~` and links; web addresses become links by themselves, and HTML and images show as text), add tags (type one and press Enter), optionally pick a **Structured data** form and fill it in, and **Post**.
4. **New page note** writes an annotation about the page as a whole, without a selection.
5. **Find an annotation in the page**: click its quoted text in the sidebar and the page scrolls to the highlight. Hover a card and its highlight is emphasised; click a highlight in the page and the sidebar scrolls to its card.
6. **Reply**, **Edit**, **Share** and **Delete** are the icon buttons under each card you have the right to (hover one for its name). Edits keep the original selection; if someone changed the annotation since you opened it, the sidebar tells you and offers to load the latest version first.

7. **Arrange the sidebar**: the tab on its edge hides and shows it, and stays on the page while it is hidden; drag the sidebar's edge (or focus it and use the arrow keys) to make it wider or narrower. The buttons next to the CurAnno title hide or show the highlights in the page and make the annotations' text smaller or larger; the text size is remembered.

### When the page has changed

Pages change after they are annotated. The platform finds the text again when it can, and tells you when it cannot:

- A card marked **Orphaned** has text that is no longer in the page. Nothing was changed on your behalf: the original selection is kept.
- **Ambiguous** means the text now appears in several places and the platform will not guess.
- If you have the right to edit the annotation, select the right text in the page and press **Repair with selection** on the card. The repair is recorded alongside the original.

### Pages with frames

A page made of several frames (an article with an embedded document, say) is handled as one: the sidebar lists each framed document's annotations under a heading, and a selection in a frame is annotated on that frame's document.

### Annotations made on another site

The same article is often published on several sites, and the sidebar finds annotations made on any of them. Annotations made on another site are listed with a **from publisher.example** mark. Public ones are highlighted in the page. The others are not, because highlighting them tells the page their quoted text and the page may not be what it claims. If you trust the page, press **Highlight on ⟨this site⟩** above the list: annotations from that other site are then highlighted on this site until you close the tab.

### Live updates

Annotations other people create, change or delete on the page appear, change or disappear in your sidebar as they happen, with their highlights. The dot next to the page title shows whether the live connection is up.

## 3. Annotate a PDF

PDFs are annotated in the platform's own viewer, so that the annotations follow the file rather than the address it was downloaded from.

- **From a link**: open the viewer address (`https://pdf.curanno.example/pdf/`, the administrator's) and paste the PDF's web address into the form. Clicking the bookmark while your browser shows a PDF opens the viewer directly in browsers that run bookmarklets on PDFs (Firefox); in others, copy the address into the viewer's form. With the extension on in a tab, opening a PDF goes to the viewer by itself.
- **From your computer**: open the viewer address and choose the file. The file is read in your browser and is not uploaded; the platform identifies it by a fingerprint of its content, so the same PDF opened by anyone else, from anywhere, shows the same annotations.
- Some sites do not allow their PDFs to be fetched by other sites. If the viewer says the PDF could not be loaded, download the file and open it from your computer instead.

In the viewer, select text and annotate as on a web page. Each annotation remembers its page; an annotation on a page not yet shown still appears in the sidebar, and its highlight is drawn when you scroll to the page. The viewer's toolbar has page navigation, zoom and a button to show or hide the annotations sidebar.

## 3a. Suggested annotations

Where the administrator has set up a language model, the sidebar can read the page or PDF for you and suggest annotations, such as case individuals and their facts. The model only suggests. What it suggests is saved for one of your groups to review, and nothing becomes an annotation until someone in the group saves it.

1. Press **Suggest annotations…**, tick the kinds of annotation you want, choose the group to review them and the model, and add guidance if it helps (for example, "only individuals with a variant in MYH7").
2. The form says where the document's text will be sent. The administrator chooses these servers; on some installations the only choice is a model on your own computer, and the text never leaves it.
3. Press **Suggest**. A long document is read in parts, one kind after another; **Stop** ends the run, and then nothing is saved.
4. The suggestions appear in a box of their own, under the name of the model, and are highlighted in the page with a dashed blue underline. Anyone in the group sees them there when they open the page, and so do suggestions that programs post for the group (an administrator sets those up).
5. For each suggestion, check the passage and the values. Then use **Review and save** to edit and save it as your annotation, or **Reject**. Phenotypes the ontology lookup did not match are listed so that you can pick the right term. A saved suggestion starts out readable by the group; change that in the form before saving. **Discard all** throws away the rest of a box.

The site's **Suggestions** page lists, for each of your groups, the documents with suggestions still to review. Open a document there, with the sidebar or the extension, to review it.

Each quote is checked against the page: a suggestion whose quote is not in the page word for word, or whose values do not fit the kind of annotation, is set aside and only counted. A saved annotation is yours. Its structured part records the model that suggested it, and you as well if you changed the values, so readers can tell which annotations started as suggestions.

The page is the model's input, and a page can contain text meant to mislead it. Review every suggestion as you would a colleague's draft.

### Case individuals, fact by fact

A case individual is recorded as several annotations, each on the passage that states it:

1. **Individual**: annotate where the article first describes the person, with the label it uses ("II-1", "Patient 3").
2. **Facts**: annotate each passage about the individual with one of **Case variant**, **Case phenotypes**, **Case family history**, **Case testing** or **Case disease**, and add the individuals it is about in the form's **Individuals** field. A passage about several individuals ("all three siblings had cardiomyopathy") is one annotation that names them all. If one of them later turns out to differ, use **Split…** on the annotation to give that individual a copy of their own, which you can then edit.

To save picking the same individual again and again, tick **Current** beside them in the **Individuals** section. New facts start out linked to the current individuals until you move to another page.

Suggestions work the same way, in one run: tick **Individual** with the fact kinds you want, and each suggested fact names the suggested individuals it is about. Without **Individual**, facts are linked to the individuals already saved on the page, and the form asks for one if there are none.

When you review, each suggested individual heads its facts:

- **Save with its suggestions** saves the individual and the facts under it in one go.
- **Same as** says that the individual is one already saved on the page, such as II-1 from an earlier run. The facts then link to that annotation.
- **Reject** on an individual also rejects the facts that were only about them.

Saving a fact on its own also saves the pending individuals named in the reviewed form, including any you chose while editing.

If loading or sharing a saved annotation fails, its suggestion still leaves the pending list. The sidebar shows a separate notice with **Retry loading and sharing**. Retrying finishes the existing annotation; it does not create another one. Other accepted items continue to be loaded and shared.

The **Individuals** section above the annotations brings each individual's facts together in the **Case individual** form's shape, with a link from each value to the passage it came from. It is computed from the annotations you can see and is not saved, so it changes as facts are added, edited or deleted. "Incomplete" means that the summary is still missing something the form requires, such as a variant. **Case individual** is no longer offered for new annotations; existing ones can still be edited.

### Variant IDs

ClinGen asks for a ClinVar ID or an Allele Registry ID (CAID) for each variant. Record the variant in a **Case variant** annotation as the article gives it, then let the platform find the IDs in the ClinGen Allele Registry. The variant itself is never changed: it keeps what the article says.

1. Fill **Variant**, and **GeneName** if the article gives the change without a transcript (`c.1208G>A`) or only the protein change (`p.Arg403Gln`, `R403Q`). The lookup then uses the gene's MANE Select transcript.
2. Press **Look up IDs** under the variant. The sidebar lists what it found: one card per allele, with its CAID, ClinVar variation, gnomAD ID, genomic position and protein change, and links to the registry and ClinVar.
3. Read the notes above and on the cards before choosing. They say what the lookup had to assume and what looks wrong:

   | The note says | What to do |
   | --- | --- |
   | No transcript was given, so the MANE Select transcript was used | Check that the article numbers against that transcript, for instance from its methods or the protein change it gives. |
   | VariantValidator mapped it, or the two versions number this position differently | The article names an older transcript. The lookup offers the change both as numbered on that version and on the current one; the article's protein change usually tells which it means. |
   | Only a protein change was given | Each card is a cDNA change that produces it. Pick the one the article means, or leave the IDs empty. |
   | The reference allele does not match | The article's reference base is wrong at that position. Check the article, and consider a note on the annotation. |
   | The article gives p.…, but on the MANE Select transcript this change is p.… | The cDNA and protein changes disagree. This card is probably not the variant the article means. |
   | This allele is in another gene | The variant may be on the wrong transcript, or reported for another gene. |
   | Nobody has registered it | The allele is valid but has no CAID. A curator with an Allele Registry account can register it; then look it up again. |
   | Not understood | Legacy names such as `IVS4+1G>A` or "exon 13 deletion" cannot be looked up. Find the HGVS form in the article or its supplement, or mark the variant unresolvable. |

4. Press **Use these IDs** on the right card. It fills **CAID**, **ClinVarID** (when ClinVar has a single variation for the allele) and **gnomAD**, and sets **IDSource** to *looked up*. Save the annotation as usual.
5. If there are no IDs to find, as for a deletion described only by its exons or a copy-number change, press **Mark unresolvable**. This clears CAID and ClinVarID and sets **IDSource** to *unresolvable*, so the variant no longer counts as missing its IDs.

When the article itself states the IDs, type them in and set **IDSource** to *stated*.

Looked-up IDs belong to the variant as it was written then: editing **Variant** afterwards clears them and **IDSource**, so look the variant up again. Editing the variant of one marked *unresolvable*, or typing an ID into it, clears that mark.

Suggestions made with the `curanno-suggest` skill look variants up the same way, but fill IDs only when there is nothing to choose: a single registered allele, nothing found wrong, and, if no transcript was given, a protein change in the article that confirms the one assumed. Those suggestions arrive with **IDSource** *looked up*; check them in review like any other value. The skill's report lists the variants it left for you, with their candidates.

The management site's **Variants** page gathers the case variants still without IDs from every article you can read, grouped by the variant as written. Look a variant up there once, and **Use for N annotations** saves its IDs to every annotation of that variant you may edit; **Mark unresolvable** marks them all. Annotations you may only read are listed but left as they are.

If the lookup says it is not available, the administrator has turned it off. Type the IDs by hand, as before.

### Running the model on your own computer

If the administrator offers "This computer", run a model server on your machine:

- **Ollama**: start it so that it accepts the sidebar's requests, with the sidebar's address in place of the example: `OLLAMA_ORIGINS=https://curanno.example ollama serve`, then `ollama pull llama3.1:8b` (or the model the form lists).
- **LM Studio**: load the model, start the server (port 1234) and turn on **Enable CORS** in its server settings.

If the sidebar says it could not reach the server, check that the server is running and allows the sidebar's origin. Chromium may ask once whether the sidebar may connect to devices on your local network; allow it.

## 4. Share

Every annotation starts private to you. Sharing is per annotation:

1. Press **Share** on the card. A table lists who can **read**, **update**, **delete** and **share** it; you keep every right on your own annotations.
2. Type a person's or group's name in **Share with** and pick a match. **Everyone (public)** lets anyone, signed in or not, read the annotation; **Any logged-in user** limits that to signed-in users. Those two can only be given *read*.
3. Tick the rights you want to grant and untick to revoke. Changes apply at once, and people who gain access see the annotation appear in their open sidebars.

Replies are annotations of their own: your reply to someone's annotation is visible only to you until you share it (the easiest way is to share it with the same people).

A person must have signed in once before they can be found in the sharing search.

## Your account (when the platform has its own sign-in)

If your administrator runs the platform's own sign-in rather than your organisation's, you may meet these:

- **Invitation.** The link you were sent asks for your name and a password (at least ten characters); the address it was sent to is your login. It works once.
- **Creating an account.** On the sign-in page choose **Create an account**. Depending on the installation you can use it at once, or it waits for an administrator to approve it; until then you can read what is public, a note says so, and you are mailed when it is decided. Verifying your address (the link in the mail) can speed that up.
- **Forgot your password.** Choose it on the sign-in page and follow the mailed link, valid for an hour. Changing your password this way signs you out everywhere.
- **Your account page** (your name at the top of the management site) changes your password, adds and verifies email addresses, and connects or disconnects Google, GitHub or the organisation's sign-in. You are asked for your password again to do so, and you cannot remove the last way to sign in. If you sign in with Google and an account with that address already exists, you are asked to sign in to that account first so that nothing is joined by accident.
- If you ended up with two accounts, ask an administrator to merge them.

## 5. Groups

Groups let you share with a team in one step. Two kinds exist:

- **Groups from your organisation's directory** (for instance `curators`) are maintained by the identity provider: your membership follows the directory and cannot be edited here.
- **Groups made on the platform**: anyone signed in can create one on the management site (**Groups**, then **New group**), add members and make some of them group administrators. Group administrators manage the membership.

Sharing an annotation with a group grants the chosen rights to its members for as long as they are members.

## 6. The management site

The platform address is also the management site (`/me`, `/groups`, `/browse`, `/suggestions`, `/variants`):

- **Me** shows your account and groups.
- **Groups** lists your groups, lets you create one and manage those you administer.
- **Annotations** browses and searches the annotations you may read, across every document, and shows each annotation's sharing.
- **Suggestions** lists, for each of your groups, the documents with suggestions still to review.
- **Variants** lists the case variants still without a CAID or ClinVar ID, and fills them in for every article at once (see [Variant IDs](#variant-ids)).
- **Users** (administrators) lists every user and lets administrators rename them.

## 7. Accessibility

Everything in the sidebar works from the keyboard and with a screen reader: the quoted text of a card is a button that takes the page to the highlight, Tab reaches every action, and arriving annotations are announced. Selecting text in the page with the keyboard or with assistive technology works like a pointer selection. Highlights are drawn so that they stay visible in high-contrast modes. The details, and what is known not to work yet, are in [accessibility.md](accessibility.md).

## 8. Privacy and what the page can see

The page you annotate never sees your login, your annotations' text, tags or authors: the sidebar runs on the platform's own origin and the page gets only the location of each highlight. The page does see the text you select, which it could see anyway. Nothing in the bookmarklet or the page can sign you in or act as you.

When you ask for suggestions, the page's text goes from the sidebar to the model server named in the form, and to no other: the sidebar's security policy allows only the servers the administrator listed. The model's answers stay in the sidebar; the page gets only where to draw each suggested highlight.

When you look up variant IDs, the platform sends the variant as written and its gene symbol to the ClinGen Allele Registry, and for older transcript versions to VariantValidator. Nothing else about the article or your annotations is sent.
