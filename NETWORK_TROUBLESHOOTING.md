# Network Connectivity Troubleshooting Guide

## Issue: Cannot Connect to Google Gemini API

### Symptoms
- "Failed to generate design" error in ArchDisc
- No requests appearing in Google AI Studio
- Error message: `fetch failed` or `Error fetching from https://generativelanguage.googleapis.com`

### Root Cause
Your deployment environment cannot make outbound HTTPS requests to Google's Gemini API servers.

---

## Diagnostic Tool

Run this to identify the exact issue:

```bash
cd backend
node test-connection.js
```

### Expected Output When Working
```
✅ API Key present: true
✅ Service configured: true  
✅ API Connection Successful!
🎉 All systems operational!
```

### Current Output (Network Issue)
```
✅ API Key present: true
✅ Service configured: true
❌ API Connection Failed: fetch failed
  Error: Cannot reach generativelanguage.googleapis.com
```

---

## Solutions by Environment

### 🏠 Local Development (Localhost)

#### 1. Test Basic Connectivity
```bash
# Test if you can reach Google's API
curl -v https://generativelanguage.googleapis.com

# Should return HTTP response (even 404 is OK)
# If it hangs or fails, network is blocked
```

#### 2. Check Firewall
```bash
# macOS
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --listapps

# Linux (UFW)
sudo ufw status

# Windows
# Open Windows Defender Firewall → Allow an app
```

#### 3. Disable VPN Temporarily
```bash
# If using VPN, disable it temporarily to test
# If this fixes it, configure VPN to allow Google APIs
```

#### 4. Check Antivirus
```
Some antivirus software blocks outbound API calls.
Temporarily disable to test, then add exception for Node.js.
```

---

### ☁️ Cloud Deployment (Vercel/Netlify/etc)

#### Vercel

Vercel serverless functions **should** allow outbound HTTPS by default.

**If blocked:**

1. **Check Vercel project settings:**
   - Vercel Dashboard → Project → Settings
   - No additional configuration usually needed

2. **Verify environment variables:**
   ```bash
   vercel env pull
   # Check .env.local has GEMINI_API_KEY
   ```

3. **Check function region:**
   ```json
   // vercel.json
   {
     "functions": {
       "api/*.js": {
         "includeFiles": "**",
         "memory": 1024
       }
     }
   }
   ```

4. **Deploy with logs:**
   ```bash
   vercel --debug
   ```

#### Netlify

1. **Enable external API access:**
   - Netlify Dashboard → Site Settings → Functions
   - External networking should be enabled by default

2. **Check build settings:**
   ```toml
   # netlify.toml
   [build]
     functions = "netlify/functions"
   
   [[headers]]
     for = "/*"
     [headers.values]
       X-Frame-Options = "DENY"
   ```

3. **Environment variables:**
   - Site Settings → Build & Deploy → Environment Variables
   - Add `GEMINI_API_KEY`

---

### 🐳 Docker Container

#### 1. Check Container Network Mode
```yaml
# docker-compose.yml
services:
  backend:
    network_mode: "bridge"  # Not "none"
    # OR
    networks:
      - default
```

#### 2. Test from Inside Container
```bash
docker exec -it <container-id> bash
curl https://generativelanguage.googleapis.com

# If this fails, check network mode
```

#### 3. Add DNS Configuration
```yaml
# docker-compose.yml
services:
  backend:
    dns:
      - 8.8.8.8
      - 8.8.4.4
```

---

### 🚀 AWS (EC2/Lambda/etc)

#### EC2 Instance

1. **Check Security Group:**
   ```
   AWS Console → EC2 → Security Groups
   Outbound Rules → Should allow:
   - Type: HTTPS
   - Protocol: TCP
   - Port: 443
   - Destination: 0.0.0.0/0 (or specific to Google IPs)
   ```

2. **Check Network ACL:**
   ```
   VPC → Network ACLs
   Outbound Rules → Should allow HTTPS traffic
   ```

3. **Verify Internet Gateway:**
   ```
   VPC → Internet Gateways
   Ensure attached to your VPC
   ```

#### Lambda Function

1. **VPC Configuration:**
   ```
   If Lambda is in VPC, it needs:
   - NAT Gateway for internet access
   - Or VPC endpoint for AWS services
   ```

2. **IAM Permissions:**
   ```json
   {
     "Effect": "Allow",
     "Action": [
       "logs:CreateLogGroup",
       "logs:CreateLogStream",
       "logs:PutLogEvents"
     ],
     "Resource": "*"
   }
   ```

3. **Timeout Settings:**
   ```javascript
   // Increase timeout for API calls
   exports.handler = async (event) => {
     // Set timeout to 30s minimum
   };
   ```

---

### 🔒 Corporate Network / Firewall

#### 1. Request Firewall Rule
```
Domain to whitelist: generativelanguage.googleapis.com
Port: 443 (HTTPS)
Protocol: TCP
Purpose: Google Gemini AI API access
```

#### 2. Use Proxy
```bash
# Set proxy environment variables
export HTTPS_PROXY=http://proxy.company.com:8080
export HTTP_PROXY=http://proxy.company.com:8080

# Then start server
npm start
```

#### 3. Configure Proxy in Code
```javascript
// backend/services/geminiService.js
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

constructor() {
  // ... existing code ...
  
  if (process.env.HTTPS_PROXY) {
    const agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
    this.genAI = new GoogleGenerativeAI(this.apiKey, { agent });
  } else {
    this.genAI = new GoogleGenerativeAI(this.apiKey);
  }
}
```

---

## Testing After Fix

### 1. Run Connection Test
```bash
cd backend
node test-connection.js
```

### 2. Test with curl
```bash
# Should get a response (even 404 is OK)
curl -v https://generativelanguage.googleapis.com
```

### 3. Check Server Logs
```bash
npm start

# Should see:
# ✅ Gemini Service ready to make API requests
# NOT: ⚠️  Running in DEMO MODE
```

### 4. Try Simple Design
```
In ArchDisc interface:
1. Enter: "design a simple cube"
2. Click Generate
3. Check backend logs for API call details
```

---

## Still Not Working?

### Enable Maximum Logging

```javascript
// backend/server.js - Add at top
process.env.DEBUG = 'axios:*';
console.log('All environment variables:', process.env);
```

### Check Google Cloud Console

1. **Go to:** https://console.cloud.google.com
2. **Navigate to:** APIs & Services → Enabled APIs
3. **Verify:** "Generative Language API" is enabled
4. **Check:** API quotas and limits

### Verify API Key

1. **Go to:** https://makersuite.google.com/app/apikey
2. **Check:** Your API key is listed and not expired
3. **Test:** Copy key and paste in backend/.env
4. **Regenerate:** If unsure, create a new key

### Contact Support

If all else fails:

1. **Google AI Studio:** Check dashboard for error messages
2. **Cloud Provider:** Check their support docs for outbound API access
3. **Network Admin:** Request assistance with firewall configuration

---

## Success Indicators

When connectivity is fixed, you'll see:

```bash
# In connection test
✅ API Connection Successful!
  Response received: connected

# In backend logs
📡 Making API call to Google Gemini...
✅ Success on attempt 1!
📊 Response length: 1234

# In Google AI Studio
Recent requests will appear in your dashboard
```

---

## Environment-Specific Notes

### Development vs Production

```bash
# Development (localhost)
GEMINI_API_KEY=your_key_here
# Usually no network restrictions

# Production (deployed)
GEMINI_API_KEY=your_key_here
# May need firewall rules, security groups, etc.
```

### Free Tier Limits

Google AI Studio free tier:
- 60 requests per minute
- Possible quota limits
- Check dashboard for current usage

---

## Quick Reference

| Environment | Common Issue | Solution |
|-------------|--------------|----------|
| Localhost | VPN/Firewall | Disable VPN, check firewall |
| Vercel | None usually | Check env vars |
| AWS EC2 | Security Group | Add outbound HTTPS rule |
| Docker | Network mode | Use bridge mode, add DNS |
| Corporate | Firewall | Request whitelist for domain |
| Lambda | VPC without NAT | Add NAT Gateway or remove VPC |

---

**Need Help?** Run `node backend/test-connection.js` and share the output for specific guidance.
