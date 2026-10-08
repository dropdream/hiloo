export interface MarkdownLinkNode {
  type: string
  url?: string
  identifier?: string
  children?: MarkdownLinkNode[]
}

export function markdownLinkDestinations(tree: MarkdownLinkNode): string[] {
  const definitions = new Map<string, string>()
  const references: string[] = []
  const urls: string[] = []
  const pending = [tree]
  while (pending.length) {
    const node = pending.pop()!
    if (node.type === 'link' && node.url) urls.push(node.url)
    if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url)
    }
    if (node.type === 'linkReference' && node.identifier) references.push(node.identifier)
    if (node.children) pending.push(...node.children.slice().reverse())
  }
  return urls.concat(references.flatMap((id) => definitions.has(id) ? [definitions.get(id)!] : []))
}
