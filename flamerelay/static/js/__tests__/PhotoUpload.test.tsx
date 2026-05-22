/**
 * Asserts the visual states `PhotoUpload` renders for each per-photo
 * lifecycle stage: shrinking spinner, "couldn't shrink" fall-back banner,
 * upload-in-flight spinner, ✓ checkmark badge after success, ⚠ error badge
 * + click-to-toggle error popup with retry. The state plumbing that
 * drives these flags lives in `CheckinForm` and is covered in
 * `CheckinForm.shrinking.test.tsx`.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

import PhotoUpload, { type NewImage } from '../components/PhotoUpload';

function renderUpload(
  newImages: NewImage[],
  overrides: Partial<{
    onRetryUpload: (key: string) => void;
  }> = {},
) {
  return render(
    <PhotoUpload
      newImages={newImages}
      existingImages={[]}
      maxImages={5}
      onAdd={jest.fn()}
      onRemoveNew={jest.fn()}
      onRemoveExisting={jest.fn()}
      onReorder={jest.fn()}
      onRetryUpload={overrides.onRetryUpload}
    />,
  );
}

const SHRINKING_LABEL = 'Shrinking image';
const UPLOADING_LABEL = 'Uploading photo';
const UPLOADED_LABEL = 'Uploaded';
const UPLOAD_FAILED_LABEL = 'Upload failed';
const FAILED_LABEL = "Couldn't shrink — uploading original";

describe('PhotoUpload shrinking state', () => {
  it('renders a spinner overlay while a new image is shrinking', () => {
    renderUpload([{ key: 'k1', preview: 'blob:fake-1', isShrinking: true }]);

    expect(
      screen.getByRole('status', { name: SHRINKING_LABEL }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(FAILED_LABEL)).not.toBeInTheDocument();
  });

  it('renders the fallback badge when conversion failed', () => {
    renderUpload([{ key: 'k1', preview: 'blob:fake-1', shrinkFailed: true }]);

    expect(screen.getByLabelText(FAILED_LABEL)).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: SHRINKING_LABEL }),
    ).not.toBeInTheDocument();
  });

  it('suppresses the failed badge while still shrinking', () => {
    // While conversion is in flight we don't yet know whether it will succeed
    // or fail — the spinner takes precedence so users don't see a misleading
    // "couldn't shrink" flash that resolves on its own.
    renderUpload([
      {
        key: 'k1',
        preview: 'blob:fake-1',
        isShrinking: true,
        shrinkFailed: true,
      },
    ]);

    expect(
      screen.getByRole('status', { name: SHRINKING_LABEL }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(FAILED_LABEL)).not.toBeInTheDocument();
  });

  it('renders neither indicator for a normal new image', () => {
    renderUpload([{ key: 'k1', preview: 'blob:fake-1' }]);

    expect(
      screen.queryByRole('status', { name: SHRINKING_LABEL }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(FAILED_LABEL)).not.toBeInTheDocument();
  });
});

describe('PhotoUpload upload lifecycle visuals', () => {
  it('shows an upload spinner while isUploading', () => {
    renderUpload([{ key: 'k1', preview: 'blob:1', isUploading: true }]);
    expect(
      screen.getByRole('status', { name: UPLOADING_LABEL }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(UPLOADED_LABEL)).not.toBeInTheDocument();
  });

  it('shows the checkmark badge after upload succeeds', () => {
    renderUpload([{ key: 'k1', preview: 'blob:1', uploaded: true }]);
    expect(screen.getByLabelText(UPLOADED_LABEL)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(UPLOAD_FAILED_LABEL),
    ).not.toBeInTheDocument();
  });

  it('shows the error badge when upload failed, but no popup until clicked', () => {
    renderUpload([
      {
        key: 'k1',
        preview: 'blob:1',
        uploadErrorMessageKey: 'checkin.form.errors.connectionFailed',
      },
    ]);
    expect(screen.getByLabelText(UPLOAD_FAILED_LABEL)).toBeInTheDocument();
    // Popup not visible until the badge is tapped.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('toggles the error popup and shows the resolved message + retry button', () => {
    const onRetryUpload = jest.fn();
    renderUpload(
      [
        {
          key: 'k1',
          preview: 'blob:1',
          uploadErrorMessageKey: 'checkin.form.errors.connectionFailed',
        },
      ],
      { onRetryUpload },
    );

    fireEvent.click(screen.getByLabelText(UPLOAD_FAILED_LABEL));
    const popup = screen.getByRole('dialog');
    // The i18n key resolves to a concrete, user-facing message.
    expect(popup).toHaveTextContent(/Couldn't reach the server/i);

    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onRetryUpload).toHaveBeenCalledWith('k1');
    // Retry closes the popup.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('hides the shrink-fallback banner once an upload error is surfaced', () => {
    // If both shrink and upload fail, the error badge is the more important
    // signal — the banner would just add noise.
    renderUpload([
      {
        key: 'k1',
        preview: 'blob:1',
        shrinkFailed: true,
        uploadErrorMessageKey: 'common.unexpectedError',
      },
    ]);
    expect(screen.getByLabelText(UPLOAD_FAILED_LABEL)).toBeInTheDocument();
    expect(screen.queryByLabelText(FAILED_LABEL)).not.toBeInTheDocument();
  });
});
