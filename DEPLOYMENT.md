# GitHub Pages Deployment Guide

## Automatic Deployment

The project is configured for automatic deployment to GitHub Pages using GitHub Actions.

### Setup Steps

1. **Enable GitHub Pages in Repository Settings**
   - Go to your repository: `https://github.com/digi-solutions-co-uk/didi-payment-system`
   - Navigate to **Settings** → **Pages**
   - Under **Source**, select **GitHub Actions**
   - Save the settings

2. **The deployment will automatically trigger when:**
   - You push to the `main` branch
   - You manually trigger it from the Actions tab

3. **Access your deployed application:**
   - After deployment completes, your app will be available at:
   - `https://digi-solutions-co-uk.github.io/didi-payment-system/`

## Manual Deployment

If you prefer to deploy manually:

```bash
# Build the frontend
cd frontend
npm install
npm run build

# The built files will be in frontend/dist/
# You can then deploy these files to GitHub Pages manually
```

## Important Notes

### Firebase Configuration

⚠️ **Security Warning**: The Firebase configuration in `frontend/src/firebase/config.js` contains API keys. For production:

1. Consider using environment variables
2. Set up Firebase App Check for additional security
3. Review Firestore security rules

### Base Path

The application is configured with base path `/didi-payment-system/` for GitHub Pages. If you change the repository name, update:
- `frontend/vite.config.js` - `base` property
- `.github/workflows/deploy.yml` - if needed

### Environment Variables

For production, you may want to use environment variables for Firebase config:

1. Create `.env.production` in the `frontend/` directory
2. Update `vite.config.js` to use environment variables
3. Update the GitHub Actions workflow to set environment variables (as secrets)

## Troubleshooting

### Build Fails
- Check GitHub Actions logs in the repository's Actions tab
- Ensure all dependencies are listed in `package.json`
- Verify Node.js version compatibility

### Routes Not Working
- Ensure React Router is configured with the correct base path
- Check that all routes use relative paths

### Firebase Errors
- Verify Firebase configuration is correct
- Check Firestore security rules allow public read (if needed)
- Ensure Firebase project is set up correctly

## Deployment Status

Check deployment status:
- Go to **Actions** tab in GitHub
- View the latest workflow run
- Check for any errors or warnings

