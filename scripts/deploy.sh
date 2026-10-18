#!/bin/bash
# deploy.sh — Update the existing Lambda function code + environment
# Needs only update permissions on the function; run bootstrap.sh first if it does not exist.
# Uses whatever AWS_PROFILE / credentials are in the environment.
set -euo pipefail

REGION="${REGION:-${AWS_REGION:-us-east-1}}"
FUNCTION_NAME="${FUNCTION_NAME:-alexa-white-noise}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."

# Build the zip
bash "$SCRIPT_DIR/build.sh"
ZIP_PATH="$PROJECT_DIR/dist/lambda.zip"

echo "Deploying $FUNCTION_NAME to $REGION..."

# Update function code
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file "fileb://$ZIP_PATH" \
  --region "$REGION"

# Wait for update to complete
echo "Waiting for update to complete..."
aws lambda wait function-updated \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION"

echo "✓ Deployed successfully."

# Optionally update AUDIO_URL if passed as env
if [ -n "${AUDIO_URL:-}" ]; then
  echo "Updating AUDIO_URL environment variable..."
  # Merge into the existing variables: --environment replaces the whole set,
  # which would drop SLACK_WEBHOOK_URL and DEVICE_NAME_MAP_JSON.
  ENV_JSON=$(aws lambda get-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --query 'Environment.Variables' --output json \
    | AUDIO_URL="$AUDIO_URL" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s)||{};v.AUDIO_URL=process.env.AUDIO_URL;console.log(JSON.stringify({Variables:v}))})')
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "$ENV_JSON" \
    --region "$REGION"
  echo "✓ AUDIO_URL updated."
fi

# Show current state
aws lambda get-function \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --query 'Configuration.{State:State,LastModified:LastModified,FunctionArn:FunctionArn}' \
  --output table
