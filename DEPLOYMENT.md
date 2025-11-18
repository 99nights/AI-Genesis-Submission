# Deployment Guide - Railway

This guide will help you deploy your AI-Genesis app to Railway, where both the frontend and backend run in a single application.

## Prerequisites

1. **Railway Account**: Sign up at [railway.app](https://railway.app) (free tier available)
2. **GitHub Repository**: Your code should be in a GitHub repository
3. **Qdrant Cloud Account**: Get your Qdrant Cloud URL and API key from [cloud.qdrant.io](https://cloud.qdrant.io)
4. **Supabase Account**: Get your Supabase URL and anon key from [supabase.com](https://supabase.com)
5. **Google Gemini API Key**: Get from [Google AI Studio](https://makersuite.google.com/app/apikey)

## Step 1: Prepare Your Repository

Make sure your code is committed and pushed to GitHub:

```bash
git add .
git commit -m "Add Railway deployment configuration"
git push origin main
```

## Step 2: Deploy to Railway

1. **Create a New Project**:
   - Go to [railway.app](https://railway.app)
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository

2. **Railway will automatically detect**:
   - Node.js project
   - Build command: `npm run build`
   - Start command: `node server/index.js` (from railway.json)

## Step 3: Configure Environment Variables

In Railway, go to your project → **Variables** tab and add the following:

### Required Variables:

```bash
# Qdrant Configuration
QDRANT_UPSTREAM_URL=https://your-cluster.qdrant.io
QDRANT_API_KEY=your-qdrant-api-key
QDRANT_PRODUCTS_COLLECTION=products
QDRANT_VECTOR_NAME=embedding
QDRANT_VECTOR_SIZE=768

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key

# Gemini API
GEMINI_API_KEY=your-gemini-api-key

# Node Environment
NODE_ENV=production
PORT=8787

# Optional: Qdrant Collections (if different from defaults)
QDRANT_COLLECTION=product_visual_features
QDRANT_BATCHES_COLLECTION=batches
QDRANT_STOCK_ITEMS_COLLECTION=stock_items
QDRANT_SALES_COLLECTION=sales_transactions

# Optional: Proxy Logging
QDRANT_PROXY_LOG=summary  # Options: none, summary, verbose
```

### How to Get Your Keys:

- **Qdrant Cloud**: 
  1. Sign up at [cloud.qdrant.io](https://cloud.qdrant.io)
  2. Create a cluster
  3. Copy the cluster URL and API key from the dashboard

- **Supabase**:
  1. Create a project at [supabase.com](https://supabase.com)
  2. Go to Settings → API
  3. Copy the Project URL and anon/public key

- **Gemini API**:
  1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
  2. Create a new API key

## Step 4: Deploy

1. Railway will automatically start building and deploying
2. Watch the build logs in the Railway dashboard
3. Once deployed, Railway will provide you with a public URL (e.g., `https://your-app.railway.app`)

## Step 5: Setup Qdrant Collections (First Time)

After your first deployment, you may need to initialize Qdrant collections. You can do this by:

1. **Option A: SSH into Railway** (if available):
   ```bash
   railway run npm run setup:qdrant
   ```

2. **Option B: Run locally** pointing to your Qdrant Cloud:
   ```bash
   # Set QDRANT_UPSTREAM_URL and QDRANT_API_KEY in your local .env
   npm run setup:qdrant
   ```

3. **Option C: Use Qdrant Cloud UI** to create collections manually

## Step 6: Setup Supabase Schema

1. Go to your Supabase project
2. Navigate to SQL Editor
3. Run the SQL from `supabase/schema.sql` to create the shops table

## Step 7: Test Your Deployment

1. Visit your Railway URL
2. Test the application:
   - Register a new shop account
   - Test inventory scanning
   - Verify Qdrant connections

## Troubleshooting

### Build Fails
- Check build logs in Railway dashboard
- Ensure all dependencies are in `package.json`
- Verify Node.js version compatibility

### App Won't Start
- Check environment variables are set correctly
- Verify Qdrant and Supabase credentials
- Check Railway logs for error messages

### Frontend Not Loading
- Ensure `NODE_ENV=production` is set
- Verify the build completed successfully
- Check that `dist/` folder exists after build

### API Errors
- Verify Qdrant URL and API key
- Check that collections exist in Qdrant
- Ensure CORS is properly configured (already handled in server/index.js)

## Custom Domain (Optional)

1. In Railway, go to your service → Settings → Domains
2. Add your custom domain
3. Railway will provide DNS records to configure

## Monitoring

- **Logs**: View real-time logs in Railway dashboard
- **Metrics**: Railway provides basic metrics (CPU, memory, network)
- **Health Check**: Your app has a `/healthz` endpoint for monitoring

## Cost

Railway's free tier includes:
- $5 credit per month
- 500 hours of usage
- Perfect for demos and small projects

For production, consider upgrading to a paid plan.

## Alternative: Render.com

If you prefer Render.com, the setup is similar:

1. Create a new Web Service
2. Connect your GitHub repo
3. Set build command: `npm run build`
4. Set start command: `node server/index.js`
5. Add the same environment variables
6. Deploy!

---

**Your app is now live!** 🎉

Share your Railway URL to showcase your demo.

