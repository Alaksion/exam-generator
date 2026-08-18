#!/usr/bin/env bash
# Bootstrap a single AWS account for GitHub Actions deploys.
#
#   usage: scripts/bootstrap-github-actions.sh <dev|staging|prod> [aws-profile] [region]
#
# Deploys bootstrap/template.yaml (OIDC provider + deploy role) to the given
# account and prints the exact secrets to wire into the matching GitHub
# environment. Run once per environment account, from the account's own profile.
set -euo pipefail

ENV=${1:?usage: bootstrap-github-actions.sh <dev|staging|prod> [aws-profile] [region]}
PROFILE=${2:-$ENV}
REGION=${3:-us-east-1}
STACK_NAME="exam-generator-github-bootstrap"

case "$ENV" in
  dev|staging|prod) ;;
  *) echo "Environment must be one of: dev, staging, prod" >&2; exit 2 ;;
esac

echo "==> Deploying bootstrap stack for '${ENV}' (profile '${PROFILE}', region '${REGION}')"
aws --profile "$PROFILE" --region "$REGION" cloudformation deploy \
  --template-file bootstrap/template.yaml \
  --stack-name "$STACK_NAME" \
  --parameter-overrides "Environment=${ENV}" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset

ROLE_ARN=$(aws --profile "$PROFILE" --region "$REGION" cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" \
  --output text)

echo
echo "==> Done. Wire the GitHub '${ENV}' environment:"
echo "gh secret set AWS_ROLE_TO_ASSUME --env '${ENV}' --body '${ROLE_ARN}'"
echo "gh secret set AWS_REGION        --env '${ENV}' --body '${REGION}'"
echo "gh secret set ALLOWED_ORIGINS   --env '${ENV}' --body '<your ${ENV} origin>'"
echo "gh secret set AUTH_CALLBACK_URL --env '${ENV}' --body '<your ${ENV} origin>/callback'"
echo "gh secret set AUTH_LOGOUT_URL   --env '${ENV}' --body '<your ${ENV} origin>'"
echo "gh secret set SIGNUP_MODE       --env '${ENV}' --body 'open'   # or invite"
echo "gh secret set BETA_ALLOWLIST    --env '${ENV}' --body ''"