/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Electron 打包后输出目录需可移动
  output: 'standalone',
};

export default nextConfig;
