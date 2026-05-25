import { geocoding, type GeocodingFeature } from '@maptiler/client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface LocationSearchProps {
  geolocating: boolean;
  onGeolocate: () => void;
  onSelect: (lat: number, lng: number, place: string) => void;
}

export default function LocationSearch({
  geolocating,
  onGeolocate,
  onSelect,
}: LocationSearchProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodingFeature[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  // Set when `handleSelectResult` programmatically overwrites `searchQuery`
  // with the picked feature's name, so the debounced effect below skips one
  // run instead of immediately re-querying and reopening the dropdown.
  const skipNextSearchRef = useRef(false);

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        setSearchOpen(false);
        return;
      }
      try {
        const res = await geocoding.forward(searchQuery, { limit: 5 });
        setSearchResults(res.features);
        setSearchOpen(res.features.length > 0);
      } catch {
        // silent — map pin-click still works
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handleSelectResult(feature: GeocodingFeature) {
    const [lng, lat] = feature.center as [number, number];
    const country = feature.context?.find((c: { id: string }) =>
      c.id.startsWith('country.'),
    )?.text;
    const placeName = country
      ? `${feature.text}, ${country}`
      : (feature.text ?? '');
    skipNextSearchRef.current = true;
    setSearchQuery(feature.place_name ?? placeName);
    setSearchOpen(false);
    onSelect(lat, lng, placeName);
  }

  return (
    <div ref={searchRef} className="relative mb-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
          placeholder={t('checkin.form.searchPlaceholder')}
          className="min-w-0 flex-1 rounded-input border border-char/15 bg-white px-4 py-2.5 text-sm text-char placeholder-smoke/60 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/20"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={onGeolocate}
          disabled={geolocating}
          className="shrink-0 rounded-btn bg-amber px-4 py-2.5 text-sm font-semibold tracking-wide text-white transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
        >
          {geolocating
            ? `${t('checkin.form.useMyLocation.loading')}…`
            : t('checkin.form.useMyLocation.default')}
        </button>
      </div>

      {searchOpen && searchResults.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-card border border-char/10 bg-white shadow-md">
          {searchResults.map((feature) => (
            <li key={feature.id as string}>
              <button
                type="button"
                className="w-full px-4 py-2.5 text-left text-sm text-char hover:bg-linen focus:bg-linen focus:outline-none"
                onClick={() => handleSelectResult(feature)}
              >
                <span className="font-medium">{feature.text}</span>
                {feature.place_name && feature.place_name !== feature.text && (
                  <span className="ml-1 text-smoke">
                    {feature.place_name.slice((feature.text?.length ?? 0) + 2)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
