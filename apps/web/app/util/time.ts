export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
