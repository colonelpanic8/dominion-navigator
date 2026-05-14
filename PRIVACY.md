# Dominion Navigator Privacy Policy

Effective date: May 14, 2026

Dominion Navigator is a Chrome extension for `dominion.games`. It helps players track card locations and related game-state information while using the Dominion Online web client.

## Data the extension handles

Dominion Navigator runs only on `https://dominion.games/*`. While active on that site, it reads game-state information that is already available in the page, including:

- visible card names, card locations, and card movement events;
- player display names or player indexes shown by the game client;
- game identifiers, setup cards, starting decks, turn numbers, and recent moves;
- diagnostic invariant reports when the extension detects an internal tracking mismatch.

The extension does not collect payment information, health information, authentication credentials, personal communications, or browsing activity outside `dominion.games`.

## How data is used

The extension uses this information only to provide its user-facing card-location tracker and to diagnose tracker correctness while developing the extension.

## Storage and transmission

Dominion Navigator stores limited game-tracking state and recent diagnostic reports in Chrome extension local storage on your device. This data is used to restore tracker state for the same active game and to help diagnose local tracking issues.

The extension does not send user data to Dominion Navigator servers, analytics services, advertising networks, or other third parties.

During local development only, if a developer is running the optional development report sink at `http://127.0.0.1:9237`, the extension may send diagnostic invariant reports to that local service on the same device. If that local development service is not running, the request fails silently and no report is transmitted off the device.

## Sharing

Dominion Navigator does not sell, rent, or share user data. Data handled by the extension remains on the user's device except for the optional localhost development sink described above.

## Retention and deletion

Stored game-tracking state is intended for short-lived restoration of active Dominion games. Users can delete stored extension data at any time by removing the extension or clearing the extension's site and storage data in Chrome.

## Changes

This policy may be updated when the extension's behavior changes. Material changes will be reflected in this file and in the Chrome Web Store listing where required.

## Contact

Questions about this policy can be sent to IvanMalison@gmail.com.
