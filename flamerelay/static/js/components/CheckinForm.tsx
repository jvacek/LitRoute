import { config as maptilerConfig } from '@maptiler/client';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MapRef } from 'react-map-gl/maplibre';
import { useAuth } from '../AuthContext';
import { captureGpsLocation } from '../lib/captureGpsLocation';
import { downscaleImage, MAX_UPLOAD_BYTES } from '../lib/imageConversion';
import { reportUnsupportedImage } from '../lib/reportUnsupportedImage';
import { isNetworkError, reportError } from '../lib/sentry';
import {
  PendingUploadError,
  type PendingUploadResult,
} from '../lib/uploadPendingImage';
import { useTurnstileGate } from '../lib/useTurnstileGate';
import {
  fieldErrorClass,
  inputClassLg,
  outlineBtnLg,
  primaryBtnLg,
} from '../styles';

import FreeformLocationMap from './FreeformLocationMap';
import GpsConfirmMap, { type ConfirmStep } from './GpsConfirmMap';
import LocationDeniedModal from './LocationDeniedModal';
import LocationSearch from './LocationSearch';
import LowPrecisionLocationModal from './LowPrecisionLocationModal';
import PhotoUpload from './PhotoUpload';

const MAX_IMAGES = 5;
const MESSAGE_MAX_LENGTH = 5000;
// Game-mode required fields must contain at least this many word characters
// (Unicode letters or numbers) so the leaderboard isn't populated with junk
// like "..." or "ab".
const MIN_REQUIRED_WORD_CHARS = 3;

type GeoJSONPoint = { type: 'Point'; coordinates: [number, number] };

export interface CheckinSubmitPayload {
  location: GeoJSONPoint;
  gps_location?: GeoJSONPoint;
  gps_accuracy_m?: number;
  place: string;
  message: string;
  anonymous_name?: string;
  pending_image_tokens: string[];
  remove_image_ids?: number[];
  image_ids_order?: number[];
  turnstile_token?: string;
}

function countWordChars(s: string): number {
  return (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
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
  isGpsEnforced?: boolean;
  gpsDriftFloorM: number;
  /** Upload one photo and resolve to its attach token. The form calls this
   * sequentially for each new photo before invoking `onSubmit`. The page
   * layer is expected to wire this to `uploadPendingImage(identifier, ...)`. */
  onUploadImage: (
    file: File,
    turnstileToken?: string,
  ) => Promise<PendingUploadResult>;
  onSubmit: (
    payload: CheckinSubmitPayload,
  ) => Promise<Record<string, string[]> | null>;
}

export default function CheckinForm({
  mode,
  initialData,
  unitUrl,
  maptilerKey,
  isGpsEnforced = false,
  gpsDriftFloorM,
  onUploadImage,
  onSubmit,
}: CheckinFormProps) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [location, setLocation] = useState(initialData?.location ?? '');
  const [place, setPlace] = useState(initialData?.place ?? '');
  const [message, setMessage] = useState(initialData?.message ?? '');
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imageKeys, setImageKeys] = useState<string[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [shrinkingKeys, setShrinkingKeys] = useState<Set<string>>(new Set());
  const [shrinkFailedKeys, setShrinkFailedKeys] = useState<Set<string>>(
    new Set(),
  );
  // Successful pending-image uploads, keyed by imageKey. Persists across
  // retries and across the entire form lifetime (photos auto-upload as
  // soon as their shrink finishes, so by submit time most tokens are
  // already in place). Cleared when the user removes a photo.
  const [uploadedTokens, setUploadedTokens] = useState<Map<string, string>>(
    new Map(),
  );
  // Keys whose upload is currently in flight. Drives the per-thumbnail
  // upload spinner and disables the submit button so the user can't ship
  // a half-finished payload.
  const [uploadingKeys, setUploadingKeys] = useState<Set<string>>(new Set());
  // Map of failed background uploads → i18n message key, so the per-photo
  // popover can show "Photo too big" vs "Too many photos queued" vs
  // "Couldn't reach the server" instead of one generic blob. The user can
  // tap a retry button on the popover to re-run the upload for just that
  // photo; the form's submit-time `uploadMissingTokens` also acts as a
  // bulk retry path.
  const [uploadErrors, setUploadErrors] = useState<Map<string, string>>(
    new Map(),
  );
  // {current, total} drives the "Uploading 2/5…" label on the submit button.
  // null = no upload in progress (either submitting the check-in itself, or
  // idle).
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  // imageKeys mirror used inside async conversion callbacks. Conversions
  // resolve out-of-order and may reorder via PhotoUpload's drag-to-reorder,
  // so we re-resolve a key's current position at swap time rather than
  // capturing the index from when conversion started.
  const imageKeysRef = useRef<string[]>([]);
  useEffect(() => {
    imageKeysRef.current = imageKeys;
  }, [imageKeys]);
  const [removedImageIds, setRemovedImageIds] = useState<number[]>([]);
  const [existingIdOrder, setExistingIdOrder] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [geolocating, setGeolocating] = useState(false);
  const [showPrivacyHint, setShowPrivacyHint] = useState(false);
  const {
    token: turnstileToken,
    widget: turnstileWidget,
    show: showTurnstile,
  } = useTurnstileGate({
    enabled: mode === 'create' && !isAuthenticated,
    externalError: !!errors.captcha,
    onRetry: () =>
      setErrors((e) => {
        if (!e.captcha) return e;
        const next = { ...e };
        delete next.captcha;
        return next;
      }),
  });
  const [anonymousName, setAnonymousName] = useState('');
  const [confirmStep, setConfirmStep] = useState<ConfirmStep>(null);
  const [showLocationDeniedModal, setShowLocationDeniedModal] = useState(false);
  const [showLowPrecisionModal, setShowLowPrecisionModal] = useState(false);
  const mapRef = useRef<MapRef>(null);
  const showNameField = mode === 'create' && !isAuthenticated;

  // The maptiler client reads its API key off a module-level singleton, so
  // assigning here would run on every render. The key is supplied by the
  // root loader and effectively never changes mid-session, but stash the
  // write in an effect so render stays pure.
  useEffect(() => {
    maptilerConfig.apiKey = maptilerKey;
  }, [maptilerKey]);

  const pickedLatLng: [number, number] | null = location
    ? (location.split(',').map(Number) as [number, number])
    : null;

  const existingImages = (initialData?.images ?? []).filter(
    (img) => !removedImageIds.includes(img.id),
  );

  function handleLocationSelect(lat: number, lng: number, placeName: string) {
    setLocation(`${lat},${lng}`);
    setPlace(placeName);
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 12, duration: 1000 });
  }

  function handleGeolocate() {
    setGeolocating(true);
    setShowPrivacyHint(true);
    captureGpsLocation().then((result) => {
      setGeolocating(false);
      if (result.kind === 'no-geolocation' || result.kind === 'denied') {
        setShowLocationDeniedModal(true);
        setShowPrivacyHint(false);
        return;
      }
      if (result.kind === 'no-fix') {
        setErrors((e) => ({
          ...e,
          location: [t('checkin.form.errors.gpsFixFailed')],
        }));
        setShowPrivacyHint(false);
        return;
      }
      const { latitude, longitude } = result.position;
      setLocation(`${latitude},${longitude}`);
      mapRef.current?.flyTo({
        center: [longitude, latitude],
        zoom: 15,
        duration: 1000,
      });
      if (result.isLowPrecision) setShowLowPrecisionModal(true);
    });
  }

  useEffect(() => {
    const urls = imageFiles.map((f) => URL.createObjectURL(f));
    setImagePreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [imageFiles]);

  function handleAddFiles(files: File[]) {
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

    const remaining = MAX_IMAGES - existingImages.length - imageKeys.length;
    const allowed = files.slice(0, Math.max(0, remaining));
    if (!allowed.length) {
      setErrors((e) => ({
        ...e,
        images: [t('checkin.form.errors.maxPhotos', { max: MAX_IMAGES })],
      }));
      return;
    }

    const newKeys = allowed.map(
      () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    // Push originals + previews immediately so the user sees thumbnails
    // without waiting for the canvas/encode roundtrip; each converted file
    // swaps in over its placeholder as conversion completes.
    setImageFiles((prev) => [...prev, ...allowed]);
    setImageKeys((prev) => [...prev, ...newKeys]);
    setShrinkingKeys((prev) => {
      const next = new Set(prev);
      newKeys.forEach((k) => next.add(k));
      return next;
    });

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

    allowed.forEach((original, i) => {
      const key = newKeys[i];
      downscaleImage(original).then(
        (converted) => {
          setShrinkingKeys((prev) => {
            if (!prev.has(key)) return prev;
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          if (imageKeysRef.current.indexOf(key) === -1) return;
          setImageFiles((prev) => {
            const idx = imageKeysRef.current.indexOf(key);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = converted;
            return next;
          });
          startBackgroundUpload(key, converted);
        },
        (err) => {
          setShrinkingKeys((prev) => {
            if (!prev.has(key)) return prev;
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          setShrinkFailedKeys((prev) => {
            if (prev.has(key)) return prev;
            const next = new Set(prev);
            next.add(key);
            return next;
          });
          if (imageKeysRef.current.indexOf(key) === -1) return;
          // Downscaling failed — either the format can't be decoded in this
          // browser (e.g. HEIC on Android Chrome, or a RAW/DNG) or the result
          // stayed over the cap. If the untouched original is also over the
          // upload cap, sending it would just 400 after a slow mobile upload;
          // surface a clear message instead. Otherwise the backend can still
          // handle it (e.g. HEIC, which it now decodes), so upload the original.
          if (original.size > MAX_UPLOAD_BYTES) {
            setUploadErrors((prev) =>
              new Map(prev).set(key, 'checkin.form.errors.imageUnsupported'),
            );
            // Fire-and-forget: log format/device forensics to Sentry so we can
            // see which photos can't be prepared and plan future support.
            void reportUnsupportedImage(original, err);
            return;
          }
          startBackgroundUpload(key, original);
        },
      );
    });
  }

  function uploadErrorMessageKey(err: unknown): string {
    const code = err instanceof PendingUploadError ? err.code : 'server';
    return code === 'too_large'
      ? 'checkin.form.errors.imageTooLarge'
      : code === 'rate_limited'
        ? 'checkin.form.errors.uploadRateLimited'
        : code === 'captcha_required'
          ? 'checkin.form.errors.captchaRequired'
          : code === 'network'
            ? 'checkin.form.errors.connectionFailed'
            : 'common.unexpectedError';
  }

  function startBackgroundUpload(key: string, file: File) {
    setUploadingKeys((prev) => new Set(prev).add(key));
    setUploadErrors((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    onUploadImage(file, showTurnstile ? turnstileToken : undefined).then(
      ({ token }) => {
        setUploadingKeys((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        // If the user removed the photo mid-upload, drop the token on the
        // floor; the orphan row will be reaped by the TTL cleanup task.
        if (imageKeysRef.current.indexOf(key) === -1) return;
        setUploadedTokens((prev) => new Map(prev).set(key, token));
      },
      (err) => {
        setUploadingKeys((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        if (imageKeysRef.current.indexOf(key) === -1) return;
        const messageKey = uploadErrorMessageKey(err);
        setUploadErrors((prev) => new Map(prev).set(key, messageKey));
        if (!(err instanceof PendingUploadError)) {
          reportError(err, { where: 'CheckinForm.bgUpload', mode });
        }
      },
    );
  }

  function retryBackgroundUpload(key: string) {
    const idx = imageKeysRef.current.indexOf(key);
    if (idx === -1) return;
    const file = imageFiles[idx];
    if (!file) return;
    startBackgroundUpload(key, file);
  }

  function removeNewImage(key: string) {
    setImageFiles((prev) => {
      const idx = imageKeys.indexOf(key);
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
    });
    setImageKeys((prev) => prev.filter((k) => k !== key));
    setShrinkingKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setShrinkFailedKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setUploadedTokens((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setUploadingKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setUploadErrors((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
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

  function handleGpsCapture() {
    setSubmitting(true);
    setErrors({});
    captureGpsLocation().then((result) => {
      setSubmitting(false);
      if (result.kind === 'no-geolocation' || result.kind === 'denied') {
        setShowLocationDeniedModal(true);
        return;
      }
      if (result.kind === 'no-fix') {
        setErrors({ location: [t('checkin.form.errors.gpsFixFailedGame')] });
        return;
      }
      const { latitude, longitude, accuracyM } = result.position;
      setConfirmStep({
        gpsLat: latitude,
        gpsLng: longitude,
        pinLat: latitude,
        pinLng: longitude,
        accuracyM,
      });
      if (result.isLowPrecision) setShowLowPrecisionModal(true);
    });
  }

  /**
   * Sequentially upload any imageFiles that don't yet have a token. Returns
   * the full ordered token list on success, or `null` if anything failed
   * (in which case `setErrors` has been called). On retry, keys with a
   * token in `uploadedTokens` skip — only the failed ones re-upload.
   */
  async function uploadMissingTokens(): Promise<string[] | null> {
    // Start from current state but mutate locally so the loop sees its own
    // writes — React state updates are batched/async and would lag behind.
    const localTokens = new Map(uploadedTokens);
    const total = imageKeys.length;
    if (total === 0) {
      setUploadProgress(null);
      return [];
    }
    setUploadProgress({ current: 0, total });
    for (let i = 0; i < imageKeys.length; i++) {
      const key = imageKeys[i];
      if (localTokens.has(key)) continue;
      const file = imageFiles[i];
      if (!file) continue;
      setUploadProgress({ current: i + 1, total });
      try {
        const { token } = await onUploadImage(
          file,
          showTurnstile ? turnstileToken : undefined,
        );
        localTokens.set(key, token);
        setUploadedTokens(new Map(localTokens));
      } catch (err) {
        setUploadProgress(null);
        setErrors({ images: [t(uploadErrorMessageKey(err))] });
        if (!(err instanceof PendingUploadError)) {
          reportError(err, { where: 'CheckinForm.upload', mode });
        }
        return null;
      }
    }
    setUploadProgress(null);
    return imageKeys.map((k) => localTokens.get(k)!);
  }

  async function submitWithTokens(
    payload: CheckinSubmitPayload,
    metaMode: string,
  ): Promise<void> {
    try {
      const errs = await onSubmit(payload);
      if (errs) setErrors(errs);
    } catch (err) {
      reportError(err, { where: 'CheckinForm.submit', mode: metaMode });
      const errorKey = isNetworkError(err)
        ? 'checkin.form.errors.connectionFailed'
        : 'common.unexpectedError';
      setErrors({ non_field_errors: [t(errorKey)] });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Wipe any prior field/server errors so the user starts from a blank
    // slate on every submit press. Validation and the server response below
    // re-populate as needed; submit itself is never gated on `errors`.
    setErrors({});

    if (isGpsEnforced) {
      // The submit button is disabled until confirmStep is set, so the only
      // way this branch fires without a captured fix is Enter-in-text-field.
      // Bail.
      if (!confirmStep) return;

      // Game-mode requires Place (everyone) and Name (anonymous only) so the
      // check-in can be attributed on the leaderboard. Reject fewer than
      // MIN_REQUIRED_WORD_CHARS letters/digits so users can't sneak past with
      // "..." or "ab".
      const requiredFieldErrors: Record<string, string[]> = {};
      if (countWordChars(place) < MIN_REQUIRED_WORD_CHARS) {
        requiredFieldErrors.place = [t('checkin.form.errors.placeRequired')];
      }
      // Name only needs one letter/digit — initials and CJK single-glyph
      // names are legitimate.
      if (showNameField && countWordChars(anonymousName) < 1) {
        requiredFieldErrors.anonymous_name = [
          t('checkin.form.errors.nameRequired'),
        ];
      }
      if (Object.keys(requiredFieldErrors).length > 0) {
        setErrors(requiredFieldErrors);
        return;
      }

      setSubmitting(true);

      const tokens = await uploadMissingTokens();
      if (tokens === null) {
        setSubmitting(false);
        return;
      }
      const payload: CheckinSubmitPayload = {
        location: {
          type: 'Point',
          coordinates: [confirmStep.pinLng, confirmStep.pinLat],
        },
        gps_location: {
          type: 'Point',
          coordinates: [confirmStep.gpsLng, confirmStep.gpsLat],
        },
        gps_accuracy_m: Math.round(confirmStep.accuracyM),
        place,
        message,
        pending_image_tokens: tokens,
      };
      if (showNameField && anonymousName.trim()) {
        payload.anonymous_name = anonymousName.trim();
      }
      if (showTurnstile && turnstileToken) {
        payload.turnstile_token = turnstileToken;
      }
      await submitWithTokens(payload, 'confirm');
      return;
    }

    if (!location) {
      setErrors({ location: [t('checkin.form.errors.locationRequired')] });
      return;
    }
    setSubmitting(true);

    const tokens = await uploadMissingTokens();
    if (tokens === null) {
      setSubmitting(false);
      return;
    }

    const [lat, lng] = location.split(',').map(Number);
    const payload: CheckinSubmitPayload = {
      location: { type: 'Point', coordinates: [lng, lat] },
      place,
      message,
      pending_image_tokens: tokens,
    };
    if (showNameField && anonymousName.trim()) {
      payload.anonymous_name = anonymousName.trim();
    }
    if (mode === 'edit') {
      payload.remove_image_ids = removedImageIds;
      payload.image_ids_order =
        existingIdOrder.length > 0
          ? existingIdOrder
          : existingImages.map((img) => img.id);
    }
    if (showTurnstile && turnstileToken) {
      payload.turnstile_token = turnstileToken;
    }

    await submitWithTokens(payload, mode);
  }

  const isCreate = mode === 'create';

  const newImages = imageKeys.map((key, i) => ({
    key,
    preview: imagePreviews[i] ?? '',
    isShrinking: shrinkingKeys.has(key),
    shrinkFailed: shrinkFailedKeys.has(key),
    isUploading: uploadingKeys.has(key),
    uploaded: uploadedTokens.has(key),
    uploadErrorMessageKey: uploadErrors.get(key),
  }));

  // Block submit while any photo is still being shrunk or uploaded, so the
  // user can't ship before the background pipeline catches up. Photos in
  // error state don't block — clicking submit will trigger the bulk retry
  // path in `uploadMissingTokens`.
  const hasPhotosInFlight = shrinkingKeys.size > 0 || uploadingKeys.size > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Edit mode: location is read-only after creation, so render a
          non-interactive map. Applies regardless of whether the unit is
          GPS-enforced — neither edit case can move the pin. */}
      {!isCreate && pickedLatLng && (
        <div>
          <label className="mb-2 block text-sm font-medium text-char">
            {t('checkin.form.locationLabel')}
          </label>
          <FreeformLocationMap
            maptilerKey={maptilerKey}
            pickedLatLng={pickedLatLng}
            interactive={false}
          />
          <p className="mt-1.5 text-xs text-smoke">
            {t('checkin.form.locationLockedOnEdit')}
          </p>
        </div>
      )}

      {/* Location — non-GPS units only */}
      {!isGpsEnforced && isCreate && (
        <div>
          <label className="mb-2 block text-sm font-medium text-char">
            {t('checkin.form.locationLabel')}
            {isCreate && <span className="text-ember"> *</span>}
          </label>

          <>
            <LocationSearch
              geolocating={geolocating}
              onGeolocate={handleGeolocate}
              onSelect={handleLocationSelect}
            />

            <p className="mb-2 text-xs text-smoke">
              {isCreate
                ? t('checkin.form.clickToDrop')
                : t('checkin.form.clickToMove')}
            </p>

            <FreeformLocationMap
              maptilerKey={maptilerKey}
              pickedLatLng={pickedLatLng}
              interactive
              mapRef={mapRef}
              onPinSet={(lat, lng) => setLocation(`${lat},${lng}`)}
            />

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
          </>

          {errors.location && (
            <p className={fieldErrorClass}>{errors.location.join(' ')}</p>
          )}
        </div>
      )}

      {/* Location — GPS-enforced units */}
      {isGpsEnforced && isCreate && (
        <div>
          <label className="mb-2 block text-sm font-medium text-char">
            {t('checkin.form.locationLabel')}
            {isCreate && <span className="text-ember"> *</span>}
          </label>

          <GpsConfirmMap
            maptilerKey={maptilerKey}
            gpsDriftFloorM={gpsDriftFloorM}
            confirmStep={confirmStep}
            capturing={submitting}
            onCapture={handleGpsCapture}
            onSelectPin={(pinLat, pinLng) =>
              setConfirmStep((s) => s && { ...s, pinLat, pinLng })
            }
            onReset={() => setConfirmStep(null)}
          />

          {errors.location && (
            <p className={fieldErrorClass}>{errors.location.join(' ')}</p>
          )}
        </div>
      )}

      {/* Game-mode leaderboard note: explains why place (and name, for anon)
          are required. Shown above the first field that gets the asterisk. */}
      {isGpsEnforced && isCreate && (
        <p className="rounded-card border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-char">
          {showNameField
            ? t('checkin.form.gameRequiredNote.anon')
            : t('checkin.form.gameRequiredNote.auth')}
        </p>
      )}

      {/* Place */}
      <div>
        <label
          htmlFor="place"
          className="mb-1 block text-sm font-medium text-char"
        >
          {t('checkin.form.placeLabel')}
          {isGpsEnforced && isCreate && <span className="text-ember"> *</span>}
        </label>
        <input
          id="place"
          type="text"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder={t('checkin.form.placePlaceholder')}
          className={inputClassLg}
        />
        {errors.place && (
          <p className={fieldErrorClass}>{errors.place.join(' ')}</p>
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
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={
            isCreate ? t('checkin.form.messagePlaceholder') : undefined
          }
          className={inputClassLg}
        />
        <p className="mt-1 text-right text-xs text-char/40">
          {message.length}/{MESSAGE_MAX_LENGTH}
        </p>
        {errors.message && (
          <p className={fieldErrorClass}>{errors.message.join(' ')}</p>
        )}
      </div>

      {/* Signature name — anonymous only */}
      {showNameField && (
        <div>
          <label
            htmlFor="anonymous-name"
            className="mb-1 block text-sm font-medium text-char"
          >
            {isGpsEnforced
              ? t('checkin.form.nameLabelRequired')
              : t('checkin.form.nameLabel')}
            {isGpsEnforced && <span className="text-ember"> *</span>}
          </label>
          <input
            id="anonymous-name"
            type="text"
            value={anonymousName}
            onChange={(e) => setAnonymousName(e.target.value)}
            placeholder={t('checkin.form.namePlaceholder')}
            maxLength={100}
            className={inputClassLg}
          />
          {errors.anonymous_name && (
            <p className={fieldErrorClass}>{errors.anonymous_name.join(' ')}</p>
          )}
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
        onRetryUpload={retryBackgroundUpload}
        error={errors.images?.join(' ')}
      />

      {errors.non_field_errors && (
        <p className={fieldErrorClass}>{errors.non_field_errors.join(' ')}</p>
      )}

      {isCreate && (
        <p className="text-xs italic text-smoke">
          {t('checkin.form.passedOnNote')}
        </p>
      )}

      {turnstileWidget}

      {/* Mobile users may have field errors scrolled out of view above the
          submit button. Nudge them to scroll up when any field-level error
          (other than the ones already rendered above this point) is present.
          Kept directly above the button so it's the last thing they see
          before tapping. */}
      {(errors.location ||
        errors.place ||
        errors.message ||
        errors.anonymous_name ||
        errors.images) && (
        <p className={fieldErrorClass}>{t('checkin.form.scrollUpForErrors')}</p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={
            submitting || hasPhotosInFlight || (isGpsEnforced && !confirmStep)
          }
          className={primaryBtnLg}
        >
          {uploadProgress
            ? t('checkin.form.submit.uploading', {
                current: uploadProgress.current,
                total: uploadProgress.total,
              })
            : submitting
              ? isCreate
                ? `${t('checkin.form.submit.creating')}…`
                : `${t('common.saving')}…`
              : hasPhotosInFlight
                ? t('checkin.form.submit.preparingPhotos')
                : isCreate
                  ? t('checkin.form.submit.create')
                  : t('checkin.form.submit.save')}
        </button>
        <a href={unitUrl} className={outlineBtnLg}>
          {t('common.cancel')}
        </a>
      </div>

      {showLocationDeniedModal && (
        <LocationDeniedModal
          onDismiss={() => setShowLocationDeniedModal(false)}
          onRetry={() => {
            setShowLocationDeniedModal(false);
            handleGpsCapture();
          }}
        />
      )}

      {showLowPrecisionModal && (
        <LowPrecisionLocationModal
          onDismiss={() => setShowLowPrecisionModal(false)}
          onRetry={() => {
            setShowLowPrecisionModal(false);
            if (isGpsEnforced) handleGpsCapture();
            else handleGeolocate();
          }}
        />
      )}
    </form>
  );
}
