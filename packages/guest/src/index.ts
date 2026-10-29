/**
 * In-page guest. Framework-free by decision (ADR 0008). The anchoring base
 * is chosen by the Phase 2 trial; this entry point only proves the package
 * builds against DOM types.
 */
export function isAnnotatable(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE;
}
