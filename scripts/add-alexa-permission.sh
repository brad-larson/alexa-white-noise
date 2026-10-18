#!/bin/bash
# add-alexa-permission.sh — Run ONCE after the Alexa skill is created in the developer console.
# Required env vars: SKILL_ID, REGION (default us-east-1), FUNCTION_NAME (default alexa-white-noise)
set -euo pipefail

SKILL_ID="${SKILL_ID:?SKILL_ID env var required (amzn1.ask.skill.XXXXXX)}"
REGION="${REGION:-${AWS_REGION:-us-east-1}}"
FUNCTION_NAME="${FUNCTION_NAME:-alexa-white-noise}"

echo "Adding Alexa permission for Skill ID: $SKILL_ID"
aws lambda add-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id "alexa-skill-trigger" \
  --action "lambda:InvokeFunction" \
  --principal "alexa-appkit.amazon.com" \
  --event-source-token "$SKILL_ID" \
  --region "$REGION"

echo "✓ Done. Lambda now accepts invocations from Skill ID: $SKILL_ID"
