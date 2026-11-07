// Load .env.local like Next.js does for the web app (real environment variables win).
try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local — fine
}
