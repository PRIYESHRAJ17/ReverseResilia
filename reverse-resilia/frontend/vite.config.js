import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        residences: resolve(import.meta.dirname, 'residences.html'),
        regional_grids: resolve(import.meta.dirname, 'regional-grids.html'),
        about: resolve(import.meta.dirname, 'about.html'),
        recovery_engine: resolve(import.meta.dirname, 'recovery-engine.html'),
        journal: resolve(import.meta.dirname, 'journal.html'),
        disruption_research: resolve(import.meta.dirname, 'disruption-research.html'),
        contact: resolve(import.meta.dirname, 'contact.html'),
        privacy: resolve(import.meta.dirname, 'privacy-policy.html'),
        terms: resolve(import.meta.dirname, 'terms-of-use.html'),
        residence_ready: resolve(import.meta.dirname, 'residences/ready-for-more.html'),
        residence_light: resolve(import.meta.dirname, 'residences/between-light-landscape.html'),
        residence_penthouse: resolve(import.meta.dirname, 'residences/penthouse-collection.html'),
        residence_quiet: resolve(import.meta.dirname, 'residences/the-quiet-address.html'),
        residence_guwahati: resolve(import.meta.dirname, 'residences/guwahati-gateway.html'),
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
