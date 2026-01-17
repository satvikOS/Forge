# Complete Beginner's Guide to Integrating Gemini API with ArchDisc

## 🎯 Goal
Get ArchDisc working with Google Gemini API so you can generate 3D architectural designs from text prompts.

---

## 📋 Prerequisites

Before starting, you need:
1. A computer with Node.js installed (version 18 or higher)
2. A Google account
3. Basic command line knowledge (how to navigate folders and run commands)

---

## Step 1: Get Your Google Gemini API Key (5 minutes)

### 1.1 Go to Google AI Studio
Open your web browser and go to:
```
https://makersuite.google.com/app/apikey
```

Or alternatively:
```
https://aistudio.google.com/app/apikey
```

### 1.2 Sign In
- Click "Sign in" with your Google account
- If prompted, accept the terms of service

### 1.3 Create API Key
1. Click the blue button that says **"Create API Key"** or **"Get API Key"**
2. Select **"Create API key in new project"** (easiest option for beginners)
3. Wait a few seconds - Google will generate your key
4. You'll see something like: `AIzaSyC8xY2BmdRQ_YourActualKey_abc123xyz`

### 1.4 Copy Your API Key
1. Click the **Copy** icon next to your API key
2. **IMPORTANT**: Save this key somewhere safe (like a text file)
3. **Never share this key publicly** - it's like a password!

---

## Step 2: Set Up Your ArchDisc Project (10 minutes)

### 2.1 Open Terminal/Command Prompt

**On Windows:**
- Press `Windows Key + R`
- Type `cmd` and press Enter

**On Mac:**
- Press `Command + Space`
- Type `terminal` and press Enter

**On Linux:**
- Press `Ctrl + Alt + T`

### 2.2 Navigate to Your ArchDisc Project

```bash
# Example - replace with your actual path
cd /path/to/archdiscv1

# On Windows, it might look like:
cd C:\Users\YourName\Documents\archdiscv1

# On Mac/Linux, it might look like:
cd ~/Documents/archdiscv1
```

### 2.3 Navigate to Backend Folder

```bash
cd backend
```

### 2.4 Install Dependencies (if not already done)

```bash
npm install
```

Wait for it to complete (might take 1-2 minutes).

---

## Step 3: Configure Your API Key (2 minutes)

### 3.1 Create Configuration File

In the `backend` folder, you need to create a file called `.env`

**Option A: Using Command Line**

**On Mac/Linux:**
```bash
# Create the file
touch .env

# Open it with a text editor
nano .env
```

**On Windows:**
```bash
# Create the file
echo. > .env

# Open it with Notepad
notepad .env
```

**Option B: Using File Explorer/Finder**
1. Open the `backend` folder in File Explorer (Windows) or Finder (Mac)
2. Create a new text file called `.env` (note the dot at the beginning!)
3. Open it with any text editor (Notepad, TextEdit, VS Code, etc.)

### 3.2 Add Your API Key

Paste this into the `.env` file, **replacing** `YOUR_API_KEY_HERE` with your actual key:

```env
# ArchDisc Backend Configuration
PORT=5000
NODE_ENV=development

# Google Gemini API Key
GEMINI_API_KEY=YOUR_API_KEY_HERE

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

**Example with a real (fake) key:**
```env
GEMINI_API_KEY=AIzaSyC8xY2BmdRQ_YourActualKey_abc123xyz
```

### 3.3 Save the File
- In Notepad/TextEdit: Click File → Save
- In nano (terminal): Press `Ctrl + X`, then `Y`, then `Enter`

---

## Step 4: Test the Connection (3 minutes)

### 4.1 Run the Diagnostic Tool

Still in the `backend` folder, run:

```bash
node test-connection.js
```

### 4.2 Understand the Results

**✅ SUCCESS - You'll see:**
```
✅ API Key present: true
✅ Service configured: true
✅ API Connection Successful!
🎉 All systems operational!
```

**If you see this, SKIP to Step 5!** Everything is working!

**❌ FAILURE - You might see:**

**Error 1: "No API key"**
```
❌ NO API KEY FOUND!
```
**Fix:** Go back to Step 3 and make sure you created the `.env` file correctly.

**Error 2: "fetch failed" or "Network error"**
```
❌ API Connection Failed!
  Error: fetch failed
```
**Fix:** This is a network issue. See "Troubleshooting Network Issues" below.

**Error 3: "Invalid API key"**
```
❌ API key not valid
```
**Fix:** Double-check you copied the key correctly from Google AI Studio.

---

## Step 5: Start the Server (2 minutes)

### 5.1 Start the Backend Server

Still in the `backend` folder:

```bash
npm start
```

### 5.2 Verify Server Started

You should see:
```
✅ Gemini 2.5 Pro Experimental initialized successfully
✨ ArchDisc Backend Server running on port 5000
🤖 AI Mode: Google Gemini
```

**Keep this terminal window open!** The server needs to run.

### 5.3 Start the Frontend (in a NEW terminal)

Open a **new** terminal window (don't close the first one!):

```bash
# Navigate to project root
cd /path/to/archdiscv1

# Go to frontend folder
cd frontend

# Install dependencies (if first time)
npm install

# Start frontend
npm run dev
```

You should see:
```
VITE ready in XXX ms
➜ Local: http://localhost:5173/
```

---

## Step 6: Test ArchDisc! (1 minute)

### 6.1 Open ArchDisc in Browser

Open your web browser and go to:
```
http://localhost:5173
```

Or whatever URL the frontend showed (usually 5173 or 3000).

### 6.2 Try a Simple Design

1. Find the text input box
2. Type: `design a simple cube`
3. Click "Generate Design" (or similar button)
4. **Wait 10-30 seconds** - the AI needs time to think!

### 6.3 What You Should See

**✅ Success:**
- A 3D model appears on screen
- You can rotate it with your mouse
- The backend terminal shows logs like:
  ```
  ✅ AI analysis successful
  ✅ Design specs generation successful
  ```

**❌ Still failing?** See Troubleshooting below.

---

## 🔧 Troubleshooting Common Issues

### Issue 1: "Cannot find module" errors

**Problem:** Dependencies not installed

**Fix:**
```bash
# In backend folder
cd backend
npm install

# In frontend folder
cd frontend
npm install
```

### Issue 2: Port already in use

**Problem:** Port 5000 or 5173 is already being used

**Fix:**

**Option A:** Kill the process using the port

**On Mac/Linux:**
```bash
# Find process on port 5000
lsof -ti:5000 | xargs kill -9

# Find process on port 5173
lsof -ti:5173 | xargs kill -9
```

**On Windows:**
```bash
# Find process on port 5000
netstat -ano | findstr :5000

# Kill it (replace PID with the actual process ID)
taskkill /PID <PID> /F
```

**Option B:** Change the port in `.env`:
```env
PORT=5001
```

### Issue 3: Network/Firewall blocking Gemini API

**Problem:** Your network blocks Google APIs

**Symptoms:**
```
❌ API Connection Failed: fetch failed
Cannot reach: generativelanguage.googleapis.com
```

**Fixes to try (in order):**

1. **Disable VPN temporarily** (if you're using one)
2. **Try a different network** (mobile hotspot, different WiFi)
3. **Check firewall:**
   - Windows: Settings → Windows Security → Firewall → Allow Node.js
   - Mac: System Preferences → Security & Privacy → Firewall → Add Node.js
4. **Check antivirus** - temporarily disable to test
5. **Try using a different DNS:**
   ```bash
   # Windows (as administrator)
   netsh interface ip set dns "Wi-Fi" static 8.8.8.8
   
   # Mac/Linux
   # Edit /etc/resolv.conf and add:
   nameserver 8.8.8.8
   ```

### Issue 4: Still shows "Failed to generate design"

**Check 1: Look at backend logs**

In the terminal where backend is running, look for error messages.

**Check 2: Look at browser console**

1. In browser, press F12 (opens Developer Tools)
2. Click "Console" tab
3. Look for red error messages
4. Take a screenshot and share it for help

**Check 3: Verify API key is correct**

```bash
# In backend folder
cat .env | grep GEMINI_API_KEY
```

Make sure the key looks like: `AIzaSy...` (starts with AIzaSy)

---

## 🔄 Alternative APIs (If Gemini Doesn't Work)

If you absolutely cannot get Gemini working (due to network restrictions, regional availability, etc.), here are alternatives:

### Option 1: OpenAI GPT-4 (Recommended Alternative)

**Pros:**
- Very reliable
- Excellent at understanding 3D design requests
- Good JSON output
- Usually works in more regions

**Cons:**
- Costs money (but has free trial credits)
- Need credit card to sign up

**How to use:**
1. Go to: https://platform.openai.com/api-keys
2. Sign up and get API key
3. In `.env`, add:
   ```env
   OPENAI_API_KEY=sk-proj-xxxxx
   USE_OPENAI=true
   ```
4. Need code changes (let me know if you want to use this)

### Option 2: Anthropic Claude (Good Alternative)

**Pros:**
- Very capable with structured outputs
- Good API stability
- Usually available in more regions

**Cons:**
- Costs money
- Requires code modifications

**How to use:**
1. Go to: https://console.anthropic.com/
2. Get API key
3. Need code changes (let me know if you want to use this)

### Option 3: Local Fallback Mode (Free, Always Works)

**Pros:**
- No API needed
- Always works
- Free
- No network issues

**Cons:**
- Not AI-powered
- Less intelligent designs
- Pre-programmed patterns only

**How to use:**

This is **already built in!** If Gemini fails, ArchDisc automatically generates designs programmatically.

To force using only local mode (no API calls):

1. Edit `backend/.env`:
   ```env
   # Comment out or remove the API key
   # GEMINI_API_KEY=xxxxx
   ```

2. The system will use the automatic fallback generation I built in commit b1845e0.

---

## 📊 Verification Checklist

Before asking for help, verify:

- [ ] `.env` file exists in `backend` folder
- [ ] `.env` has valid `GEMINI_API_KEY=AIzaSy...`
- [ ] `node test-connection.js` shows "✅ API Connection Successful"
- [ ] Backend server shows "✅ Gemini initialized successfully"
- [ ] Frontend is accessible at http://localhost:5173
- [ ] Browser console (F12) shows no red errors
- [ ] Waited at least 30 seconds after clicking "Generate"

---

## 🆘 Getting Help

If still not working, collect this information:

1. **Run diagnostic:**
   ```bash
   cd backend
   node test-connection.js > diagnostic.txt 2>&1
   ```

2. **Backend logs:**
   - Copy the last 50 lines from the backend terminal
   - Look for any lines with ❌ or "error"

3. **Browser console:**
   - Press F12 in browser
   - Click "Console" tab
   - Screenshot any red error messages

4. **Environment info:**
   ```bash
   node --version
   npm --version
   echo "OS: $(uname -a)"  # Mac/Linux
   # or
   systeminfo | findstr /C:"OS"  # Windows
   ```

Share these 4 things when asking for help.

---

## 🎉 Success Criteria

You'll know it's working when:

1. ✅ Diagnostic shows "API Connection Successful"
2. ✅ Backend logs show "Gemini initialized successfully"
3. ✅ You type "design a cube" and see a 3D cube appear
4. ✅ Backend logs show "AI analysis successful"
5. ✅ Requests appear in https://makersuite.google.com/app/apikey (Activity tab)

---

## 📝 Summary Commands

Here's everything in one place for quick reference:

```bash
# 1. Navigate to project
cd /path/to/archdiscv1/backend

# 2. Install dependencies
npm install

# 3. Create .env file and add API key
# (manually create .env file with your key)

# 4. Test connection
node test-connection.js

# 5. Start backend (keep running)
npm start

# 6. In NEW terminal, start frontend
cd ../frontend
npm install
npm run dev

# 7. Open browser
# Go to: http://localhost:5173

# 8. Test with: "design a simple cube"
```

---

## 🔑 Key Files Reference

```
archdiscv1/
├── backend/
│   ├── .env                    ← Your API key goes here
│   ├── test-connection.js      ← Run this to test
│   ├── server.js               ← Main backend file
│   └── services/
│       └── geminiService.js    ← Handles Gemini API
└── frontend/
    └── src/
        └── App.jsx             ← Main frontend file
```

---

## ⚡ Quick Fix for Most Issues

If nothing works, try this "nuclear option":

```bash
# 1. Stop all servers (Ctrl+C in all terminals)

# 2. Clean everything
cd backend
rm -rf node_modules
rm package-lock.json

cd ../frontend
rm -rf node_modules
rm package-lock.json

# 3. Fresh install
cd ../backend
npm install

cd ../frontend
npm install

# 4. Verify .env file exists and has correct key
cd ../backend
cat .env

# 5. Test connection
node test-connection.js

# 6. Start everything
# Terminal 1:
cd backend && npm start

# Terminal 2:
cd frontend && npm run dev
```

---

**Still stuck?** Run `node test-connection.js` and share the full output. That diagnostic tool will tell us exactly what's wrong!
