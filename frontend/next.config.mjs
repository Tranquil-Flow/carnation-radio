/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Only use static export for production builds — in dev mode this disables
  // headers() which are needed for COOP/COEP (SharedArrayBuffer / ffmpeg.wasm)
  ...(process.env.NODE_ENV === 'production' ? { output: 'export' } : {}),
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
  // Note: headers() is ignored for static exports (output: 'export').
  // COOP/COEP headers required for SharedArrayBuffer/WASM threading must be
  // set at the hosting level. See public/_headers (Netlify/Cloudflare Pages)
  // or configure your CDN/server to serve these on all responses:
  //   Cross-Origin-Opener-Policy: same-origin
  //   Cross-Origin-Embedder-Policy: require-corp
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
      ],
    }];
  },
};

export default nextConfig;