# Using the GitHub Actions Workflow

## Important Note

**The GitHub Actions workflow will only appear in the Actions UI after this PR is merged to the default branch.** GitHub only displays `workflow_dispatch` workflows from the default branch, not from PR branches.

Until this PR is merged, please use the manual steps below.

## After PR is Merged - Automated Setup (Recommended)

After merging this PR to the default branch, the easiest way to complete the setup is to use the GitHub Actions workflow.

### Steps:

1. Go to the **Actions** tab in your GitHub repository:
   https://github.com/satvikOS/archdiscv1/actions

2. Select the **"Setup Default Branch"** workflow from the left sidebar

3. Click the **"Run workflow"** button (on the right side)

4. In the confirmation field, type: `confirm`

5. Click the green **"Run workflow"** button

The workflow will:
- ✅ Create the `copilot/create-archdisc-software` branch (if it doesn't exist)
- ✅ Push it to GitHub
- ✅ Set it as the default branch
- ✅ Verify the change

### Workflow Status

You can monitor the workflow execution in the Actions tab. It should complete in less than a minute.

### Troubleshooting

If the workflow fails:
- Ensure you have admin rights to the repository
- Check that the `GITHUB_TOKEN` has sufficient permissions
- Review the workflow logs for specific error messages

## Before PR is Merged - Manual Setup

If you need to set up the default branch before merging this PR, see:
- [SET_DEFAULT_BRANCH.md](SET_DEFAULT_BRANCH.md) for detailed manual instructions
- Run `./setup-default-branch.sh` from the command line

## What This Accomplishes

After running the workflow or manual steps:
- The `copilot/create-archdisc-software` branch will be available on GitHub
- It will be set as the repository's default branch
- New clones will automatically check out this branch
- New pull requests will target this branch by default
