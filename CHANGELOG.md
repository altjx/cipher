# Changelog

All notable changes to Cipher are documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

## [1.2.0] - 2026-03-29

### Added
- Added Google Account sign-in as an alternative to QR code pairing, with an emoji confirmation flow.
- Added automatic connection health checks with reconnect when the link to your phone goes stale.
- Added a "Copy" / "Open in Browser" context menu for links in conversations.
- Added a copy button for phone numbers shown in contact details.

### Fixed
- Fixed outgoing messages sometimes appearing as incoming after re-pairing on a different device.
- Fixed session errors that could prevent reconnecting after the app was idle.
- Fixed link previews failing on bot-protected sites like Zillow.
- Fixed read receipts so only the last-read message shows the indicator.

### Changed
- Notifications are now suppressed when the app window is already focused.
- Group chat notifications now show the conversation name instead of a raw ID.
- Media type labels in the conversation list are now more descriptive.

## [1.1.0] - 2026-03-17

### Added
- Added link previews for URLs shared in conversations, with rich preview cards.
- Added a settings panel for managing app preferences.
- Added reusable avatar components with gradient-based initials for contacts and groups.
- Added compose dialog for starting new conversations with contact search.
- Added group info panel showing participants and shared media.
- Added multi-file media sending support.
- Added command palette (Cmd+K) with quick navigation, theme switching, and actions.
- Added keyboard shortcuts for conversation navigation, sidebar toggle, search, and more.
- Added conversation deletion from the context menu.
- Added a theme system with 7+ built-in themes and persistent preference.
- Added emoji picker with full Unicode support, skin tones, search, and categories.
- Added emoji keyboard shortcuts (Cmd+1-7) and reaction chord shortcuts (Cmd+X then 1-7).
- Added iMessage-style floating reaction badges on message bubbles.
- Added reaction removal by clicking your own reaction or re-pressing the shortcut.
- Added clipboard paste-to-stage for images and videos.
- Added in-thread message search.
- Added responsive message bubble width that scales with window size.

### Fixed
- Fixed ghost conversations appearing after deletion from phone or web.
- Fixed conversation list not scrolling to the selected item when using command palette navigation.
- Fixed sent messages briefly showing "Read" status instead of "Delivered" before actual read receipt.
- Fixed duplicate notifications for old messages during background refresh.
- Fixed image lightbox carousel opening all conversation images instead of just the clicked group.

### Maintenance
- Added commit hooks and workflow documentation.
- Improved system message detection and command palette focus handling.

[Unreleased]: https://github.com/altjx/cipher/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/altjx/cipher/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/altjx/cipher/compare/v1.0.0...v1.1.0
