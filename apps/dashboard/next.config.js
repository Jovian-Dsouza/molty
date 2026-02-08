/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { dev }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };
    // Use memory cache in dev to avoid stale filesystem cache (ENOENT vendor-chunks)
    if (dev && config.cache) {
      config.cache = { type: "memory" };
    }
    return config;
  },
};

module.exports = nextConfig;
