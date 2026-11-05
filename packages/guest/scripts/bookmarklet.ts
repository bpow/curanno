/**
 * Prints the bookmarklet for a deployed guest bundle and sidebar.
 *
 *   pnpm --filter @curanno/guest bookmarklet --bundle-url https://curanno.example/guest.js \
 *       --sidebar-origin https://curanno.example [--sidebar-path /sidebar/] \
 *       [--pdf-viewer-url https://pdf.curanno.example/pdf/]
 */
// The built package: the scripts run under Node, which cannot load the
// library's TypeScript sources directly. `pnpm build` first.
import { bookmarkletUrl, type BookmarkletOptions } from '@curanno/guest';

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const bundleUrl = option(args, '--bundle-url');
const sidebarOrigin = option(args, '--sidebar-origin');
const sidebarPath = option(args, '--sidebar-path');
const pdfViewerUrl = option(args, '--pdf-viewer-url');
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
