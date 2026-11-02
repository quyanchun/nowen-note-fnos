import type { Fragment } from "@tiptap/pm/model";

export function serializeProseMirrorPlainText(content: Fragment): string {
  return content.textBetween(0, content.size, "\n", "\n");
}
