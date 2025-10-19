# Merging the `work` branch into `main`

Follow the steps below to bring the updated TaxiOps backend that lives on the `work` branch into your `main` branch.

## 1. Make sure your repository is clean
```bash
git status
```
If there are uncommitted changes, either commit or stash them before continuing.

## 2. Update your local branches
```bash
git fetch origin
```
This pulls the latest refs for all branches from the remote.

## 3. Switch to `main`
```bash
git checkout main
```
If `main` is behind the remote, fast-forward it:
```bash
git pull origin main
```

## 4. Merge `work` into `main`
```bash
git merge work
```
Resolve any merge conflicts that arise. Once resolved, stage the fixes and continue the merge:
```bash
git add <file(s)>
git commit
```
(If there are no conflicts, Git will complete the merge automatically.)

## 5. Run your verification checks
Run the same tests or lint commands you rely on to ensure the merged branch is healthy. For example:
```bash
npm test
```

## 6. Push the updated `main` branch
```bash
git push origin main
```

## 7. (Optional) Tag the release
If you maintain tags for deploys, create one now:
```bash
git tag -a vX.Y.Z -m "TaxiOps backend merge"
git push origin vX.Y.Z
```

You now have the TaxiOps backend changes integrated into `main`.
