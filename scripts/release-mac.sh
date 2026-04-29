#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: macOS release signing/notarization must run on macOS." >&2
  exit 1
fi

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Error: Xcode Command Line Tools are required." >&2
  exit 1
fi

identity_output="$(security find-identity -v -p codesigning 2>/dev/null || true)"
if ! grep -q "Developer ID Application" <<<"$identity_output"; then
  echo "Error: no Developer ID Application certificate found in keychain." >&2
  exit 1
fi

if [[ -n "${CSC_NAME:-}" ]] && ! grep -Fq "${CSC_NAME}" <<<"$identity_output"; then
  echo "Error: CSC_NAME is set but no matching certificate was found: ${CSC_NAME}" >&2
  exit 1
fi

has_notary_creds=false
if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  has_notary_creds=true
fi
if [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  has_notary_creds=true
fi

if [[ "$has_notary_creds" != "true" ]]; then
  cat >&2 <<'MSG'
Error: missing notarization credentials.
Set one of:
  1) APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER
  2) APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
MSG
  exit 1
fi

npm run build

# Force signing discovery for release builds.
CSC_IDENTITY_AUTO_DISCOVERY=true electron-builder --mac dmg zip --arm64 --publish never

APP_PATH="release/mac-arm64/ShearPlate.app"
VERSION="$(node -p "require('./package.json').version")"
DMG_PATH="release/ShearPlate-${VERSION}-arm64.dmg"

if [[ -d "$APP_PATH" ]]; then
  codesign --verify --deep --strict --verbose=2 "$APP_PATH"
  spctl --assess --type execute --verbose=4 "$APP_PATH"
fi

if [[ -f "$DMG_PATH" ]]; then
  xcrun stapler validate "$DMG_PATH"
fi

echo "macOS release is signed, notarized, and stapled for version ${VERSION}."
