# Oksskolten Spec — Keyboard Navigation

> [Back to Overview](./01_overview.md)

## Overview

Vim-like keyboard navigation for the article list. Enables reading and performing actions on articles without using a mouse. Always enabled; no setting to disable.

## Motivation

Keyboard-driven article navigation is a standard feature in major RSS readers (Feedly, Inoreader, Miniflux). Enables efficient reading workflows without reaching for the mouse.

## Scope

Keyboard navigation targets the **article list** only. The feed list (sidebar) is out of scope.

### State Management

A `KeyboardNavigationContext` (React Context) is created and its Provider placed in `PageLayout`.

Managed state:
- `focusedItemId`: `string | null` — ID of the currently focused article

### Initial Focus

When `focusedItemId` is `null` and `j` or `k` is pressed, focus moves to the first item in the list.

## Design

### Existing Shortcuts

Global shortcuts implemented in `src/hooks/use-global-shortcuts.ts`:

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + K` | Open command palette |
| `Cmd/Ctrl + Shift + K` | Open search dialog |
| `Cmd/Ctrl + N` | Open add feed modal |
| `Cmd/Ctrl + ,` | Navigate to settings |
| `Cmd/Ctrl + 1` | Navigate to Inbox |
| `Cmd/Ctrl + 2` | Navigate to Bookmarks |
| `Cmd/Ctrl + 3` | Navigate to Likes |
| `Cmd/Ctrl + 4` | Navigate to History |
| `Cmd/Ctrl + 5` | Navigate to Chat |

In `src/components/feed/feed-list.tsx`:

| Shortcut | Action |
|---|---|
| `Escape` | Clear multi-selection |

### Supported Layouts

Of the four article list layouts (list / card / magazine / compact), keyboard navigation is enabled only for single-column layouts: **list** and **compact**. Grid layouts (card / magazine) are deferred to future work.

### Behavior by articleOpenMode

Keyboard navigation behavior depends on the "Article Open Mode" setting (`articleOpenMode`).

#### Page Navigation Mode (`articleOpenMode === 'page'`)

| Shortcut | Action |
|---|---|
| `j` | Move focus to the next article (does not open the article) |
| `k` | Move focus to the previous article (does not open the article) |
| `Enter` | Open the focused article as a full page (`useNavigate` route transition) |
| `Escape` | Clear focus |

#### Overlay Mode (`articleOpenMode === 'overlay'`)

| Shortcut | Action |
|---|---|
| `j` | Move focus to the next article and display it in the existing ArticleOverlay |
| `k` | Move focus to the previous article and display it in the existing ArticleOverlay |
| `Escape` | If the overlay is open, close it (focus is preserved). Press Escape again to clear focus |

In overlay mode, `Enter` is not used. Articles are automatically displayed in the overlay when focus moves via j/k.

#### Actions (Both Modes)

| Shortcut | Action |
|---|---|
| `l` | Read Later (toggle bookmark: add if not bookmarked, remove if bookmarked) |
| `;` | Open the original article in a new browser tab (`window.open(url, '_blank')`) |

### Visual Feedback

The keyboard-focused article receives the following styles:

- 2px accent-color left border (`border-left: 2px solid var(--color-accent)`)
- Light accent-color background (`background: color-mix(in srgb, var(--color-accent) 10%, transparent)`)

Distinguished from the existing unread indicator (`border-l-accent`) by the thicker (2px) border combined with a background color.

### Accessibility

Minimal ARIA attributes are applied:

- `aria-selected="true"` on the focused item
- `role="listbox"` on the list container

### Boundary Behavior

- Pressing `k` at the top of the list: no action (stays at the top)
- Pressing `j` at the bottom of the list: no action (stays at the bottom). Does not trigger infinite scroll page loading

### Scroll Control

When focus moves to an off-screen item via `j`/`k`, `scrollIntoView({ behavior: 'smooth', block: 'nearest' })` scrolls minimally to bring the focused item into view.

### Read Status

No keyboard-navigation-specific read marking. Since `scrollIntoView` triggers scrolling, the existing IntersectionObserver-based auto-read feature fires naturally.

### Conflict Avoidance

#### Input Fields

Follows the pattern already implemented in `use-global-shortcuts.ts:21-24`:

```typescript
const isInput =
  ['INPUT', 'TEXTAREA', 'SELECT'].includes(
    (e.target as HTMLElement).tagName,
  ) || (e.target as HTMLElement).isContentEditable
```

j/k/l/; shortcuts are disabled when an input field is focused.

#### Modals, Dialogs, and Command Palette

Keyboard navigation is disabled while the command palette (`Cmd+K`), search dialog, or other modals are open. However, ArticleOverlay (marked with the `data-keyboard-nav-passthrough` attribute) is an exception — j/k article navigation remains active while the overlay is displayed.

### Mouse Coexistence

When an article is clicked with the mouse, the keyboard focus is updated to that article (`focusedItemId` is set to the clicked article's ID). Mouse and keyboard operations naturally stay in sync.

### Focus Persistence

Focus state is not automatically reset on page navigation. After pressing Escape to close the overlay in overlay mode, focus is preserved, and pressing j/k resumes from that article. To explicitly clear focus, press Escape when the overlay is closed.

### Empty List

When the article list is empty (no articles), pressing j/k does nothing.

### Key Files

| File | Description |
|---|---|
| `src/contexts/keyboard-navigation-context.tsx` | KeyboardNavigationContext and Provider |
| `src/hooks/use-keyboard-navigation.ts` | Key event handling and focus movement logic |
| `src/components/layout/page-layout.tsx` | Provider placement |
| `src/components/article/article-list.tsx` | Article list keyboard nav integration, visual feedback, overlay coordination |
| `src/components/article/article-overlay.tsx` | `data-keyboard-nav-passthrough` attribute for j/k passthrough |
