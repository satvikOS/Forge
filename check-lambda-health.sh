#!/bin/bash
# Lambda Health Check and Diagnostic Script

echo "🔍 Lambda Function Health Check"
echo "================================"

# Check if we can reach AWS
echo ""
echo "1. Testing AWS connectivity..."
if aws sts get-caller-identity 2>/dev/null; then
    echo "   ✅ AWS credentials valid"
else
    echo "   ❌ Cannot connect to AWS (expected in this environment)"
fi

# Check Lambda functions status
echo ""
echo "2. Lambda Functions to check:"
echo "   - archdisc-cad-dev-api"
echo "   - archdisc-cad-dev-orchestrate"

# Check API endpoint
echo ""
echo "3. Testing API endpoint..."
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" https://qmgj3s9wse.execute-api.us-east-1.amazonaws.com/dev/api/test 2>/dev/null)
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE")

echo "   HTTP Status: $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ API is responding"
    echo "   Response: $BODY"
    VERSION=$(echo "$BODY" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
    echo "   Version: $VERSION"
else
    echo "   ❌ API returned error status"
    echo "   Response: $BODY"
fi

# Check recent logs
echo ""
echo "4. Recent deployment info:"
echo "   Last commit: $(git log -1 --format='%h - %s')"
echo "   Branch: $(git branch --show-current)"

echo ""
echo "================================"
echo "Diagnostics complete"
