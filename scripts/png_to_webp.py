#!/usr/bin/env python3

import argparse
from pathlib import Path

from PIL import Image, UnidentifiedImageError


def convert_image(input_path, output_path, quality):
    src = Path(input_path)
    if not src.exists():
        print(f"Error: The file '{input_path}' does not exist.")  # noqa: T201
        return

    dst = Path(output_path) if output_path else src.with_suffix(".webp")

    try:
        with Image.open(src) as img:
            # Preserve transparency by ensuring RGBA mode
            converted = img.convert("RGBA") if img.mode != "RGBA" else img

            # Save without passing exif/icc_profile to ensure metadata is stripped
            converted.save(dst, "WEBP", quality=quality, lossless=False)

    except (OSError, UnidentifiedImageError) as e:
        print(f"An unexpected error occurred: {e}")  # noqa: T201
        return

    print(f"Done! Saved to: {dst}")  # noqa: T201


def main():
    parser = argparse.ArgumentParser(description="Convert PNG to WebP while preserving alpha and stripping metadata.")

    # Positional argument for the source file
    parser.add_argument("input", help="Path to the source PNG image")

    # Optional argument for the destination
    parser.add_argument("-o", "--output", help="Path for the output WebP image (optional)")

    # Optional argument for quality
    parser.add_argument("-q", "--quality", type=int, default=80, help="WebP quality (1-100), default is 80")

    args = parser.parse_args()

    convert_image(args.input, args.output, args.quality)


if __name__ == "__main__":
    main()
