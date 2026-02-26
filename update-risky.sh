#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Fetching latest changes from origin..."
git fetch origin

echo "Updating all branch..."
git checkout all
git pull origin all

echo "Rebasing risky onto updated all..."
git checkout risky
git rebase all

echo "risky branch updated successfully!"
