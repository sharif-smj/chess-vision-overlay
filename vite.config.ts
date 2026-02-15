import { defineConfig } from 'vite';
import manifest from './manifest.json';

const globalWithFile = globalThis as typeof globalThis & { File?: unknown };
if (typeof globalWithFile.File === 'undefined') {
  class NodeFile extends Blob {
    name: string;
    lastModified: number;

    constructor(parts: unknown[], name: string, options: { lastModified?: number; type?: string } = {}) {
      super(parts, options);
      this.name = name;
      this.lastModified = options.lastModified ?? Date.now();
    }
  }

  globalWithFile.File = NodeFile;
}

export default defineConfig(async () => {
  const { crx } = await import('@crxjs/vite-plugin');

  return {
    plugins: [crx({ manifest })],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2022',
    },
    publicDir: false,
  };
});
