import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Tauri 用設定
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      // Avoid CORS by proxying debug ingest through dev server
      '/__debug_ingest': {
        target: 'http://127.0.0.1:7479',
        changeOrigin: true,
        secure: false,
        rewrite: (path) =>
          path.replace(
            /^\/__debug_ingest/,
            '/ingest/c97dce33-c9ce-45de-8754-fb78786e969c',
          ),
      },
    },
  },

  // Tauri の環境変数プレフィクスを許可
  envPrefix: ['VITE_', 'TAURI_'],

  // ビルド時のベースパス（Tauri はローカルファイルから読む）
  build: {
    target: 'esnext',
  },
})
