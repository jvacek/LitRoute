import 'maplibre-gl/dist/maplibre-gl.css';
import { Turnstile } from '@marsidev/react-turnstile';
import {
  config as maptilerConfig,
  geocoding,
  type GeocodingFeature,
} from '@maptiler/client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMap, { Layer, Source } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import { useAuth } from '../AuthContext';
import { useConfig } from '../lib/useConfig';

import PhotoUpload from './PhotoUpload';

const MAX_IMAGES = 5;

async function convertToWebP(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Conversion failed'));
          return;
        }
        const name = file.name.replace(/\.[^.]+$/, '.webp');
        resolve(new File([blob], name, { type: 'image/webp' }));
      },
      'image/webp',
      0.85,
    );
  });
}

export interface ExistingImage {
  id: number;
  image: string;
}

export interface CheckinFormInitialData {
  location?: string;
  place?: string;
  message?: string;
  images?: ExistingImage[];
}

interface CheckinFormProps {
  mode: 'create' | 'edit';
  initialData?: CheckinFormInitialData;
  unitUrl: string;
  maptilerKey: string;
  onSubmit: (data: FormData) => Promise<Record<string, string[]> | null>;
  onSuccess?: (checkinId: number, editToken?: string) => void;
}

export default function CheckinForm({
  mode,
  initialData,
  unitUrl,
  maptilerKey,
  onSubmit,
  onSuccess,
}: CheckinFormProps) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const config = useConfig();
  const [location, setLocation] = useState(initialData?.location ?? '');
  const [place, setPlace] = useState(initialData?.place ?? '');
  const [message, setMessage] = useState(initialData?.message ?? '');
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imageKeys, setImageKeys] = useState<string[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<number[]>([]);
  const [existingIdOrder, setExistingIdOrder] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [geolocating, setGeolocating] = useState(false);
  const [showPrivacyHint, setShowPrivacyHint] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [anonymousName, setAnonymousName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodingFeature[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const mapRef = useRef<MapRef>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const showTurnstile =
    mode === 'create' && !isAuthenticated && !!config?.turnstileSiteKey;
  const showNameField = mode === 'create' && !isAuthenticated;

  maptilerConfig.apiKey = maptilerKey;

  const pickedLatLng: [number, number] | null = location
    ? (location.split(',').map(Number) as [number, number])
    : null;

  const existingImages = (initialData?.images ?? []).filter(
    (img) => !removedImageIds.includes(img.id),
  );

  // Debounced geocoding search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    const timer = setTimeout(async () => {
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

  // Close dropdown on outside click
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
    setLocation(`${lat},${lng}`);
    const country = feature.context?.find((c: { id: string }) =>
      c.id.startsWith('country.'),
    )?.text;
    const placeName = country
      ? `${feature.text}, ${country}`
      : (feature.text ?? '');
    setPlace(placeName);
    setSearchQuery(feature.place_name ?? placeName);
    setSearchOpen(false);
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 12, duration: 1000 });
  }

  function handleGeolocate() {
    if (!navigator.geolocation) return;
    setGeolocating(true);
    setShowPrivacyHint(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude: lat, longitude: lng } }) => {
        setLocation(`${lat},${lng}`);
        setGeolocating(false);
        mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 1000 });
      },
      () => {
        setErrors((e) => ({
          ...e,
          location: [
            'Could not get your location. Please allow location access and try again.',
          ],
        }));
        setGeolocating(false);
        setShowPrivacyHint(false);
      },
    );
  }

  useEffect(() => {
    const urls = imageFiles.map((f) => URL.createObjectURL(f));
    setImagePreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [imageFiles]);

  async function handleAddFiles(files: File[]) {
    if (!files.length) return;

    const unsupported = files.filter(
      (f) =>
        f.type !== '' &&
        (!f.type.startsWith('image/') || f.type === 'image/svg+xml'),
    );
    if (unsupported.length > 0) {
      setErrors((prev) => ({
        ...prev,
        images: [t('checkin.form.errors.svgNotSupported')],
      }));
      return;
    }

    const remaining = MAX_IMAGES - existingImages.length;
    const allowed = files.slice(0, remaining);

    const converted = await Promise.all(
      allowed.map(async (f) => {
        try {
          return await convertToWebP(f);
        } catch {
          return f;
        }
      }),
    );

    const newKeys = converted.map(() => crypto.randomUUID());
    const cap = MAX_IMAGES - existingImages.length;

    setImageFiles((prev) => [...prev, ...converted].slice(0, cap));
    setImageKeys((prev) => [...prev, ...newKeys].slice(0, cap));

    if (files.length > remaining) {
      setErrors((e) => ({
        ...e,
        images: [t('checkin.form.errors.maxPhotos', { max: MAX_IMAGES })],
      }));
    } else {
      setErrors((e) => {
        const next = { ...e };
        delete next.images;
        return next;
      });
    }
  }

  function removeNewImage(key: string) {
    setImageFiles((prev) => {
      const idx = imageKeys.indexOf(key);
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
    });
    setImageKeys((prev) => prev.filter((k) => k !== key));
  }

  function removeExistingImage(id: number) {
    setRemovedImageIds((prev) => [...prev, id]);
    setExistingIdOrder((prev) => prev.filter((eid) => eid !== id));
  }

  function handleReorder(newFileKeys: string[], newExistingIdOrder: number[]) {
    // Reorder imageFiles and imageKeys in lockstep
    const filesByKey = new Map(imageKeys.map((k, i) => [k, imageFiles[i]]));
    setImageFiles(newFileKeys.map((k) => filesByKey.get(k)!).filter(Boolean));
    setImageKeys(newFileKeys.filter((k) => filesByKey.has(k)));
    setExistingIdOrder(newExistingIdOrder);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!location) {
      setErrors({ location: [t('checkin.form.errors.locationRequired')] });
      return;
    }
    setSubmitting(true);
    setErrors({});

    const [lat, lng] = location.split(',').map(Number);
    const data = new FormData();
    data.append(
      'location',
      JSON.stringify({ type: 'Point', coordinates: [lng, lat] }),
    );
    data.append('place', place);
    data.append('message', message);
    if (showNameField && anonymousName.trim()) {
      data.append('anonymous_name', anonymousName.trim());
    }
    imageFiles.forEach((f) => data.append('images', f));
    if (mode === 'edit') {
      data.append('remove_image_ids', JSON.stringify(removedImageIds));
      const orderedExistingIds =
        existingIdOrder.length > 0
          ? existingIdOrder
          : existingImages.map((img) => img.id);
      data.append('image_ids_order', JSON.stringify(orderedExistingIds));
    }
    if (showTurnstile && turnstileToken) {
      data.append('turnstile_token', turnstileToken);
    }

    try {
      const errs = await onSubmit(data);
      if (errs) {
        setErrors(errs);
      } else if (onSuccess) {
        // onSuccess handled by parent; nothing to do here
      }
    } catch (err) {
      console.error(err);
      setErrors({ non_field_errors: [t('common.unexpectedError')] });
    } finally {
      setSubmitting(false);
    }
  }

  const isCreate = mode === 'create';

  const pinGeoJSON = useMemo(() => {
    if (!location) return { type: 'FeatureCollection' as const, features: [] };
    const [lat, lng] = location.split(',').map(Number);
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [lng, lat] },
          properties: {},
        },
      ],
    };
  }, [location]);

  const newImages = imageKeys.map((key, i) => ({
    key,
    preview: imagePreviews[i] ?? '',
  }));

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Location */}
      <div>
        <label className="mb-2 block text-sm font-medium text-char">
          {t('checkin.form.locationLabel')}
          {isCreate && <span className="text-ember"> *</span>}
        </label>

        {/* Search bar + Use my location button */}
        <div ref={searchRef} className="relative mb-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
              placeholder={t('checkin.form.searchPlaceholder')}
              className="flex-1 rounded-input border border-char/15 bg-white px-4 py-2.5 text-sm text-char placeholder-smoke/60 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/20"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={handleGeolocate}
              disabled={geolocating}
              className="shrink-0 rounded-btn bg-amber px-4 py-2.5 text-sm font-semibold tracking-wide text-white transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
            >
              {geolocating
                ? `${t('checkin.form.useMyLocation.loading')}…`
                : t('checkin.form.useMyLocation.default')}
            </button>
          </div>

          {/* Autocomplete dropdown */}
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
                    {feature.place_name &&
                      feature.place_name !== feature.text && (
                        <span className="ml-1 text-smoke">
                          {feature.place_name.slice(
                            (feature.text?.length ?? 0) + 2,
                          )}
                        </span>
                      )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mb-2 text-xs text-smoke">
          {isCreate
            ? t('checkin.form.clickToDrop')
            : t('checkin.form.clickToMove')}
        </p>

        {/* Map */}
        <div className="overflow-hidden rounded-card border border-char/10">
          <ReactMap
            ref={mapRef}
            mapStyle={`https://api.maptiler.com/maps/dataviz/style.json?key=${maptilerKey}`}
            initialViewState={{
              longitude: pickedLatLng ? pickedLatLng[1] : 6,
              latitude: pickedLatLng ? pickedLatLng[0] : 41,
              zoom: pickedLatLng ? 8 : 3,
            }}
            style={{ height: '320px', width: '100%' }}
            cursor="crosshair"
            onClick={(e) => {
              const { lng, lat } = e.lngLat;
              setLocation(`${lat},${lng}`);
            }}
          >
            <Source id="pin" type="geojson" data={pinGeoJSON}>
              <Layer
                id="pin-circle"
                type="circle"
                paint={{
                  'circle-radius': 10,
                  'circle-color': '#e8a030',
                  'circle-opacity': 0.9,
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#ffffff',
                }}
              />
            </Source>
          </ReactMap>
        </div>

        {location && (
          <p className="mt-1.5 text-xs font-medium text-amber">
            &#x2713; {t('checkin.form.locationSet')}
          </p>
        )}

        {/* Privacy warning — shown as soon as geolocation is triggered */}
        {showPrivacyHint && (
          <div className="mt-2 rounded-card border border-amber/40 bg-amber/10 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-char">
                  &#9888;&#xFE0E; {t('checkin.form.privacyHint.title')}
                </p>
                <p className="text-sm text-char/80">
                  {t('checkin.form.privacyHint.body')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPrivacyHint(false)}
                className="mt-0.5 shrink-0 p-1 text-smoke hover:text-char"
                aria-label={t('checkin.form.dismiss')}
              >
                &#x2715;
              </button>
            </div>
          </div>
        )}

        {errors.location && (
          <p className="mt-1 text-xs text-ember">{errors.location.join(' ')}</p>
        )}
      </div>

      {/* Place */}
      <div>
        <label
          htmlFor="place"
          className="mb-1 block text-sm font-medium text-char"
        >
          {t('checkin.form.placeLabel')}
        </label>
        <input
          id="place"
          type="text"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder={t('checkin.form.placePlaceholder')}
          className="w-full rounded-input border border-char/15 bg-white px-4 py-3 text-sm text-char placeholder-smoke/60 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/20"
        />
        {errors.place && (
          <p className="mt-1 text-xs text-ember">{errors.place.join(' ')}</p>
        )}
      </div>

      {/* Message */}
      <div>
        <label
          htmlFor="message"
          className="mb-1 block text-sm font-medium text-char"
        >
          {t('checkin.form.messageLabel')}
        </label>
        <textarea
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder={
            isCreate ? t('checkin.form.messagePlaceholder') : undefined
          }
          className="w-full rounded-input border border-char/15 bg-white px-4 py-3 text-sm text-char placeholder-smoke/60 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/20"
        />
        {errors.message && (
          <p className="mt-1 text-xs text-ember">{errors.message.join(' ')}</p>
        )}
      </div>

      {/* Signature name — anonymous only */}
      {showNameField && (
        <div>
          <label
            htmlFor="anonymous-name"
            className="mb-1 block text-sm font-medium text-char"
          >
            {t('checkin.form.nameLabel')}
          </label>
          <input
            id="anonymous-name"
            type="text"
            value={anonymousName}
            onChange={(e) => setAnonymousName(e.target.value)}
            placeholder={t('checkin.form.namePlaceholder')}
            maxLength={100}
            className="w-full rounded-input border border-char/15 bg-white px-4 py-3 text-sm text-char placeholder-smoke/60 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/20"
          />
        </div>
      )}

      {/* Photos */}
      <PhotoUpload
        newImages={newImages}
        existingImages={existingImages}
        maxImages={MAX_IMAGES}
        onAdd={handleAddFiles}
        onRemoveNew={removeNewImage}
        onRemoveExisting={removeExistingImage}
        onReorder={handleReorder}
        error={errors.images?.join(' ')}
      />

      {errors.non_field_errors && (
        <p className="text-sm text-ember">
          {errors.non_field_errors.join(' ')}
        </p>
      )}
      {errors.captcha && (
        <p className="text-sm text-ember">{errors.captcha.join(' ')}</p>
      )}

      {isCreate && (
        <p className="text-xs italic text-smoke">
          {t('checkin.form.passedOnNote')}
        </p>
      )}

      {showTurnstile && (
        <Turnstile
          siteKey={config!.turnstileSiteKey}
          onSuccess={setTurnstileToken}
          options={{ theme: 'light' }}
        />
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-btn bg-amber px-[22px] py-[9px] text-sm font-semibold tracking-wide text-white transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting
            ? isCreate
              ? `${t('checkin.form.submit.creating')}…`
              : `${t('common.saving')}…`
            : isCreate
              ? t('checkin.form.submit.create')
              : t('checkin.form.submit.save')}
        </button>
        <a
          href={unitUrl}
          className="rounded-btn border border-char/15 px-[22px] py-[9px] text-sm font-medium text-char transition-colors hover:bg-linen"
        >
          {t('common.cancel')}
        </a>
      </div>
    </form>
  );
}
