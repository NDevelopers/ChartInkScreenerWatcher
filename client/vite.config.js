import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // fail loudly instead of starting a second copy on 5174
    proxy: { '/api': 'http://localhost:4000' },
  },
});
