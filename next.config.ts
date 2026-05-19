import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // 部署到 GitHub Pages 时需要使用二级目录 /hanzi-writer
  basePath: process.env.NODE_ENV === "production" ? "/hanzi-writer" : "",
  images: {
    unoptimized: true, // 静态导出必须关闭默认的图片优化引擎
  },
};

export default nextConfig;
