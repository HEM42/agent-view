// electrobun/dist/api/bun/index.ts imports "three" (for its WGPU adapters)
// without shipping types; we never touch that surface.
declare module "three";
