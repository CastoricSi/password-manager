# 密码管理器 (Password Manager)

A simple, private password manager: several password books per device, each
either protected by a main password (encrypted) or open (plain, for everyday
non-sensitive things). Local-only, or a Google account with automatic sync and
sharing books with other Google users. Everything sensitive is encrypted in the
browser; the Cloudflare Worker serves assets, brokers Google sign-in and keeps
tiny "shared with you" notices.

## Product rules

1. **Icon** — the 祀 portrait, the same as sityle's (fan art; ask the artist
   before shipping publicly). `src/react-app/assets/icon.webp`, shown round;
   PWA PNGs in `public/` (maskable one on `#f0f1e9`).
2. **Eye-friendly and clean — the 丹青 design language** from the `sityle`
   package (github.com/CastoricSi/sityle, installed from a release `.tgz`
   URL, or from a git branch before it is released). No Tailwind: screens are built from sityle components; the app's own
   `layout.css` only lays things out (classes `pm-*`), using sityle's `--si-*`
   tokens for every colour, font, radius and timing — never raw colours.
   Desktop density, 16px root (18px "large"; sityle sizes are rem).
   Fonts: plain sans everywhere (`--si-font-heading` is set to sans); 宋体
   only for avatars and the 密码管理器 brand title.
3. **Simple and direct** — the usual password-manager layout (sidebar · list ·
   details); step-by-step where it's a flow (start, new book); dialogs for
   settings, new book and decisions. Feedback where the action happened
   (Copy → "Copied ✓"); no toasts. Categories are always on (the stored
   `features.categories` flag is ignored); custom fields are a per-book switch,
   off by default.

Required features — don't remove: multiple books, open (no-password) books,
categories, custom fields, attachments, password/answer hints, Google sync,
sharing.

## Flows

- **Build info**: the start screens (`AuthLayout`) end with "版本 1.0.0 · <commit> ·
  sityle x.y.z" (hover: build time) — `__PM_BUILD__`, set in `vite.config.ts`
  (commit from Cloudflare's `WORKERS_CI_COMMIT_SHA`, else git; "+" = built with
  uncommitted changes).
- **Start** (`screens/start/StartFlow`): until chosen once, "use local data" /
  "use a Google account" (remembered) → book picker (last used first; share
  notices; a delete / leave button per row — deleting asks twice; with no books
  an empty state, never a forced wizard: new book, or with Google add a shared
  one, without it a way to Google) → unlock (hint, recovery question with
  answer hint → forced new password) → main. Deleting or leaving the open book
  returns to the picker (no other book opens or becomes "last used").
- **New book** (`NewBookWizard`): 1 name + protection (or import backup),
  2 password + confirm + optional hint, 3 optional recovery question + answer +
  optional answer hint. Open books finish after step 1.
- **Main** (`main/MainScreen`): `Sidebar` (book switcher, All + categories
  with counts — add / rename / delete in place — sync status, settings, lock)
  | list (title, list/table toggle, New, search) | entry. The entry page
  (`main/EntryEditor`) is always editable — copy / show / open-site next to
  each box, a sticky footer with Save (Ctrl+S), Undo changes, Delete. <1024px the
  sidebar is a ☰ drawer; <768px list and details are separate pages. On
  ≥1024px an opt-in table (`prefs.layout`, `main/EntryTable`: per-cell copy,
  per-row show/hide, a category filter adds its custom-field columns) with the
  details in a right-hand panel.
- **Settings** (`main/SettingsPane` → `SettingsDialog`): a dialog with side
  tabs — this book (`BookTab` incl. `SharingSection`), general, account &
  sync, help.

## sityle

- `main.tsx` loads `sityle/style.css`, `sityle/base.css` (the page ground: reset,
  rice-paper body, paper fibre) then `layout.css`. `app/Theme.tsx` passes the
  app's theme to `<SiProvider theme>` (sityle owns `<html data-theme>`) and the
  app's words for sityle's own texts to `<SiProvider messages>` (copy, show /
  hide, clear, cancel, loading, password strength) — so components need no label props for them.
- Use sityle components first: Button, IconButton, CopyButton, TextField /
  PasswordField / SelectField / TextAreaField (floating labels), Input,
  SearchField, Switch, Segmented, Tabs, Menu, Dialog / ConfirmDialog
  (`seal="删"` on deletes), Card, Group / GroupRow (settings), NavItem
  (sidebar), ListItem, Avatar, Tag, Note, IconBadge, Steps, RadioCard, InkDrop,
  AutoHeight (the start card), Typography. Text styles in `layout.css` use the type
  tokens (`font: var(--si-type-h3)`). SelectField takes `options`, never native
  <select>. sityle's names: colour is `tone`, an item's second line is
  `description` (`hint` only under form fields). Menus and select lists float on
  <body>: place them with Menu's `align` / `matchWidth` / `className`, not with
  descendant selectors. "New" sits in the list header; list / table is a setting
  (Settings → General).
- `ui/` only adapts sityle to the app: fields.ts (Caps Lock), Logo /
  EntryAvatar (decorative: the name is written beside it), CopyIcon (dense table
  cells), useMediaQuery, cn.
- A piece that would be useful elsewhere belongs in sityle: add it there,
  release (`npm run release:minor` in E:\APP\sityle), bump the URL here.
- No web fonts are loaded (privacy, offline): sityle's stacks fall back to
  system Chinese fonts.
- Upgrade: `npm i https://github.com/CastoricSi/sityle/releases/download/vX.Y.Z/sityle-X.Y.Z.tgz`;
  an unreleased branch: `npm i github:CastoricSi/sityle#<branch>` (sityle's
  `prepare` builds it on install). Switch back to the release URL once it is out.
  Working on both at once: `npm i ../sityle` locally (never commit that);
  `vite.config.ts` dedupes React so the link works.
  After installing a new sityle, restart `npm run dev` (Vite doesn't watch
  node_modules).
- Dialogs on phones: bottom sheet by default; `phone="full"` for settings and
  the new-book wizard.
- Layers over the page (the ☰ drawer) are absolute layers in the page, not fixed
  ones, with the page held still while they are open: Safari on iPhone clips fixed
  layers to the viewport and shows the page under its toolbar.

## URLs (app/nav.ts)

Where the user is lives in the URL so Back / Forward / refresh work:
`/` picker, `/mode`, `/new` (wizard), `/b/<book>`, `/b/<book>/e/<entry>`,
`/b/<book>/new`; query `c` (category), `settings` (tab), `dialog=newbook`.
Only opaque ids — never names or search text. Going deeper pushes;
sideways (category, settings tab, another entry while one is open) replaces;
closing uses `goBack(target)` (a real Back only if the previous page is the
target). Back / Forward with unsaved changes asks (`setNavBlocker`). A password
book reached from outside (picker, refresh, link) is unlocked in the start card,
then the URL's entry opens. Unknown ids are dropped from the URL. Tests:
`app/nav.test.ts` (parse / build).

## Commands

`npm run dev | build | lint | test`. Keep `package-lock.json`: installing without
it hits an npm 10 bug (`reading 'edgesOut'`) via vitest's optional peers.
Google needs `.dev.vars` (see `.dev.vars.example` and README).

## Structure

```
src/worker/        Hono.
  googleAuth.ts      OAuth code flow, scope drive.file (+ openid email);
                     refresh token AES-GCM-encrypted (SESSION_SECRET) in an
                     HttpOnly cookie on /api (not /api/auth: the config and
                     /api/shares read it too; a cookie left there by older
                     builds moves on the next /api/auth/* request);
                     /api/auth/google/token gives short-lived access tokens.
                     /api/auth/config (alias /api/sync/config) also returns
                     picker {apiKey, appId} and whether notices (KV) exist.
  shares.ts          KV `SHARES` inbox per recipient email: POST (owner, checked
                     via Drive capabilities.canShare), GET, DELETE.
                     Header X-Requested-With: password-manager on API calls.
src/react-app/
  lib/             Pure logic, unit-tested.
    crypto.ts        Book key, slots (password / recovery answer + optional
                     answer hint), PBKDF2-SHA256 600k.
    content.ts       Entries, categories, features; search; mergeContent.
    bookfile.ts      BookFile v2 (readable header incl. optional password
                     hint; sealed or plain content + attachments); protection
                     changes; mergeBooks; parseBookFile (also upgrades v1).
    storage.ts       IndexedDB: `books`, `sync` (SyncRecord incl. ownedByMe /
                     ownerEmail / excluded = left a shared book).
    drive.ts         Drive v3 with drive.file: books are JSON files in a
                     visible "Password Manager" folder, found by appProperties
                     (pmBook, bookId, bookName, deletedAt) — so books shared
                     with the user appear too once picked. Sharing API:
                     people / share (writer) / unshare / leave.
    picker.ts        Google Picker (gapi) to accept shared files.
    sync.ts          syncAll: upload / take cloud / merge / wait for unlock /
                     deletes (owner only; restorable 30 days) / shared books
                     vanish when access goes / left books aren't re-added.
  app/             Library (store; SyncHost), SyncController (mode local|google,
                   connect popup, token cache, scheduling, notices, share /
                   unshare / leave / accept via picker), context, prefs, i18n.
  ui/              fields.ts (Caps Lock), CopyIcon, Logo / EntryAvatar,
                   useLast, useMediaQuery, cn.
  screens/         start/ (StartFlow, ShareNotices), NewBookWizard, UnlockForm,
                   NewPasswordForm, RestoreButton, NewPasswordFields,
                   RecoveryFields, and main/ (MainScreen, Sidebar, BookSwitcher,
                   LockedPanel, EntryList, EntryEditor, EntryTable, Attachments, SettingsPane,
                   BookTab, SharingSection, SyncBadge).
```

Notes:
- "Lock" / auto-lock lock only password books; open books stay usable.
- Hints are stored readable (they must show while locked); the UI says so and
  refuses a password hint equal to the password.
- With Google, every book syncs (no per-book toggle). Signing out keeps books
  locally and switches to local mode.
- A password book changed on two devices merges only when open there.
- Shared book: one file in the owner's Drive; every participant syncs it.
  Recipients must pick it once (drive.file rule) — the notice preselects it.
- UI text lives only in `app/i18n.ts` (zh canonical, en mirror).
