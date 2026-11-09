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
3. **Select text** in the page. The sidebar shows the selected text and an **Annotate selection** button. Press it, write your comment, add tags (type one and press Enter), optionally pick a **Structured data** form and fill it in, and **Post**.
4. **New page note** writes an annotation about the page as a whole, without a selection.
5. **Find an annotation in the page**: click its quoted text in the sidebar and the page scrolls to the highlight. Hover a card and its highlight is emphasised; click a highlight in the page and the sidebar scrolls to its card.
6. **Reply**, **Edit**, **Delete** are on each card you have the right to. Edits keep the original selection; if someone changed the annotation since you opened it, the sidebar tells you and offers to load the latest version first.

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

The platform address is also the management site (`/me`, `/groups`, `/browse`):

- **Me** shows your account and groups.
- **Groups** lists your groups, lets you create one and manage those you administer.
- **Annotations** browses and searches the annotations you may read, across every document, and shows each annotation's sharing.
- **Users** (administrators) lists every user and lets administrators rename them.

## 7. Accessibility

Everything in the sidebar works from the keyboard and with a screen reader: the quoted text of a card is a button that takes the page to the highlight, Tab reaches every action, and arriving annotations are announced. Selecting text in the page with the keyboard or with assistive technology works like a pointer selection. Highlights are drawn so that they stay visible in high-contrast modes. The details, and what is known not to work yet, are in [accessibility.md](accessibility.md).

## 8. Privacy and what the page can see

The page you annotate never sees your login, your annotations' text, tags or authors: the sidebar runs on the platform's own origin and the page gets only the location of each highlight. The page does see the text you select, which it could see anyway. Nothing in the bookmarklet or the page can sign you in or act as you.
