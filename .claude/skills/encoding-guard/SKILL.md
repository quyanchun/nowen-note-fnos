---
name: encoding-guard
description: Prevent garbled text (乱码) when editing code and comments. Use this skill whenever reading, writing, or modifying files to ensure proper UTF-8 encoding handling. Activates on any file edit operation, especially when working with Chinese characters, emoji, or non-ASCII content.
---

# Encoding Guard

Ensures all file operations use proper UTF-8 encoding to prevent garbled text (乱码).

## Core Principles

1. **Always use UTF-8** — Read and write files with explicit UTF-8 encoding
2. **Validate before write** — Check that content is valid UTF-8 before saving
3. **Preserve BOM awareness** — Detect and handle BOM (Byte Order Mark) when present
4. **Handle mixed encoding** — Convert legacy encodings (GBK, GB2312, Big5) to UTF-8

## When Reading Files

```bash
# Always specify encoding when reading
cat -n file.tsx  # Use Read tool which handles encoding

# If you suspect encoding issues, check with:
file -I file.tsx  # Shows charset
hexdump -C file.tsx | head -5  # Inspect raw bytes
```

## When Writing Files

```bash
# Ensure locale supports UTF-8
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# When using Edit tool, the content is already validated
# When using Write tool, ensure content is proper UTF-8
```

## Detection Patterns

Watch for these signs of encoding problems:

1. **Mojibake characters**: `Ã©`, `Ã¨`, `Ã¼` (UTF-8 read as Latin-1)
2. **Chinese garbled**: `锟斤拷`, `烫烫烫`, `屯屯屯` (GBK/UTF-8 mismatch)
3. **Replacement character**: `�` (U+FFFD) — missing or invalid bytes
4. **Question marks**: `???` where Chinese should be

## Fix Strategies

### Strategy 1: Re-read with correct encoding

If a file shows garbled text:

```bash
# Check current encoding
file -I problematic.tsx

# If it's GBK, convert to UTF-8
iconv -f GBK -t UTF-8 problematic.tsx > fixed.tsx
mv fixed.tsx problematic.tsx
```

### Strategy 2: Use Read tool with encoding awareness

The Read tool automatically handles encoding. If you see garbled output:

1. Stop and check the file's actual encoding
2. Convert if needed before editing
3. Then proceed with normal Read/Edit operations

### Strategy 3: Validate after write

After any Edit or Write operation:

```bash
# Quick validation
python3 -c "
with open('file.tsx', 'r', encoding='utf-8') as f:
    content = f.read()
    print(f'Valid UTF-8: {len(content)} chars')
"
```

## Common Scenarios

### Scenario 1: Editing TypeScript/JSX with Chinese comments

```typescript
// ✅ Correct: UTF-8 encoded comment
// 这是一个中文注释

// ❌ Wrong: Encoding mismatch causes garbled
// 杩欐槸涓€涓�腑鏂囨敞閲�
```

**Action**: Always use UTF-8 locale. Set in shell:
```bash
export LANG=en_US.UTF-8
```

### Scenario 2: Mixed encoding in project

If some files are GBK and others UTF-8:

```bash
# Find all non-UTF-8 files
find . -name "*.tsx" -exec file -I {} \; | grep -v utf-8

# Batch convert
for f in $(find . -name "*.tsx" -exec file -I {} \; | grep gb2312 | cut -d: -f1); do
    iconv -f GBK -t UTF-8 "$f" > "$f.utf8"
    mv "$f.utf8" "$f"
done
```

### Scenario 3: Git shows encoding warnings

```bash
# Configure git to handle encoding
git config core.quotepath false  # Show Chinese filenames correctly
git config i18n.commitencoding utf-8
git config i18n.logoutputencoding utf-8
```

## Prevention Checklist

Before any file operation:

- [ ] Locale is set to UTF-8 (`echo $LANG` should show `*.UTF-8`)
- [ ] File encoding is verified (`file -I filename`)
- [ ] Content being written is valid UTF-8
- [ ] Editor/IDE is configured for UTF-8

## Quick Diagnostic

Run this to check your environment:

```bash
echo "Locale: $LANG"
echo "LC_ALL: $LC_ALL"
python3 -c "import sys; print(f'Default encoding: {sys.getdefaultencoding()}')"
python3 -c "import locale; print(f'Preferred encoding: {locale.getpreferredencoding()}')"
```

Expected output:
```
Locale: en_US.UTF-8
LC_ALL: en_US.UTF-8
Default encoding: utf-8
Preferred encoding: UTF-8
```

## Integration with Tools

### Read Tool
- Automatically detects and handles encoding
- If garbled, the file may need conversion first

### Edit Tool
- Content parameter must be valid UTF-8
- Tool validates encoding before applying changes

### Write Tool
- Content parameter must be valid UTF-8
- Overwrites file with UTF-8 encoding

### Bash Tool
- Set locale before commands: `LANG=en_US.UTF-8 command`
- Pipe through `iconv` if needed: `command | iconv -f GBK -t UTF-8`
