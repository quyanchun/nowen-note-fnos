#!/bin/bash
# Encoding diagnostic script
# Usage: ./check-encoding.sh [file_or_directory]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== Encoding Environment Check ==="
echo "LANG: $LANG"
echo "LC_ALL: $LC_ALL"
echo ""

# Check Python encoding
echo "=== Python Encoding ==="
python3 -c "
import sys, locale
print(f'Default encoding: {sys.getdefaultencoding()}')
print(f'Preferred encoding: {locale.getpreferredencoding()}')
print(f'Stdout encoding: {sys.stdout.encoding}')
print(f'Stderr encoding: {sys.stderr.encoding}')
"
echo ""

# Function to check a single file
check_file() {
    local file="$1"
    local encoding=$(file -I "$file" 2>/dev/null | grep -o 'charset=[^;]*' | cut -d= -f2)

    if [[ "$encoding" == "utf-8" ]] || [[ "$encoding" == "us-ascii" ]]; then
        echo -e "${GREEN}✓${NC} $file ($encoding)"
    else
        echo -e "${RED}✗${NC} $file ($encoding) - NEEDS CONVERSION"
    fi
}

# Check files
if [[ -n "$1" ]]; then
    if [[ -f "$1" ]]; then
        echo "=== File Encoding Check ==="
        check_file "$1"
    elif [[ -d "$1" ]]; then
        echo "=== Directory Encoding Check: $1 ==="
        find "$1" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.md" -o -name "*.json" \) | while read file; do
            check_file "$file"
        done
    else
        echo -e "${RED}Error: $1 not found${NC}"
        exit 1
    fi
else
    echo "=== Current Directory Encoding Check ==="
    find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.md" -o -name "*.json" \) -not -path "*/node_modules/*" -not -path "*/.git/*" | while read file; do
        check_file "$file"
    done
fi

echo ""
echo "=== Quick Fix Commands ==="
echo "To convert a file from GBK to UTF-8:"
echo "  iconv -f GBK -t UTF-8 file.tsx > file.tsx.utf8 && mv file.tsx.utf8 file.tsx"
echo ""
echo "To batch convert all GBK files in current directory:"
echo '  for f in $(find . -name "*.tsx" -exec file -I {} \; | grep gb2312 | cut -d: -f1); do'
echo '    iconv -f GBK -t UTF-8 "$f" > "$f.utf8" && mv "$f.utf8" "$f"'
echo "  done"
