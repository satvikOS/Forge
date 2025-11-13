# Deploying ArchDisc to Vercel

This guide provides step-by-step instructions for deploying the ArchDisc platform to Vercel.

## Prerequisites

- [Vercel Account](https://vercel.com/signup) (free tier works)
- [Vercel CLI](https://vercel.com/docs/cli) installed (optional but recommended)
- GitHub repository connected to Vercel
- Google Gemini API key (optional - works in demo mode without it)

## Deployment Options

### Option 1: Deploy via Vercel Dashboard (Recommended)

This is the easiest method for first-time deployment.

#### Step 1: Connect Your Repository

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "Add New" → "Project"
3. Import your GitHub repository `satvikOS/archdiscv1`
4. Vercel will automatically detect the configuration

#### Step 2: Configure Build Settings

Vercel should auto-detect the monorepo structure. If not, configure manually:

**Root Directory:** `./`

**Build Command:**
```bash
cd frontend && npm install && npm run build
```

**Output Directory:** `frontend/dist`

**Install Command:**
```bash
npm install
```

#### Step 3: Configure Environment Variables

Add the following environment variables in Vercel Dashboard → Settings → Environment Variables:

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `production` | Environment mode |
| `GEMINI_API_KEY` | `your-api-key` or `demo-mode` | Google Gemini API key for AI features |
| `PORT` | `5000` | Backend server port |
| `VITE_API_URL` | `https://your-app.vercel.app` | Frontend API endpoint |

**Note:** Use `demo-mode` for `GEMINI_API_KEY` to run without Google Gemini API (uses pre-configured responses)

#### Step 4: Deploy

1. Click "Deploy"
2. Wait for the build to complete (usually 2-3 minutes)
3. Your app will be available at `https://your-project.vercel.app`

---

### Option 2: Deploy via Vercel CLI

For developers who prefer command-line deployment.

#### Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

#### Step 2: Login to Vercel

```bash
vercel login
```

#### Step 3: Configure Environment Variables

Create a `.env.production` file in the project root:

```bash
# Backend Environment Variables
NODE_ENV=production
GEMINI_API_KEY=demo-mode
PORT=5000

# Frontend Environment Variables
VITE_API_URL=https://your-app.vercel.app
```

#### Step 4: Deploy

From the project root directory:

```bash
# First deployment (creates project)
vercel

# Follow the prompts:
# - Set up and deploy? Yes
# - Which scope? Select your account
# - Link to existing project? No
# - Project name? archdisc
# - Directory? ./
```

#### Step 5: Set Environment Variables via CLI

```bash
vercel env add GEMINI_API_KEY production
vercel env add NODE_ENV production
vercel env add VITE_API_URL production
```

#### Step 6: Deploy to Production

```bash
vercel --prod
```

---

## Project Structure for Vercel

```
archdiscv1/
├── vercel.json              # Vercel configuration (monorepo setup)
├── backend/
│   ├── server.js            # Express server (deployed as serverless function)
│   ├── package.json
│   └── ...
├── frontend/
│   ├── package.json         # Includes "vercel-build" script
│   ├── vite.config.js       # Configured for production build
│   └── dist/                # Build output (auto-generated)
└── VERCEL_DEPLOYMENT.md     # This file
```

---

## Configuration Files

### `vercel.json`

Located in the project root. Configures:
- Monorepo build setup
- API routes routing
- Static file serving
- Environment variables

```json
{
  "version": 2,
  "builds": [
    {
      "src": "backend/server.js",
      "use": "@vercel/node"
    },
    {
      "src": "frontend/package.json",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "dist"
      }
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "backend/server.js"
    },
    {
      "src": "/(.*)",
      "dest": "frontend/$1"
    }
  ]
}
```

### `frontend/package.json`

Includes `vercel-build` script:
```json
{
  "scripts": {
    "vercel-build": "vite build"
  }
}
```

### `frontend/vite.config.js`

Configured for production builds:
```javascript
export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: false,
  }
})
```

---

## Post-Deployment Configuration

### 1. Update API Endpoint

After deployment, update the `VITE_API_URL` environment variable:

```bash
vercel env add VITE_API_URL production
# Enter: https://your-actual-domain.vercel.app
```

Then redeploy:
```bash
vercel --prod
```

### 2. Configure Custom Domain (Optional)

1. Go to Vercel Dashboard → Your Project → Settings → Domains
2. Add your custom domain
3. Update DNS records as instructed by Vercel
4. Update `VITE_API_URL` to use custom domain

### 3. Enable Google Gemini Integration (Optional)

To use real AI features instead of demo mode:

1. Get a Google Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Update environment variable:
   ```bash
   vercel env add GEMINI_API_KEY production
   # Enter: your-actual-gemini-api-key
   ```
3. Redeploy: `vercel --prod`

---

## Verifying Deployment

### 1. Check Build Logs

View logs in Vercel Dashboard → Deployments → Your Deployment → Build Logs

### 2. Test API Endpoints

```bash
# Health check
curl https://your-app.vercel.app/api/health

# Should return:
# {"status":"ok","message":"ArchDisc API is running"}
```

### 3. Test Frontend

Visit `https://your-app.vercel.app` and:
1. Enter a prompt: "Design a modern sports car"
2. Click the arrow button
3. Verify design generation works
4. Test wireframe and explode view modes

---

## Troubleshooting

### Build Fails

**Error:** `Cannot find module 'vite'`
- **Solution:** Ensure `npm install` runs in frontend directory
- Check build command includes: `cd frontend && npm install`

**Error:** `ENOENT: no such file or directory, open 'dist/index.html'`
- **Solution:** Verify `frontend/vite.config.js` has `outDir: 'dist'`
- Check `vercel-build` script exists in `frontend/package.json`

### API Routes Not Working

**Error:** API calls return 404
- **Solution:** Check `vercel.json` routes configuration
- Verify backend `server.js` exports Express app: `module.exports = app`

### Environment Variables Not Loading

**Error:** App runs but features don't work
- **Solution:** Redeploy after setting env vars: `vercel --prod`
- Check environment scope (production vs development)

### CORS Errors

**Error:** `Access-Control-Allow-Origin` errors
- **Solution:** Backend already has CORS enabled
- If custom domain, add it to `ALLOWED_ORIGINS` env var

---

## Continuous Deployment

### Automatic Deployments

Vercel automatically deploys:
- **Production:** Every push to `main` branch
- **Preview:** Every push to other branches or PRs

### Deployment Hooks

Configure webhooks in Vercel Dashboard → Settings → Git → Deploy Hooks

### Rollback

To rollback to a previous deployment:
1. Go to Vercel Dashboard → Deployments
2. Find the working deployment
3. Click "⋯" → "Promote to Production"

---

## Performance Optimization

### 1. Enable Caching

Vercel automatically caches:
- Static assets (images, CSS, JS)
- API responses (configure via headers)

### 2. Edge Functions (Future)

For lower latency, consider migrating API to Vercel Edge Functions:
```javascript
// backend/api/generate.js (Edge Function)
export const config = { runtime: 'edge' }
export default async function handler(req) { ... }
```

### 3. Image Optimization

Use Vercel Image Optimization for 3D thumbnails:
```jsx
import Image from 'next/image'
<Image src="/design.png" alt="Design" width={500} height={500} />
```

---

## Cost Considerations

### Free Tier Limits
- 100 GB bandwidth/month
- Unlimited deployments
- Serverless function execution: 100 GB-hours

### Hobby Plan ($20/month)
- 1 TB bandwidth
- Unlimited serverless execution
- Custom domains

**Note:** ArchDisc should run comfortably on free tier for development/testing.

---

## Monitoring

### 1. View Real-time Logs

```bash
vercel logs your-deployment-url
```

### 2. Analytics

Enable Web Analytics in Vercel Dashboard → Your Project → Analytics

### 3. Error Tracking

Integrate Sentry or LogRocket for production error tracking:

```bash
npm install @sentry/react
```

```javascript
// frontend/src/main.jsx
import * as Sentry from '@sentry/react'
Sentry.init({ dsn: 'your-sentry-dsn' })
```

---

## Security Best Practices

### 1. Environment Variables
- Never commit `.env` files to Git
- Use Vercel's encrypted environment variables
- Rotate API keys regularly

### 2. API Rate Limiting
- Consider adding rate limiting to backend
- Use Vercel's built-in DDoS protection

### 3. HTTPS Only
- Vercel provides automatic HTTPS
- Enforce HTTPS in production: `app.use((req, res, next) => { if (!req.secure) return res.redirect('https://' + req.headers.host + req.url) })`

---

## Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel CLI Reference](https://vercel.com/docs/cli)
- [Deploying Vite Apps](https://vitejs.dev/guide/static-deploy.html#vercel)
- [Vercel Serverless Functions](https://vercel.com/docs/functions/serverless-functions)

---

## Support

For deployment issues:
1. Check [Vercel Status](https://www.vercel-status.com/)
2. Review [Vercel Community](https://github.com/vercel/vercel/discussions)
3. Open an issue in this repository

---

## Quick Reference Commands

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Initial deployment
vercel

# Deploy to production
vercel --prod

# View logs
vercel logs

# List deployments
vercel ls

# Remove deployment
vercel remove project-name
```

---

**Deployment Status:** Ready for Vercel ✅

The project is fully configured for Vercel deployment with monorepo support, environment variables, and automatic builds.
