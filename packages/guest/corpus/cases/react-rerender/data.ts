/** Shared by the React and Vue re-render cases so both show the same text. */
export type Issue = {
  id: number;
  title: string;
  author: string;
  state: 'open' | 'closed';
  /** Version 2 pins issue 101, which inserts an element before its body text. */
  pinned?: boolean;
  body: string;
  comments: { author: string; text: string }[];
};

const base: Issue[] = [
  {
    id: 101,
    title: 'Highlights disappear after the comment list refreshes',
    author: 'mira',
    state: 'open',
    body: 'When the comment list polls for new comments, the whole list is re-rendered and every highlight inside it is lost. The selection itself survives, so the anchors are still valid; only the drawn highlights go.',
    comments: [
      { author: 'tomas', text: 'Reproduced with the polling interval set to five seconds.' },
      {
        author: 'mira',
        text: 'The list uses the array index as the key, so every row is recreated on each poll.',
      },
    ],
  },
  {
    id: 102,
    title: 'Annotation on a collapsed thread anchors to the wrong reply',
    author: 'ines',
    state: 'open',
    body: 'If a thread is collapsed when the page loads, the hidden replies are not in the document, and an annotation made on the third reply ends up on the first visible one.',
    comments: [
      {
        author: 'ines',
        text: 'Expanding the thread before anchoring fixes it, which suggests the position offsets are counted over the rendered text only.',
      },
    ],
  },
  {
    id: 103,
    title: 'Sidebar does not scroll to an annotation inside a nested panel',
    author: 'tomas',
    state: 'closed',
    body: 'Clicking an annotation card scrolls the window but not the inner panel that actually contains the text, so the highlight stays out of view.',
    comments: [],
  },
  {
    id: 104,
    title: 'Emoji in a quote shifts the stored offsets by two',
    author: 'mira',
    state: 'open',
    body: 'A quote that follows an emoji is stored with offsets counted in UTF-16 code units. A client counting code points lands two characters early for every emoji before the quote.',
    comments: [
      {
        author: 'ines',
        text: 'This is the offset unit question from the text model; the fix is at the boundary, not in the guest.',
      },
    ],
  },
];

export function dataset(version: number): Issue[] {
  if (version === 1) return base;
  // Version 2: a real edit. 101 gets a new comment and a title tweak, 103 is
  // removed, 102 and 104 swap order, 104's body is corrected, and a new 105
  // appears first.
  const [i101, i102, , i104] = base as [Issue, Issue, Issue, Issue];
  return [
    {
      id: 105,
      title: 'Keyboard selection does not open the annotation toolbar',
      author: 'ines',
      state: 'open',
      body: 'Selecting text with Shift and the arrow keys leaves the toolbar closed; only a mouse selection opens it.',
      comments: [],
    },
    {
      ...i101,
      pinned: true,
      title: 'Highlights disappear after the comment list re-renders',
      comments: [
        ...i101.comments,
        {
          author: 'tomas',
          text: 'Switching to the comment id as the key keeps the rows and the highlights.',
        },
      ],
    },
    {
      ...i104,
      body: 'A quote that follows an emoji is stored with offsets counted in UTF-16 code units. A client counting Unicode code points lands two code units early for every emoji before the quote.',
    },
    i102,
  ];
}
