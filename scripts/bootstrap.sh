#!/bin/bash
# bootstrap.sh — One-time AWS setup for alexa-white-noise skill
# Run this ONCE as a user/role with broader AWS permissions (e.g., via AWS Console or admin credentials).
# After this runs, deploy.sh handles future code updates and needs only lambda:UpdateFunctionCode.
#
# What this script does:
#   1. Creates an S3 bucket for the audio file
#   2. Uploads the white noise MP3
#   3. Creates an IAM execution role for the Lambda
#   4. Creates the Lambda function
#   5. Adds the Alexa trigger permission to the Lambda
#
# Prerequisites:
#   - AWS CLI configured with a role that has: s3:CreateBucket, s3:PutObject,
#     s3:PutBucketPublicAccessBlock, iam:CreateRole, iam:AttachRolePolicy,
#     lambda:CreateFunction, lambda:AddPermission
#   - ffmpeg, to generate audio/white-noise-10min.mp3 if it is not there yet

set -euo pipefail

ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
REGION="${AWS_REGION:-us-east-1}"
BUCKET="alexa-white-noise-audio-${ACCOUNT_ID}"
AUDIO_KEY="white-noise-10min.mp3"
FUNCTION_NAME="alexa-white-noise"
EXEC_ROLE_NAME="alexa-white-noise-lambda-exec"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUDIO_FILE="$SCRIPT_DIR/../audio/white-noise-10min.mp3"
[ -f "$AUDIO_FILE" ] || bash "$SCRIPT_DIR/make-audio.sh"

echo "=== Alexa White Noise — One-time Bootstrap ==="
echo "Account: $ACCOUNT_ID | Region: $REGION | Bucket: $BUCKET"
echo ""

# ─── 1. Create S3 bucket ───────────────────────────────────────────────────
echo "--- [1/5] Creating S3 bucket: $BUCKET ---"
if [ "$REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
else
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"
fi

# Block public ACLs but allow public policy (needed for Alexa audio streaming)
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false"

# Allow public GET for the audio file
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {
      \"Sid\": \"AllowAlexaAudioRead\",
      \"Effect\": \"Allow\",
      \"Principal\": \"*\",
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::${BUCKET}/${AUDIO_KEY}\"
    }
  ]
}"
echo "✓ S3 bucket created."

# ─── 2. Upload audio file ──────────────────────────────────────────────────
echo "--- [2/5] Uploading audio file ---"
aws s3 cp "$AUDIO_FILE" "s3://${BUCKET}/${AUDIO_KEY}" \
  --region "$REGION" \
  --content-type "audio/mpeg"
AUDIO_URL="https://${BUCKET}.s3.${REGION}.amazonaws.com/${AUDIO_KEY}"
echo "✓ Audio uploaded. URL: $AUDIO_URL"

# ─── 3. Create Lambda execution role ──────────────────────────────────────
echo "--- [3/5] Creating Lambda execution role: $EXEC_ROLE_NAME ---"
aws iam create-role \
  --role-name "$EXEC_ROLE_NAME" \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'
aws iam attach-role-policy \
  --role-name "$EXEC_ROLE_NAME" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"

EXEC_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${EXEC_ROLE_NAME}"
echo "✓ Execution role created: $EXEC_ROLE_ARN"
echo "Waiting 10s for IAM to propagate..."
sleep 10

# ─── 4. Create Lambda function ─────────────────────────────────────────────
echo "--- [4/5] Creating Lambda function: $FUNCTION_NAME ---"
# Build the deployment zip first
cd "$SCRIPT_DIR/.."
bash scripts/build.sh
DEPLOY_ZIP="$SCRIPT_DIR/../dist/lambda.zip"

aws lambda create-function \
  --function-name "$FUNCTION_NAME" \
  --runtime nodejs20.x \
  --role "$EXEC_ROLE_ARN" \
  --handler index.handler \
  --zip-file "fileb://$DEPLOY_ZIP" \
  --environment "Variables={AUDIO_URL=${AUDIO_URL}}" \
  --timeout 10 \
  --memory-size 128 \
  --region "$REGION"
echo "✓ Lambda function created."

# ─── 5. Add Alexa trigger permission ──────────────────────────────────────
echo "--- [5/5] Adding Alexa invocation permission ---"
echo ""
echo "⚠  You need to add the Alexa Skill ID to the Lambda trigger."
echo "   Steps:"
echo "   1. Go to https://developer.amazon.com/alexa/console/ask"
echo "   2. Create a new skill named 'white noise', type: Custom, hosted: Provision your own"
echo "   3. In the skill's Endpoint section, copy the Skill ID (amzn1.ask.skill.XXXXXX)"
echo "   4. Then run:"
echo ""
echo "   SKILL_ID=amzn1.ask.skill.YOUR_SKILL_ID \\"
echo "   REGION=$REGION \\"
echo "   FUNCTION_NAME=$FUNCTION_NAME \\"
echo "   bash scripts/add-alexa-permission.sh"
echo ""
FUNCTION_ARN=$(aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" \
  --query 'Configuration.FunctionArn' --output text)
echo "   Lambda ARN (paste into Alexa skill endpoint): $FUNCTION_ARN"
echo ""
echo "=== Bootstrap complete! ==="
echo "AUDIO_URL=$AUDIO_URL"
echo "FUNCTION_ARN=$FUNCTION_ARN"
echo ""
echo "Next: follow Step 5 above to link the Alexa skill → Lambda."
