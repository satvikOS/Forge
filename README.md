# archdiscv1

## Default Branch Setup

This repository will use `copilot/create-archdisc-software` as the default branch.

### Quick Setup (After Merging This PR)

**Step 1: Create and push the branch**
```bash
# From the repository root
git checkout copilot/make-default-branch-push
git checkout -b copilot/create-archdisc-software
git push origin copilot/create-archdisc-software
```

**Step 2: Set as default branch**

Option A - GitHub UI:
1. Go to https://github.com/satvikOS/archdiscv1/settings/branches
2. Click the switch icon next to "Default branch"
3. Select `copilot/create-archdisc-software`
4. Click "Update" and confirm

Option B - GitHub CLI:
```bash
gh repo edit satvikOS/archdiscv1 --default-branch copilot/create-archdisc-software
```

### Alternative: Use the Shell Script

After merging this PR, you can also use the provided script:
```bash
./setup-default-branch.sh
```

### Note About GitHub Actions Workflow

The workflow `setup-default-branch.yml` will only appear in the Actions UI after this PR is merged to the default branch. Until then, use the manual steps above.

See [SET_DEFAULT_BRANCH.md](SET_DEFAULT_BRANCH.md) for more detailed instructions.