import type { KnowledgeTreeNode } from "./knowledgeTree.js";

export function folderProtected(node: KnowledgeTreeNode, nodes: Map<string, KnowledgeTreeNode>): boolean {
  const seen = new Set<string>();
  let current: KnowledgeTreeNode | undefined = node;
  while (current) {
    if (seen.has(current.id)) return true;
    seen.add(current.id);
    if (current.isPasswordProtected) return true;
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
  return false;
}

export function folderPathParts(node: KnowledgeTreeNode, byId: Map<string, KnowledgeTreeNode>): string[] {
  const names = [node.title];
  const seen = new Set([node.id]);
  let parent = node.parentId ? byId.get(node.parentId) : undefined;
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id); names.unshift(parent.title);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return names;
}

export function pathOf(node: KnowledgeTreeNode, byId: Map<string, KnowledgeTreeNode>): string {
  return folderPathParts(node, byId).join(" / ");
}
