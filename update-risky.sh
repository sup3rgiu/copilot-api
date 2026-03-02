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

echo "Rebasing risky onto updated all..."
git checkout risky
git rebase all

echo "risky branch updated successfully!"
