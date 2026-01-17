# 🚀 ArchDisc Quick Setup Reference

## ⚡ 30-Second Quick Start

```bash
# 1. Get API key: https://makersuite.google.com/app/apikey

# 2. Setup
cd backend
echo "GEMINI_API_KEY=your_key_here" > .env

# 3. Test
node test-connection.js

# 4. Run
npm start           # Terminal 1 (backend)
cd ../frontend && npm run dev  # Terminal 2 (frontend)

# 5. Open: http://localhost:5173
# 6. Try: "design a simple cube"
```

---

## 📚 Full Guides

| Issue | Guide | Time |
|-------|-------|------|
| **First time setup** | [BEGINNER_SETUP_GUIDE.md](./BEGINNER_SETUP_GUIDE.md) | 10 min |
| **Network problems** | [NETWORK_TROUBLESHOOTING.md](./NETWORK_TROUBLESHOOTING.md) | 5 min |
| **Want alternatives** | [API_COMPARISON.md](./API_COMPARISON.md) | 5 min |
| **Advanced features** | [GEMINI_INTEGRATION.md](./GEMINI_INTEGRATION.md) | 15 min |

---

## 🔧 Common Fixes

### "No API Key"
```bash
# Create .env in backend folder
cd backend
nano .env  # or notepad .env on Windows

# Add this line:
GEMINI_API_KEY=your_actual_key_here
```

### "Network Error" / "fetch failed"
```bash
# Test connection
node test-connection.js

# Try different network (mobile hotspot)
# Disable VPN
# Check firewall settings
```

### "Still not working"
```bash
# Use free fallback mode
# In backend/.env, comment out:
# GEMINI_API_KEY=xxxxx

# Restart server
npm start
```

---

## 🆘 Get Help

```bash
# Run diagnostic
cd backend
node test-connection.js > diagnostic.txt

# Share diagnostic.txt and:
# - Server error messages
# - Browser console errors (press F12)
# - Your OS (Windows/Mac/Linux)
```

---

## ✅ Working Checklist

- [ ] `.env` file exists in `backend/` folder
- [ ] `GEMINI_API_KEY=AIzaSy...` in `.env`
- [ ] `node test-connection.js` shows ✅ success
- [ ] Backend shows "Gemini initialized"
- [ ] Frontend accessible at localhost:5173
- [ ] Waited 30 seconds after clicking Generate

**All checked?** It should work!

---

## 🔄 Alternative APIs

### If Gemini doesn't work:

**Option 1: OpenAI (Paid)**
- Most reliable
- Works everywhere  
- $0.03 per request
- See [API_COMPARISON.md](./API_COMPARISON.md)

**Option 2: Fallback (Free)**
- Already built-in!
- Remove API key
- Always works
- Not AI but functional

---

## 📖 Read This First

**New user?** → [BEGINNER_SETUP_GUIDE.md](./BEGINNER_SETUP_GUIDE.md)

**Network issues?** → [NETWORK_TROUBLESHOOTING.md](./NETWORK_TROUBLESHOOTING.md)

**Want alternatives?** → [API_COMPARISON.md](./API_COMPARISON.md)

---

**Made by:** GitHub Copilot  
**Last updated:** 2025-11-15
