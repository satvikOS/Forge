# Step-by-Step Vercel Project Setup for ArchDisc

This guide provides detailed instructions with screenshots for setting up ArchDisc on Vercel from scratch.

---

## Prerequisites

Before starting, ensure you have:
- [ ] A GitHub account with access to the `satvikOS/archdiscv1` repository
- [ ] A Vercel account (free tier is sufficient)
- [ ] (Optional) OpenAI API key if you want AI features beyond demo mode

---

## Method 1: Deploy via Vercel Dashboard (Recommended for First-Time Users)

### Step 1: Sign Up / Log In to Vercel

1. Go to [https://vercel.com](https://vercel.com)
2. Click **"Sign Up"** or **"Log In"**
3. Choose **"Continue with GitHub"** for easiest integration
4. Authorize Vercel to access your GitHub account

**Screenshot Guide:**
```
Vercel Homepage → Click "Sign Up" → Select "Continue with GitHub"
```

---

### Step 2: Import Your Repository

1. Once logged in, you'll see the Vercel Dashboard
2. Click the **"Add New..."** button (top right)
3. Select **"Project"** from the dropdown

**What you'll see:**
```
Dashboard → Add New... → Project
```

4. On the "Import Git Repository" page:
   - Click **"Import"** next to the GitHub icon
   - If this is your first time, click **"Add GitHub Account"**
   - Select your GitHub account or organization (`satvikOS`)

5. Find `archdiscv1` repository:
   - Use the search bar if you have many repos
   - Click **"Import"** next to `satvikOS/archdiscv1`

**Navigation Path:**
```
Import Git Repository → Add GitHub Account → Select satvikOS → Find archdiscv1 → Click Import
```

---

### Step 3: Configure Project Settings

Vercel will auto-detect your project configuration from `vercel.json`, but let's verify:

#### 3.1 Project Name
- **Project Name:** `archdisc` (or your preferred name)
- This becomes your URL: `archdisc.vercel.app`

#### 3.2 Framework Preset
- **Framework Preset:** Should auto-detect as "Other" or "Vite"
- Leave as detected (Vercel will use our `vercel.json` config)

#### 3.3 Root Directory
- **Root Directory:** `.` (current directory - leave as is)
- ✅ Keep it as the repository root

#### 3.4 Build and Output Settings

The following should be pre-configured by `vercel.json`, but verify:

| Setting | Value | Notes |
|---------|-------|-------|
| **Build Command** | `cd frontend && npm install && npm run build` | Auto-detected from config |
| **Output Directory** | `frontend/dist` | Where Vite outputs the build |
| **Install Command** | `npm install` | Default is fine |

**Don't change these unless needed** - our `vercel.json` handles the monorepo setup automatically.

---

### Step 4: Add Environment Variables

This is the most important step! Click on **"Environment Variables"** section:

#### Required Variables:

Add these one by one by clicking **"Add"**:

**1. NODE_ENV**
```
Key: NODE_ENV
Value: production
Environment: Production
```

**2. OPENAI_API_KEY**
```
Key: OPENAI_API_KEY
Value: demo-mode
Environment: Production
```
> 💡 **Tip:** Use `demo-mode` to start without OpenAI API. Replace with your actual OpenAI API key (starts with `sk-`) later if you want real AI features.

**3. PORT**
```
Key: PORT
Value: 5000
Environment: Production
```

**4. VITE_API_URL**
```
Key: VITE_API_URL
Value: /
Environment: Production
```
> 💡 **Note:** We'll update this after first deployment to use your actual Vercel URL.

**5. ALLOWED_ORIGINS** (Optional but recommended)
```
Key: ALLOWED_ORIGINS
Value: https://archdisc.vercel.app,https://archdisc-*.vercel.app
Environment: Production
```
> 💡 Replace `archdisc` with your actual project name.

#### How to Add Each Variable:

```
1. Click "+ Add" or "New Variable"
2. Enter Key (e.g., "NODE_ENV")
3. Enter Value (e.g., "production")
4. Select Environment: "Production" (check the box)
5. Click "Add" to confirm
6. Repeat for each variable
```

**Screenshot Guide:**
```
Configure Project → Environment Variables → Add → 
  Enter Key & Value → Select Production → Add
```

---

### Step 5: Deploy!

1. Review your settings:
   - ✅ Project name looks good
   - ✅ Environment variables are set
   - ✅ Build settings detected

2. Click the big blue **"Deploy"** button

3. Watch the deployment process:
   - **Installing dependencies** (~30 seconds)
   - **Building frontend** (~1-2 minutes)
   - **Deploying serverless functions** (~30 seconds)
   - **Total time:** ~2-3 minutes

**What you'll see:**
```
Building... → [Progress bar with logs]
→ Installing Build: Running "npm install"
→ Building Application: Running "vite build"
→ Uploading Build Output
→ Assigning Domain
```

---

### Step 6: Post-Deployment Configuration

#### 6.1 Get Your Deployment URL

Once deployed, you'll see:
```
🎉 Congratulations! Your project is live at:
https://archdisc-abc123.vercel.app
```

**Copy this URL** - you'll need it for the next step.

#### 6.2 Update VITE_API_URL (Important!)

1. Go to your project dashboard
2. Click **"Settings"** tab
3. Click **"Environment Variables"** in sidebar
4. Find `VITE_API_URL`
5. Click the **"⋮"** menu → **"Edit"**
6. Change value from `/` to your actual URL:
   ```
   https://archdisc-abc123.vercel.app
   ```
7. Click **"Save"**

#### 6.3 Redeploy with Updated URL

1. Go to **"Deployments"** tab
2. Click **"Redeploy"** on the top-right
3. Select **"Use existing Build Cache"**
4. Click **"Redeploy"**

This ensures the frontend knows the correct API endpoint.

---

### Step 7: Verify Your Deployment

#### 7.1 Test the Application

Visit your Vercel URL: `https://your-app.vercel.app`

**You should see:**
- ✅ Dark theme workbench interface
- ✅ Orange accent colors
- ✅ 3D canvas with grid
- ✅ Bottom prompt bar
- ✅ "Ready" status indicator

#### 7.2 Test API Health

Visit: `https://your-app.vercel.app/api/health`

**Expected response:**
```json
{
  "status": "ok",
  "message": "ArchDisc API is running"
}
```

#### 7.3 Generate a Design

1. Enter in prompt bar: `"Design a modern sports car"`
2. Click the orange arrow button (↑)
3. Wait 5-10 seconds
4. You should see:
   - ✅ 3D car model appears (body + wheels)
   - ✅ Properties panel shows specifications
   - ✅ Analysis tab shows structural data
   - ✅ Compliance tab shows regulatory info

**If you see this, congratulations! 🎉 Your deployment is successful!**

---

## Method 2: Deploy via Vercel CLI

For developers who prefer command-line tools.

### Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

Verify installation:
```bash
vercel --version
# Should output: Vercel CLI 28.x.x
```

---

### Step 2: Login to Vercel

```bash
vercel login
```

Follow the prompts:
1. Enter your email
2. Check your email for verification code
3. Enter the code in terminal

**You'll see:**
```
> Enter your email: your-email@example.com
> We sent an email to your-email@example.com. Please follow the steps provided.
✓ Email confirmed
```

---

### Step 3: Navigate to Repository

```bash
cd /path/to/archdiscv1
```

Verify you're in the right place:
```bash
ls -la
# Should see: backend/ frontend/ vercel.json README.md
```

---

### Step 4: Initial Deployment

Run the deploy command:

```bash
vercel
```

**Follow the interactive prompts:**

```
? Set up and deploy "~/archdiscv1"? [Y/n] 
→ Press Y

? Which scope do you want to deploy to?
→ Select your account (use arrow keys, press Enter)

? Link to existing project? [y/N]
→ Press N (we're creating a new project)

? What's your project's name?
→ Enter: archdisc (or your preferred name)

? In which directory is your code located?
→ Press Enter (uses ./ current directory)
```

Vercel will then:
1. Upload your code
2. Detect `vercel.json` configuration
3. Build the project
4. Deploy both frontend and backend

**Output looks like:**
```
🔍  Inspect: https://vercel.com/your-name/archdisc/xxx [2s]
✅  Production: https://archdisc.vercel.app [4m]
```

---

### Step 5: Add Environment Variables via CLI

Add each required environment variable:

```bash
# Add NODE_ENV
vercel env add NODE_ENV production
# When prompted, enter: production

# Add OPENAI_API_KEY
vercel env add OPENAI_API_KEY production
# When prompted, enter: demo-mode

# Add PORT
vercel env add PORT production
# When prompted, enter: 5000

# Add VITE_API_URL (use your actual Vercel URL)
vercel env add VITE_API_URL production
# When prompted, enter: https://archdisc.vercel.app
```

**For each command:**
```
? What's the value of VARIABLE_NAME?
→ Enter the value
✓ Added Environment Variable VARIABLE_NAME to Project archdisc
```

---

### Step 6: Deploy to Production

Now deploy with all environment variables:

```bash
vercel --prod
```

**What happens:**
```
🔍  Inspect: https://vercel.com/your-name/archdisc/xxx [2s]
✅  Production: https://archdisc-prod.vercel.app [3m]
```

Your production URL is now live!

---

### Step 7: CLI Management Commands

Useful commands for ongoing management:

```bash
# View deployment logs
vercel logs https://archdisc.vercel.app

# List all deployments
vercel ls

# View project info
vercel inspect

# View environment variables
vercel env ls

# Pull environment variables locally
vercel env pull

# Alias deployment to custom domain
vercel alias set archdisc-abc123.vercel.app your-domain.com

# Remove a deployment
vercel remove archdisc-old-deployment.vercel.app
```

---

## Troubleshooting Common Issues

### Issue 1: Build Fails - "Cannot find module 'vite'"

**Error:**
```
Error: Cannot find module 'vite'
```

**Solution:**
1. Go to Settings → General → Build & Development Settings
2. Ensure Install Command is: `npm install`
3. Ensure Build Command includes: `cd frontend && npm install && npm run build`
4. Redeploy

---

### Issue 2: API Routes Return 404

**Error:**
```
GET /api/health → 404 Not Found
```

**Solution:**
1. Check `vercel.json` exists in repository root
2. Verify routes configuration:
   ```json
   "routes": [
     { "src": "/api/(.*)", "dest": "backend/server.js" }
   ]
   ```
3. Ensure `backend/server.js` exports the Express app:
   ```javascript
   module.exports = app;
   ```
4. Redeploy

---

### Issue 3: Frontend Shows Blank Page

**Error:**
White screen or "Failed to load resource"

**Solution:**
1. Check browser console for errors
2. Verify `VITE_API_URL` environment variable is set correctly
3. Check that `frontend/dist` contains `index.html`
4. View deployment logs for build errors
5. Redeploy with build cache cleared

---

### Issue 4: CORS Errors

**Error:**
```
Access to XMLHttpRequest blocked by CORS policy
```

**Solution:**
1. Add `ALLOWED_ORIGINS` environment variable:
   ```
   ALLOWED_ORIGINS=https://your-app.vercel.app
   ```
2. Redeploy
3. Verify backend CORS configuration in `backend/server.js`

---

### Issue 5: Environment Variables Not Loading

**Error:**
Features don't work, API returns errors

**Solution:**
1. Go to Settings → Environment Variables
2. Verify all variables are set for **Production** environment
3. Click **"Redeploy"** after adding/changing variables
4. Environment variables only take effect after redeployment

---

## Advanced Configuration

### Custom Domain Setup

1. Go to **Settings** → **Domains**
2. Click **"Add"**
3. Enter your domain: `archdisc.com`
4. Follow DNS configuration instructions:
   - Add A record: `76.76.21.21`
   - Or CNAME record: `cname.vercel-dns.com`
5. Wait for DNS propagation (5-60 minutes)
6. Update `VITE_API_URL` to use custom domain
7. Redeploy

---

### Enable Vercel Analytics

1. Go to **Analytics** tab
2. Click **"Enable Web Analytics"**
3. Free tier includes:
   - Page views
   - Unique visitors
   - Top pages
   - Referrers

---

### Set Up Preview Deployments

Vercel automatically creates preview deployments for:
- Every push to non-main branches
- Every pull request

**Configuration:**
1. Go to **Settings** → **Git**
2. Configure:
   - ✅ **Production Branch:** `main`
   - ✅ **Preview Deployments:** Enabled
   - ✅ **Auto-Deploy:** Enabled

**Benefits:**
- Test changes before merging
- Share preview URLs with team
- Automatic deployment comments on PRs

---

### Configure Build Performance

1. Go to **Settings** → **General**
2. Scroll to **Build & Development Settings**
3. Optimize:
   - **Node.js Version:** 18.x (recommended)
   - **Build Command Override:** Leave default
   - **Output Directory Override:** Leave default

---

### Enable Real AI Features

To use OpenAI instead of demo mode:

1. Get API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Go to **Settings** → **Environment Variables**
3. Edit `OPENAI_API_KEY`:
   - Change from `demo-mode`
   - To your actual key: `sk-...`
4. **Redeploy** the project
5. Test with a prompt - should get real AI-generated designs

**Cost Note:** OpenAI API usage is billed separately. Monitor usage at [OpenAI Platform](https://platform.openai.com/usage).

---

## Monitoring & Maintenance

### View Real-Time Logs

**Via Dashboard:**
1. Go to **Deployments** tab
2. Click on your deployment
3. Click **"Functions"** tab
4. Select a function to view logs

**Via CLI:**
```bash
vercel logs https://archdisc.vercel.app --follow
```

---

### Check Deployment Status

**Via Dashboard:**
- Green dot = Running
- Yellow dot = Building
- Red dot = Failed

**Via CLI:**
```bash
vercel inspect https://archdisc.vercel.app
```

---

### Rollback to Previous Version

If something breaks:

1. Go to **Deployments** tab
2. Find a working deployment
3. Click **"⋮"** menu
4. Select **"Promote to Production"**
5. Confirm

Your site instantly reverts to that version.

---

### Update Dependencies

When packages need updating:

1. Update `package.json` locally
2. Test locally: `npm install && npm run build`
3. Commit and push changes
4. Vercel auto-deploys with new dependencies

---

## Quick Reference Card

### Essential URLs

| Resource | URL |
|----------|-----|
| Your App | `https://your-project.vercel.app` |
| Vercel Dashboard | `https://vercel.com/dashboard` |
| Deployment Logs | Dashboard → Deployments → Your Deploy → Logs |
| Environment Vars | Dashboard → Settings → Environment Variables |
| API Health Check | `https://your-app.vercel.app/api/health` |

### Essential Commands

```bash
# Deploy
vercel --prod

# View logs
vercel logs

# List deployments
vercel ls

# Add env var
vercel env add KEY_NAME production

# View env vars
vercel env ls

# Pull env vars locally
vercel env pull
```

### Required Environment Variables

| Variable | Example Value | Notes |
|----------|--------------|-------|
| `NODE_ENV` | `production` | Required |
| `OPENAI_API_KEY` | `demo-mode` or `sk-...` | Required |
| `PORT` | `5000` | Required |
| `VITE_API_URL` | `https://your-app.vercel.app` | Update after first deploy |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` | Optional but recommended |

---

## Support & Resources

### Documentation
- [Vercel Documentation](https://vercel.com/docs)
- [Vercel CLI Reference](https://vercel.com/docs/cli)
- [Project README](../README.md)
- [Full Deployment Guide](./VERCEL_DEPLOYMENT.md)

### Community Support
- [Vercel Community](https://github.com/vercel/vercel/discussions)
- [Vercel Discord](https://vercel.com/discord)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/vercel)

### Status & Health
- [Vercel Status Page](https://www.vercel-status.com/)
- Check if Vercel services are operational

---

## Checklist: Verify Successful Deployment

Use this checklist after deployment:

- [ ] ✅ Deployment shows "Ready" status in Vercel
- [ ] ✅ Visit app URL - dark theme UI loads
- [ ] ✅ `/api/health` endpoint returns `{"status":"ok"}`
- [ ] ✅ Enter prompt "Design a modern sports car"
- [ ] ✅ 3D car model generates and displays
- [ ] ✅ Properties panel shows specifications
- [ ] ✅ Analysis tab shows metrics
- [ ] ✅ Compliance tab shows checks
- [ ] ✅ Wireframe mode works
- [ ] ✅ Explode view works
- [ ] ✅ No console errors in browser
- [ ] ✅ All environment variables set
- [ ] ✅ Custom domain configured (if applicable)

**If all checked: Your ArchDisc deployment is successful! 🎉**

---

## Next Steps

After successful deployment:

1. **Share Your App**
   - Share the Vercel URL with your team
   - Add project description and screenshots

2. **Set Up Custom Domain** (Optional)
   - Register a domain or use existing
   - Configure DNS as shown above

3. **Enable Real AI** (Optional)
   - Get OpenAI API key
   - Update `OPENAI_API_KEY` environment variable

4. **Monitor Usage**
   - Check Vercel Analytics
   - Monitor OpenAI API usage
   - Review deployment logs

5. **Continuous Development**
   - Push changes to GitHub
   - Vercel auto-deploys
   - Test with preview deployments

---

**You're all set! Enjoy your AI-powered design platform on Vercel! 🚀**
