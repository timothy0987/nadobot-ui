import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pins the workspace root to this package so Turbopack doesn't get confused if a
  // lockfile happens to exist in a parent folder outside this repo (e.g. OneDrive).
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
