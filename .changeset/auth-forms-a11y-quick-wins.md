---
"manifest": patch
---

Polish auth flow accessibility and a few content fixes from a UX audit. Login, Register, and Reset Password inputs now have proper label/`for` association, `autocomplete` attributes for password-manager autofill, and `aria-describedby` linking errors to inputs. The cooldown intervals on resend buttons clean up on unmount. The Register page now links to real Terms and Privacy URLs (was `href="#"`). Section titles on Settings and Account use `<h2>` instead of `<h3>` to fix a heading hierarchy skip. Dark-variant logos use empty alt text so screen readers don't read "Manifest" twice. The Limits "Create rule" button uses the same plus icon as Workspace's "Connect Agent" button.
