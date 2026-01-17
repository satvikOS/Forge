#!/bin/bash
# Script to push copilot/create-archdisc-software branch and set it as default

set -e

echo "============================================"
echo "Setting up copilot/create-archdisc-software as default branch"
echo "============================================"
echo ""

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "❌ Error: Not in a git repository"
    exit 1
fi

# Check if the branch exists locally
if ! git show-ref --verify --quiet refs/heads/copilot/create-archdisc-software; then
    echo "❌ Error: Branch copilot/create-archdisc-software does not exist locally"
    echo "Creating branch from current HEAD..."
    git checkout -b copilot/create-archdisc-software
    echo "✅ Branch created"
fi

# Push the branch to GitHub
echo "📤 Pushing copilot/create-archdisc-software to GitHub..."
if git push -u origin copilot/create-archdisc-software; then
    echo "✅ Branch pushed successfully"
else
    echo "❌ Error: Failed to push branch"
    echo "   Make sure you have push access to the repository"
    exit 1
fi

echo ""
echo "============================================"
echo "Branch pushed successfully! ✅"
echo "============================================"
echo ""
echo "Next steps:"
echo "1. Go to: https://github.com/satvikOS/archdiscv1/settings/branches"
echo "2. Under 'Default branch', click the switch icon"
echo "3. Select 'copilot/create-archdisc-software'"
echo "4. Click 'Update' and confirm"
echo ""
echo "Or use GitHub CLI:"
echo "  gh repo edit satvikOS/archdiscv1 --default-branch copilot/create-archdisc-software"
echo ""
