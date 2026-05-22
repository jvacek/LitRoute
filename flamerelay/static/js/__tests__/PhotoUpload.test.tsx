/**
 * Asserts the visual states added for client-side image shrinking on
 * `PhotoUpload`: a spinner overlay while a newly added image is converting,
 * and a "couldn't shrink" badge when conversion fell back to the original.
 * The state plumbing that drives these flags lives in `CheckinForm` and is
 * covered in `CheckinForm.shrinking.test.tsx`.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import PhotoUpload, { type NewImage } from '../components/PhotoUpload';

function renderUpload(newImages: NewImage[]) {
  return render(
    <PhotoUpload
      newImages={newImages}
      existingImages={[]}
      maxImages={5}
      onAdd={jest.fn()}
      onRemoveNew={jest.fn()}
      onRemoveExisting={jest.fn()}
      onReorder={jest.fn()}
    />,
  );
}

const SHRINKING_LABEL = 'Shrinking image';
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
