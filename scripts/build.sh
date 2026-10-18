#!/bin/bash
# build.sh — Package the Lambda function into a deployment zip
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."
LAMBDA_DIR="$PROJECT_DIR/lambda"
DIST_DIR="$PROJECT_DIR/dist"
ZIP_PATH="$DIST_DIR/lambda.zip"

mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"

echo "Building Lambda deployment package..."
cd "$LAMBDA_DIR"
zip -q "$ZIP_PATH" index.mjs package.json
echo "✓ Built: $ZIP_PATH ($(du -sh "$ZIP_PATH" | cut -f1))"
