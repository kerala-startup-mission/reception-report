import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths: works from the GitHub Pages sub-path
  // (/reception/), from a custom domain, and from `vite preview`.
  base: './',
  plugins: [react(), tailwindcss()],
})
