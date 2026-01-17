# Setting copilot/create-archdisc-software as Default Branch

## Current Status
- ✅ Branch `copilot/create-archdisc-software` has been created locally
- ⏳ Branch needs to be pushed to GitHub
- ⏳ Branch needs to be set as default on GitHub

## Steps to Complete

### Step 1: Push the branch to GitHub
Run the following command from the repository root:
```bash
git push -u origin copilot/create-archdisc-software
```

### Step 2: Set as Default Branch via GitHub UI
1. Go to: https://github.com/satvikOS/archdiscv1/settings/branches
2. Under "Default branch", click the switch icon (⇆)
3. Select `copilot/create-archdisc-software` from the dropdown
4. Click "Update"
5. Confirm the change in the dialog

### Step 3: Set as Default Branch via GitHub CLI (Alternative)
If you have `gh` CLI installed:
```bash
gh repo edit satvikOS/archdiscv1 --default-branch copilot/create-archdisc-software
```

### Step 4: Set as Default Branch via GitHub API (Alternative)
Using curl:
```bash
curl -X PATCH \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  https://api.github.com/repos/satvikOS/archdiscv1 \
  -d '{"default_branch":"copilot/create-archdisc-software"}'
```

## Verification
After completing the steps above, verify by:
1. Going to https://github.com/satvikOS/archdiscv1
2. The branch dropdown should show `copilot/create-archdisc-software` as the default
3. New clones will checkout this branch by default

## Notes
- You need admin/write access to the repository to change the default branch
- Changing the default branch affects new clones and pull requests
- Existing clones will need to run `git fetch` and `git checkout copilot/create-archdisc-software` to switch
