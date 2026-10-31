// Sign-in dialog: collects email + password, asks main.js to sign in, and
// shows any error inline. Also hosts the Sign out button.

import { $ } from './dom.js';

export function createSignInDialog(dialog, { onSignIn, onSignOut }) {
  const form = $('#signin-form', dialog);
  const emailInput = $('#f-email', dialog);
  const passwordInput = $('#f-password', dialog);
  const errorBox = $('#signin-error', dialog);
  const submit = $('#signin-submit', dialog);
  const signOut = $('#signin-signout', dialog);
  const who = $('#signin-user', dialog);

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  };

  $('#signin-cancel', dialog).addEventListener('click', () => dialog.close());

  signOut.addEventListener('click', async () => {
    await onSignOut();
    dialog.close();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = 'Signing in...';
    showError('');
    try {
      await onSignIn(emailInput.value.trim(), passwordInput.value);
      passwordInput.value = '';
      dialog.close();
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    } finally {
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  });

  return {
    open(currentEmail) {
      const signedIn = Boolean(currentEmail);
      who.textContent = signedIn ? `Signed in as ${currentEmail}.` : '';
      who.hidden = !signedIn;
      signOut.hidden = !signedIn;
      form.querySelectorAll('.signin-fields').forEach((node) => { node.hidden = signedIn; });
      emailInput.required = !signedIn;
      passwordInput.required = !signedIn;
      submit.hidden = signedIn;
      showError('');
      dialog.showModal();
      if (!signedIn) emailInput.focus();
    },
  };
}
