const taskMarkerPattern = /^(\s*(?:[-+*]|\d+[.)])\s+\[)([ xX])(\])/;

export interface MarkdownTaskCheckboxChange {
  from: number;
  to: number;
  insert: "x" | " ";
  checked: boolean;
}

export function applyMarkdownTaskCheckboxChange(
  markdown: string,
  change: MarkdownTaskCheckboxChange,
): string {
  return markdown.slice(0, change.from) + change.insert + markdown.slice(change.to);
}

export function getMarkdownTaskCheckboxChange(
  markdown: string,
  taskIndex: number,
  checked: boolean,
): MarkdownTaskCheckboxChange | null {
  if (taskIndex < 0) return null;

  let seenTasks = 0;
  let lineOffset = 0;
  for (const line of markdown.split("\n")) {
    const match = line.match(taskMarkerPattern);
    if (match) {
      if (seenTasks === taskIndex) {
        const from = lineOffset + match[1].length;
        return {
          from,
          to: from + 1,
          insert: checked ? "x" : " ",
          checked,
        };
      }
      seenTasks += 1;
    }
    lineOffset += line.length + 1;
  }

  return null;
}

export function getMarkdownTaskCheckboxChangeAtOffset(
  markdown: string,
  offset: number,
): MarkdownTaskCheckboxChange | null {
  if (offset < 0) return null;

  let lineOffset = 0;
  for (const line of markdown.split("\n")) {
    const match = line.match(taskMarkerPattern);
    if (match) {
      const markerFrom = lineOffset + match[1].length;
      const bracketFrom = markerFrom - 1;
      const bracketTo = markerFrom + 2;
      if (offset >= bracketFrom && offset <= bracketTo) {
        const checked = !/[xX]/.test(match[2]);
        return {
          from: markerFrom,
          to: markerFrom + 1,
          insert: checked ? "x" : " ",
          checked,
        };
      }
    }
    lineOffset += line.length + 1;
  }

  return null;
}

export function toggleMarkdownTaskCheckbox(markdown: string, taskIndex: number, checked: boolean): string {
  const change = getMarkdownTaskCheckboxChange(markdown, taskIndex, checked);
  return change ? applyMarkdownTaskCheckboxChange(markdown, change) : markdown;
}
