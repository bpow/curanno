# Browser extension

A Manifest V3 extension for Chromium browsers that runs the guest in every frame of a tab, in place of the bookmarklet ([ADR 0023](../../docs/adr/0023-browser-extension.md)). The guest ships inside the extension and runs in its isolated world, so it works on pages whose Content-Security-Policy blocks the bookmarklet's script or the sidebar frame.

- **Toolbar button:** turns the guest on or off in the current tab. While it is on, every page and frame that loads in the tab gets a guest, cross-origin frames included, and the top frame shows the sidebar.
- **PDFs:** a PDF opened in a tab where the guest is on, or a PDF tab where the button is pressed, goes to the PDF viewer with the PDF's address.
- **Badge:** while the guest is on, the number of annotations the sidebar has anchored in the tab. While it is off, and only if turned on in the options, the number of public annotations on the page from an anonymous search. That sends every page address to the API.
- **Options:** the sidebar URL, the PDF viewer URL, public counts and the API origin they use. Right-click the button and choose Options.

The extension holds no token and no annotation content; sign-in stays in the sidebar (ADR 0019).

## Layout

| Path                    | Role                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| `src/background.ts`     | Service worker: per-tab state, injection, PDF redirect, badge                 |
| `src/content.ts`        | Content script: one guest per frame                                           |
| `src/settings.ts`       | Settings, their defaults and validation                                       |
| `src/pages.ts`          | PDF detection, viewer and search addresses, badge text                        |
| `src/options.*`         | Options page                                                                  |
| `src/manifest.json`     | Manifest; the build sets its version from `package.json`                      |
| `scripts/build.ts`      | esbuild bundle into `dist/`, with the guest and model bundled from source     |
| `scripts/icons.ts`      | Draws the toolbar icons at build time                                         |
| `test/browser/`         | Playwright tests of the built extension against the guest's fake sidebar      |

## Building and loading

```bash
pnpm --filter @curanno/extension build
```

writes the unpacked extension to `apps/extension/dist`. In Chrome open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick that folder. `pnpm --filter @curanno/extension dev` rebuilds on change; press the reload button on the extension's card afterwards.

The defaults point at the development stack: the sidebar from `just dev` at `http://localhost:3001/sidebar/` and the viewer from `pnpm --filter @curanno/pdf-viewer dev` at `http://localhost:5174/pdf/`. The development sidebar's `frame-ancestors` allows only `localhost` and `127.0.0.1` pages; set `VITE_FRAME_ANCESTORS` to annotate others.

For a deployment, set the sidebar URL to `https://<host>/sidebar/` and the viewer URL to `https://<pdf host>/pdf/`. The sidebar is framed by whatever page is open, so `FRAME_ANCESTORS` has to allow those pages: `https:` for extension users on any site.

## Tests

`pnpm test` runs the unit tests. `pnpm --filter @curanno/extension test:browser` builds the extension, loads it into Chromium (the full browser in headless mode, since the headless shell runs no extensions) and covers a page that allows no scripts, styles or frames, a cross-origin frame, navigation, the PDF redirect, both badge counts and the options page. It needs `pnpm --filter @curanno/guest exec playwright install chromium` once.
