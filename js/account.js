// Account dialog: Sign in / Sign up tabs, plus Sign out when signed in.
// main.js supplies the async handlers; errors are shown inline.

import { $ } from './dom.js';

export function createAccountDialog(dialog, { onSignIn, onSignUp, onSignOut }) {
  const tabs = $('#account-tabs', dialog);
  const tabSignIn = $('#tab-signin', dialog);
  const tabSignUp = $('#tab-signup', dialog);
  const signInForm = $('#signin-form', dialog);
  const signUpForm = $('#signup-form', dialog);
  const signedInPanel = $('#signedin-panel', dialog);
  const who = $('#signedin-user', dialog);

  const f = {
    username: $('#f-username', dialog),
    pin: $('#f-pin', dialog),
    newUsername: $('#f-new-username', dialog),
    newPin: $('#f-new-pin', dialog),
    invite: $('#f-invite', dialog),
  };
  const errors = {
    signin: $('#signin-error', dialog),
    signup: $('#signup-error', dialog),
  };

  const showError = (box, message) => {
    box.textContent = message;
    box.hidden = !message;
  };

  function showTab(name) {
    const signIn = name === 'signin';
    tabSignIn.classList.toggle('active', signIn);
    tabSignUp.classList.toggle('active', !signIn);
    tabSignIn.setAttribute('aria-selected', String(signIn));
    tabSignUp.setAttribute('aria-selected', String(!signIn));
    signInForm.hidden = !signIn;
    signUpForm.hidden = signIn;
    (signIn ? f.username : f.newUsername).focus();
  }

  tabSignIn.addEventListener('click', () => showTab('signin'));
  tabSignUp.addEventListener('click', () => showTab('signup'));

  for (const id of ['#signin-cancel', '#signup-cancel', '#signedin-close']) {
    $(id, dialog).addEventListener('click', () => dialog.close());
  }

  $('#signedin-signout', dialog).addEventListener('click', async () => {
    await onSignOut();
    dialog.close();
  });

  async function submit(event, button, busyLabel, errorBox, action) {
    event.preventDefault();
    const label = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
    showError(errorBox, '');
    try {
      await action();
      dialog.close();
    } catch (err) {
      showError(errorBox, err && err.message ? err.message : String(err));
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  signInForm.addEventListener('submit', (event) => submit(
    event, $('#signin-submit', dialog), 'Signing in...', errors.signin,
    async () => {
      await onSignIn(f.username.value, f.pin.value);
      f.pin.value = '';
    },
  ));

  signUpForm.addEventListener('submit', (event) => submit(
    event, $('#signup-submit', dialog), 'Creating...', errors.signup,
    async () => {
      await onSignUp(f.newUsername.value, f.newPin.value, f.invite.value);
      f.newPin.value = '';
      f.invite.value = '';
    },
  ));

  return {
    // user is { username } when signed in, or null.
    open(user, tab = 'signin') {
      const signedIn = Boolean(user);
      tabs.hidden = signedIn;
      signedInPanel.hidden = !signedIn;
      showError(errors.signin, '');
      showError(errors.signup, '');
      if (signedIn) {
        who.textContent = `Signed in as @${user.username}${user.isAdmin ? ' (admin)' : ''}.`;
        signInForm.hidden = true;
        signUpForm.hidden = true;
        dialog.showModal();
        return;
      }
      dialog.showModal();
      showTab(tab);
    },
  };
}
