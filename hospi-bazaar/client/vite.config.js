import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the React app calls /api/... and Vite forwards it to the Node API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
   proxy: { '/api': 'http://localhost:4000', '/uploads': 'http://localhost:4000', '/files': 'http://localhost:4000' },
  },
});
