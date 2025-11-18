# Quick Setup Guide: Environment Configuration

## 🔑 Where is my `.env` file?

**The `.env` file is intentionally NOT included in the git repository for security reasons.** This is to prevent accidentally exposing your API keys and secrets.

If you don't see a `.env` file in the `backend/` folder, you need to create it.

## 📋 How to Create Your `.env` File

### Step 1: Navigate to Backend Folder
```bash
cd backend
```

### Step 2: Copy the Example File
```bash
cp .env.example .env
```

This creates a new `.env` file from the template.

### Step 3: Edit the `.env` File
Open `backend/.env` in your text editor and add your API keys:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Google Gemini API Configuration (REQUIRED)
GEMINI_API_KEY=your_actual_gemini_api_key_here

# Sketchfab API Configuration (OPTIONAL)
SKETCHFAB_API_TOKEN=your_sketchfab_api_token_here
SKETCHFAB_ENABLED=true
```

### Step 4: Save the File

That's it! Your `.env` file is now ready.

## 🔐 Security Best Practices

✅ **DO:**
- Keep your `.env` file local (it's in `.gitignore`)
- Never commit `.env` to git
- Store API keys securely
- Use `.env.example` as a template for team members

❌ **DON'T:**
- Don't share your `.env` file publicly
- Don't commit API keys to git
- Don't use example/placeholder keys in production

## 🆘 I Had a `.env` File Before - Where Did It Go?

If you previously had a `.env` file with your Gemini API key:

1. **Check if it still exists locally** - it might be on your local machine but not in git
2. **If you lost it**, you'll need to:
   - Create a new `.env` file from `.env.example` (see steps above)
   - Get a new Gemini API key from: https://makersuite.google.com/app/apikey
   - Get a new Sketchfab API token from: https://sketchfab.com/settings/password

The `.env` file is **never tracked by git**, so pulling updates won't overwrite your local `.env` file if you already have one.

## 📍 What's in `.gitignore`?

The repository's `.gitignore` file includes:
```
.env
.env.local
.env.production
```

This ensures your environment files are never accidentally committed.

## 🎯 Quick Checklist

Before running the application, make sure:

- [ ] `backend/.env` file exists
- [ ] `GEMINI_API_KEY` is set in `.env`
- [ ] `SKETCHFAB_API_TOKEN` is set in `.env` (if using Sketchfab)
- [ ] `SKETCHFAB_ENABLED=true` in `.env` (if using Sketchfab)

## 🚀 Ready to Go!

Once your `.env` file is configured, start the backend:

```bash
cd backend
npm start
```

## 📚 Need More Help?

- **Gemini API Setup**: See README.md section on "Configuration"
- **Sketchfab Setup**: See SKETCHFAB_INTEGRATION.md
- **General Setup**: See README.md "Getting Started" section

## 🔧 Troubleshooting

### "GEMINI_API_KEY not found" Error
- Make sure `backend/.env` exists
- Check that `GEMINI_API_KEY=your_key_here` is in the file
- Remove any spaces around the `=` sign

### "Sketchfab integration is not enabled"
- Set `SKETCHFAB_ENABLED=true` in `backend/.env`
- Add your `SKETCHFAB_API_TOKEN` to the file
- Restart the backend server

### Still Having Issues?
Check that your `.env` file is in the correct location:
```bash
ls -la backend/.env
```

If it doesn't exist, follow the steps above to create it.
