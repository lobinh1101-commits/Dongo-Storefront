# Publish Dongo Storefront to GitHub

Git was not available in the `PATH` or standard Windows installation locations during the last workspace check, and this workspace did not contain a `.git` directory. No repository, commit, or remote was created. Install Git for Windows from the official distribution and open a new terminal before following this guide.

## 1. Review the ignore rules

The root `.gitignore` excludes `.env` files (except `.env.example`), SQLite/database files, SQL dumps, backups, credential/key files, dependency trees, build output, logs, ZIP handoff archives, and local editor state. Before staging, confirm there are no other private files in scope. Do not force-add ignored files.

```powershell
git check-ignore -v .env backend/data/storefront.sqlite
git status --short --ignored
```

If Git reports a real `.env`, database, backup, access token, or personal data as untracked, stop and fix the ignore rules before staging. Do not print or paste secret contents into a terminal capture.

## 2. Initialize and inspect the first commit

Only initialize the local repository after the owner has chosen the branch and confirmed that this workspace is the intended source:

```powershell
git init -b main
git status --short
git add --all
git diff --cached --name-only
git diff --cached --check
```

Review the complete staged file list. Confirm it contains no `.env`, SQLite/database files, backups/dumps, logs, build output, private keys, generated handoff ZIPs, or user data. If any sensitive file is staged, unstage only that exact path and update `.gitignore`; do not use a broad reset.

After review and test completion, create a commit:

```powershell
git commit -m "Prepare Dongo Storefront deployment"
```

## 3. Connect to GitHub and push

The project owner must first create or select a GitHub repository, supply/confirm its exact remote URL, choose public/private visibility, and authorize publishing. Do not guess a repository name, publish publicly by default, or push without this confirmation.

After the remote is confirmed:

```powershell
git remote add origin <confirmed-repository-url>
git remote -v
git push -u origin main
```

Use Git Credential Manager or an approved SSH key; never put a personal access token in a remote URL, command history, source file, or chat. Verify repository visibility, branch contents, and GitHub secret-scanning results after push.

## Owner actions still required

1. Install/enable Git for Windows and provide an approved workspace/repository workflow.
2. Review every staged path before the first commit.
3. Create/select the GitHub repository and confirm its exact URL and visibility.
4. Explicitly authorize the push and authenticate with a secure credential manager or SSH agent.
