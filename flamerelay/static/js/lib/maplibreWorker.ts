import { setWorkerUrl } from 'maplibre-gl';

// MapLibre v6 locates its worker via import.meta.url, which webpack bakes to a
// build-machine file:// path — the runtime fallback is then an empty URL that
// resolves to the page URL and gets blocked by the CSP's worker-src, leaving a
// blank map (no tiles, no GeoJSON overlays). The webpack build emits the worker
// next to the bundles (MapLibreWorkerAssetsPlugin in webpack/common.config.js);
// point MapLibre at that copy. Import this module from any component that
// renders a <ReactMap>.
setWorkerUrl('/static/webpack_bundles/js/maplibre-gl-worker.mjs');
