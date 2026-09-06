import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/Conclus-o-de-Processos/',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8000' } },
  build: {
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react-vendor';
          if (id.includes('node_modules/pdfjs-dist')) return 'pdf-vendor';
          if (id.includes('node_modules/tesseract.js')) return 'ocr-vendor';
          if (id.includes('node_modules/jszip')) return 'zip-vendor';
        }
      }
    }
  }
});
