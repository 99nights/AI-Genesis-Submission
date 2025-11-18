# Quick Deploy to Railway

## 🚀 One-Command Setup (After Initial Config)

Your app is now configured for single-app deployment on Railway!

## Quick Steps:

1. **Push to GitHub** (if not already):
   ```bash
   git add .
   git commit -m "Ready for Railway deployment"
   git push
   ```

2. **Deploy on Railway**:
   - Go to [railway.app](https://railway.app)
   - New Project → Deploy from GitHub
   - Select your repo

3. **Add Environment Variables** in Railway:
   ```
   QDRANT_UPSTREAM_URL=your-qdrant-cloud-url
   QDRANT_API_KEY=your-qdrant-api-key
   SUPABASE_URL=your-supabase-url
   SUPABASE_ANON_KEY=your-supabase-key
   GEMINI_API_KEY=your-gemini-key
   NODE_ENV=production
   ```

4. **Done!** Railway will build and deploy automatically.

## What Changed:

✅ **Unified Server** (`server/index.js`): Serves both frontend and backend
✅ **Railway Config** (`railway.json`): Automatic build and deploy settings
✅ **Production Scripts**: Added `npm start` for production
✅ **Smart URL Handling**: Frontend automatically uses relative URLs in production

## Full Documentation:

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

---

**Your app will be live at:** `https://your-app.railway.app` 🎉

