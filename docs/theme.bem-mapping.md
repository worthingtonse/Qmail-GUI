# QMail theme - BEM naming map

Track F deliverable.

The original plan asked for a table of every class across the 22 Phase 4
CSS files. After inventorying the current codebase on 2026-05-23, the
actual surface area is:

- **895** deduped file/class pairs
- **781** unique class names
- **75** names reused in more than one file
- **395** file/class pairs still live in the remaining open Phase 4 tracks
  (`E1`-`E7`)

Because `E8`-`E22` are already in review and those files now carry
file-local `/* was: .old-name */` comments, the durable value of Track F
is no longer a giant static table of already-made decisions. This document
ships the part Phase 4 still needs:

1. the rename rules every remaining pass should follow,
2. a collision audit across all 22 files,
3. the target block map for the remaining open tracks, and
4. worked examples from files already migrated.

For files already migrated (`E8`-`E22`), the CSS itself is the authoritative
exhaustive map for that file. Keep the local `/* was: ... */` comments for
one release cycle per plan section 3.7.

## Rules every Phase 4 pass should follow

1. **Block = component or owned subcomponent name.** Use the file's
   component name in kebab-case: `.main-dashboard`, `.export-tab`,
   `.service-selection-screen`, `.account-pane`.
2. **Elements are structural, not visual.** Rename `.header`,
   `.results-section`, `.balance-value`, `.upload-box` to
   `__header`, `__results`, `__balance-value`, `__upload-box`.
3. **Second-class state becomes a modifier.** Rename
   `.nav-tab.active` to `.main-dashboard__tab--active`,
   `.server-item.more-servers` to `.account-pane__server-item--more`,
   `.toggle-switch.active` to `.account-pane__toggle--active`.
4. **Role-only button names do not stay global by default.** Rename
   `.logout-button`, `.browse-button`, `.agree-button`,
   `.change-password-btn`, `.results-close-button` either to the owning
   block (`__logout-button`, `__browse-button`, `__close-button`) or to
   a deliberate shared block such as `.btn`.
5. **Shared utilities stay global only when the reuse is intentional.**
   Good candidates: `.card`, `.glass-container`, `.glass-sound-btn`,
   `.spinning`, and possibly `.btn` if `E6` extracts one on purpose.
   If the styles diverge even slightly, prefer the component block name.
6. **Modal subtrees stay owned by the component unless reused elsewhere.**
   Example: `ExportTab.css` should prefer `.export-tab__fix-modal`,
   `.export-tab__modal-header`, `.export-tab__close-button` over a new
   generic `.modal-*` family.
7. **Comments are part of the deliverable.** Every renamed class keeps
   `/* was: .old-name */` in the CSS for one release cycle.

## Shared collisions to resolve across all 22 files

These names already collide across files. Treat them as **must rename**
families unless a file is intentionally consuming a shared utility block.

| Current family | Files using it now | Rename guidance |
| --- | --- | --- |
| `status-message` | `E1`, `E2`, `E3`, `E4`, `E21` | Component-local `__status-message` in each file. |
| `results-section`, `results-grid`, `result-item`, `result-label`, `result-value` | `E1`, `E2`, `E3`, `E4` | Rename as block-local results subtrees, e.g. `.export-tab__results-grid`. |
| `progress-section`, `progress-bar-container`, `progress-bar`, `progress-text` | `E1`, `E2`, `E3`, `E4` | Rename as block-local progress subtrees, e.g. `.locker-tab__progress-bar`. |
| `upload-box`, `upload-icon`, `upload-text`, `upload-subtext`, `browse-button`, `clear-button`, `file-*`, `selected-files*` | mostly `E1`, `E3` | Treat as upload-area elements under each owning block; do not keep these names global. |
| `memo-section`, `memo-input`, `import-actions`, `import-button` | `E1`, `E3`, `E4` | Rename under each owning block. |
| `form-group` | `E2`, `E8`, `E12`, `E18` | Prefer `__field` or `__form-group` under the owning block. |
| `error-message` | `E8`, `E11`, `E12`, `E15` | Prefer `__error` or `__status-message--error`; do not leave generic. |
| `loading-state`, `empty-state` | QMail `E5`, `E9`, `E11`, `E12` | Either use the QMail shell utility on purpose or rename to component-local `__loading-state` / `__empty-state`. |
| `nav-tab` | `E1`, `E6` | Keep only if App shell and MainDashboard truly share the same tab block. Otherwise split to `.main-dashboard__tab` and `.app-nav__tab`. |
| `balance-section`, `balance-label`, `balance-value` | `E4`, `E5` | Rename under `.locker-tab` and `.account-pane`; same words, different domains. |
| generic `header`, `actions`, `field`, `label` | older wallet screens before migration | Follow the in-review examples below; never add a new bare `.header` or `.actions`. |

## Open-track target block map

These are the naming targets the remaining Phase 4 passes should use.

| Track | File | Target block(s) | Representative mappings |
| --- | --- | --- | --- |
| `E1` | `src/wallet/components/MainDashboard.css` | `.main-dashboard` | `.dashboard -> .main-dashboard`, `.dashboard-header -> .main-dashboard__header`, `.dashboard-nav -> .main-dashboard__nav`, `.nav-tab.active -> .main-dashboard__tab--active`, `.upload-box.dragging -> .main-dashboard__upload-box--dragging`, `.wallet-list-container -> .main-dashboard__wallet-list` |
| `E2` | `src/wallet/components/tabs/ExportTab.css` | `.export-tab` | `.export-form -> .export-tab`, `.form-group -> .export-tab__field`, `.export-actions -> .export-tab__actions`, `.results-close-button -> .export-tab__close-button`, `.fix-modal -> .export-tab__fix-modal`, `.fracked-warning -> .export-tab__warning` |
| `E3` | `src/wallet/components/tabs/AuthenticateTab.css` | `.authenticate-tab` | `.upload-area -> .authenticate-tab__upload-area`, `.selected-files -> .authenticate-tab__selected-files`, `.memo-input -> .authenticate-tab__memo-input`, `.import-button -> .authenticate-tab__import-button`, `.result-item.error -> .authenticate-tab__result-item--error` |
| `E4` | `src/wallet/components/tabs/LockerTab.css` | `.locker-tab` | `.balance-section -> .locker-tab__balance`, `.locker-key-input-group -> .locker-tab__key-field`, `.quick-amount-btn -> .locker-tab__quick-amount-button`, `.import-button.upload-button -> .locker-tab__import-button--upload`, `.sharing-section -> .locker-tab__sharing`, `.copy-button -> .locker-tab__copy-button` |
| `E5` | `src/qmail/screens/AccountPane.css` | `.account-pane` (keep) | `.account-header -> .account-pane__header`, `.server-item.more-servers -> .account-pane__server-item--more`, `.account-status.online -> .account-pane__status--online`, `.balance-card.total -> .account-pane__balance-card--total`, `.toggle-switch.active -> .account-pane__toggle--active`, `.setting-item.coming-soon -> .account-pane__setting-item--coming-soon` |
| `E6` | `src/App.css` | `.app-shell`, `.update-modal`, shared utility blocks | `.App -> .app-shell`, `.update-modal-header -> .update-modal__header`, `.update-modal-close -> .update-modal__close`, `.update-version-info -> .update-modal__version-info`, role buttons collapse into `.btn` modifiers or move into their owning block, `.nav-tab.active -> .nav-tab--active` if `.nav-tab` stays shared |
| `E7` | `src/screens/ServiceSelectionScreen.css` | `.service-selection-screen` | `.service-selection-container -> .service-selection-screen__card`, `.service-button.wallet -> .service-selection-screen__button--wallet`, `.service-button.existing-identity -> .service-selection-screen__button--existing-identity`, `.envelope-3d -> .service-selection-screen__envelope`, `.particle -> .service-selection-screen__particle`, `.locker-error-retry -> .service-selection-screen__locker-retry` |

## Worked examples from already-migrated files

Use these as the style reference for the remaining passes.

### E21 - WalletSetupScreen

| Old name | Current target |
| --- | --- |
| `.setup-container` | `.wallet-setup-screen__card` |
| `.setup-header` | `.wallet-setup-screen__header` |
| `.address-badge` | `.wallet-setup-screen__address` |
| `.status-box` | `.wallet-setup-screen__status` |
| `.status-message` | `.wallet-setup-screen__message` |
| `.action-row` | `.wallet-setup-screen__action-row` |
| `.action-btn` | `.wallet-setup-screen__button` |
| `.change-breakdown` | `.wallet-setup-screen__breakdown` |

### E20 - WelcomeScreen

| Old name | Current target |
| --- | --- |
| `.welcome-container` | `.welcome-screen__card` |
| `.header` | `.welcome-screen__header` |
| `.header h1` | `.welcome-screen__title` |
| `.header h2` | `.welcome-screen__subtitle` |
| `.description` | `.welcome-screen__description` |
| `.disclaimer` | `.welcome-screen__disclaimer` |
| `.actions` | `.welcome-screen__actions` |
| `.agree-button` | `.welcome-screen__button` |

### E18 - AddContactModal

| Old name | Current target |
| --- | --- |
| `.add-contact-modal .compose-modal-body` | `.add-contact-modal__body` |
| `.add-contact-modal .form-group` | `.add-contact-modal__fields` |
| `.add-contact-modal .form-group label` | `.add-contact-modal__label` |
| `.add-contact-modal .form-group input` | `.add-contact-modal__input` |
| `.add-contact-modal .form-group input.error` | `.add-contact-modal__input--error` |
| `.add-contact-error` | `.add-contact-modal__error` |
| `.field-hint` | `.add-contact-modal__field-hint` |
| `.add-contact-modal .send-button` | `.add-contact-modal__save-button` |

### E15 - PasswordScreen

| Old name | Current target |
| --- | --- |
| `.password-container` | `.password-screen__card` |
| `.header` | `.password-screen__header` |
| `.header h2` | `.password-screen__title` |
| `.header p` | `.password-screen__subtitle` |
| `.diceware-prompt` | `.password-screen__diceware-prompt` |
| `.diceware-button` | `.password-screen__diceware-button` |
| `.input-group` | `.password-screen__field` |
| `.password-input-container` | `.password-screen__input-wrap` |

## Shared blocks that can stay shared

These may remain standalone blocks/utilities if the owning PR confirms the
styles are intentionally identical across screens:

- `.btn` with modifiers such as `.btn--primary`, `.btn--secondary`,
  `.btn--danger`, `.btn--ghost`
- `.card`
- `.glass-container`
- `.glass-sound-btn`
- `.nav-tab`
- `.spinning`

If a component needs even slightly different structure, spacing, or states,
prefer the component block instead of extending one of the shared names.

## Practical rule for the rest of Phase 4

When in doubt:

1. start from the component file name,
2. create one block for the component,
3. move every generic descendant under that block,
4. turn second classes into `--modifier`, and
5. keep the old name in a `/* was: ... */` comment.

That keeps the remaining Phase 4 work reviewable and avoids adding new
cross-file collisions while the theme migration finishes.
