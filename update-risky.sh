#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Fetching latest changes from upstream (caozhiyuan/copilot-api)..."
git fetch upstream

echo "Updating all branch from upstream..."
git checkout all
git rebase upstream/all

echo "Pushing updated all to origin..."
git push origin all --force-with-lease

echo "Merging all into risky..."
git checkout risky
git merge all

echo "Pushing risky to origin..."
git push origin risky

echo "risky branch updated successfully!"
