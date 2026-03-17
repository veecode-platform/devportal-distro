import { isMap, isScalar, isSeq } from 'yaml';

/**
 * Recursively convert YAML collection nodes to block style and
 * double-quote scalar strings containing '!' (YAML tag indicator).
 * This ensures output is valid for strict parsers and IDEs.
 */
export function toBlockStyle(node: unknown): void {
  if (isSeq(node) || isMap(node)) {
    (node as any).flow = false;
    for (const item of (node as any).items) {
      if (item && typeof item === 'object' && 'key' in item) {
        toBlockStyle(item.key);
        toBlockStyle(item.value);
      } else {
        toBlockStyle(item);
      }
    }
  }
  if (isScalar(node) && typeof node.value === 'string' && node.value.includes('!')) {
    node.type = 'QUOTE_DOUBLE';
  }
}
