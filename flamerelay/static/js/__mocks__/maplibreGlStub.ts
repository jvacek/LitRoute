// Jest stub for maplibre-gl. v6 ships ESM-only (its package.json has no
// `require` export condition), so jest can't resolve it. Unit tests stub the
// map components anyway — this only satisfies the `setWorkerUrl` import in
// lib/maplibreWorker.ts. Mapped in package.json's jest.moduleNameMapper.
export const setWorkerUrl = () => {};
