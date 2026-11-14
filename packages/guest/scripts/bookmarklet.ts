/**
 * Prints the bookmarklet for a deployed guest bundle and sidebar.
 *
 *   pnpm --filter @curanno/guest bookmarklet --bundle-url https://curanno.example/guest.js \
 *       --sidebar-origin https://curanno.example [--sidebar-path /sidebar/] \
 *       [--pdf-viewer-url https://pdf.curanno.example/pdf/]
 */
// The built package: the scripts run under Node, which cannot load the
// library's TypeScript sources directly. `pnpm build` first.
import { parseArgs } from 'node:util';
import { bookmarkletUrl, type BookmarkletOptions } from '@curanno/guest';

const { values: args } = parseArgs({
  // pnpm passes on the `--` in `pnpm <script> -- --flag`.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    'bundle-url': { type: 'string' },
    'sidebar-origin': { type: 'string' },
    'sidebar-path': { type: 'string' },
    'pdf-viewer-url': { type: 'string' },
  },
});
const bundleUrl = args['bundle-url'];
const sidebarOrigin = args['sidebar-origin'];
const sidebarPath = args['sidebar-path'];
const pdfViewerUrl = args['pdf-viewer-url'];
if (!bundleUrl || !sidebarOrigin) {
  console.error(
    'usage: bookmarklet --bundle-url <url> --sidebar-origin <origin> [--sidebar-path <path>] [--pdf-viewer-url <url>]',
  );
  process.exit(2);
}
const options: BookmarkletOptions = { bundleUrl, sidebarOrigin };
if (sidebarPath) options.sidebarPath = sidebarPath;
if (pdfViewerUrl) options.pdfViewerUrl = pdfViewerUrl;
console.log(bookmarkletUrl(options));
