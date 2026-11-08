// Login with the server passcode, and pairing from a QR code link.
import { api, ApiRequestError, errorMessage } from '../api.js';
import { navigate, Scope, type View } from '../app.js';
import { h } from '../dom.js';
import { logoMark } from '../logo.js';

/** Guesses a friendly device name such as "iPhone Safari". */
export function guessDeviceName(ua: string = navigator.userAgent): string {
  let device = 'Browser';
  if (/iPhone/.test(ua)) device = 'iPhone';
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) device = 'iPad';
  else if (/Android/.test(ua)) device = /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  else if (/Macintosh|Mac OS X/.test(ua)) device = 'Mac';
  else if (/Windows/.test(ua)) device = 'Windows PC';
  else if (/CrOS/.test(ua)) device = 'Chromebook';
  else if (/Linux/.test(ua)) device = 'Linux PC';

  let browser = '';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Firefox\/|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return browser ? `${device} ${browser}` : device;
}

function loginErrorText(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.status === 429) {
      return err.message || 'Too many attempts. Wait a few minutes and try again.';
    }
    if (err.status === 401 || err.status === 403) {
      return err.message || 'That passcode is not right.';
    }
  }
  return errorMessage(err);
}

function brandBlock(subtitle: string): HTMLElement {
  return h(
    'div',
    { class: 'auth-brand' },
    h('span', { class: 'auth-logo' }, logoMark(40)),
    h('h1', { class: 'auth-title', text: 'longcord', attrs: { tabindex: '-1' } }),
    h('p', { class: 'muted', text: subtitle }),
  );
}

export function loginView(_scope: Scope, onSuccess: () => void): View {
  const error = h('p', { class: 'form-error', attrs: { role: 'alert' } });
  const passcode = h('input', {
    class: 'input',
    id: 'login-passcode',
    testid: 'login-passcode',
    attrs: {
      type: 'password',
      autocomplete: 'current-password',
      required: true,
      autocapitalize: 'off',
      spellcheck: 'false',
    },
  });
  const device = h('input', {
    class: 'input',
    id: 'login-device',
    attrs: { type: 'text', autocomplete: 'off', maxlength: 60 },
  });
  device.value = guessDeviceName();
  const submit = h('button', {
    class: 'btn btn-primary btn-block',
    text: 'Sign in',
    testid: 'login-submit',
    attrs: { type: 'submit' },
  });

  const form = h(
    'form',
    {
      class: 'auth-form',
      on: {
        submit: (ev) => {
          ev.preventDefault();
          void (async () => {
            error.textContent = '';
            if (!passcode.value) {
              error.textContent =
                'Enter the passcode you chose during setup. To set a new one, run `longcord passcode` on your computer.';
              passcode.focus();
              return;
            }
            submit.disabled = true;
            try {
              await api.login({
                passcode: passcode.value,
                deviceName: device.value.trim() || undefined,
              });
              passcode.value = '';
              onSuccess();
            } catch (err) {
              error.textContent = loginErrorText(err);
              passcode.select();
            } finally {
              submit.disabled = false;
            }
          })();
        },
      },
    },
    h('label', { class: 'label', text: 'Passcode', attrs: { for: 'login-passcode' } }),
    passcode,
    h('label', { class: 'label', text: 'Device name', attrs: { for: 'login-device' } }),
    device,
    h('p', {
      class: 'hint',
      text: 'Shown in Settings > Devices on your other devices so you can revoke it later.',
    }),
    error,
    submit,
  );

  const el = h(
    'main',
    { class: 'auth', attrs: { id: 'main' } },
    brandBlock('Sign in to the longcord server on your computer.'),
    form,
    h('p', {
      class: 'hint center',
      text: 'Forgot it? Run `longcord passcode` on your computer to set a new one. Or run `longcord pair` and scan the QR code to sign in without typing.',
    }),
  );
  return { el, focus: passcode };
}

export function pairView(_scope: Scope, token: string, onSuccess: () => void): View {
  // Do not keep the one-time token in the address bar or history.
  history.replaceState(null, '', '#/pair');

  const status = h('p', {
    class: 'muted center',
    text: 'Pairing this device…',
    attrs: { role: 'status' },
  });
  const error = h('p', { class: 'form-error', attrs: { role: 'alert' } });
  const device = h('input', {
    class: 'input',
    id: 'pair-device',
    attrs: { type: 'text', autocomplete: 'off', maxlength: 60 },
  });
  device.value = guessDeviceName();
  const retry = h('button', {
    class: 'btn btn-primary btn-block',
    text: 'Pair this device',
    attrs: { type: 'submit' },
  });
  const form = h(
    'form',
    {
      class: 'auth-form',
      attrs: { hidden: true },
      on: {
        submit: (ev) => {
          ev.preventDefault();
          void run();
        },
      },
    },
    h('label', { class: 'label', text: 'Device name', attrs: { for: 'pair-device' } }),
    device,
    error,
    retry,
    h('a', {
      class: 'btn btn-block',
      text: 'Sign in with passcode instead',
      attrs: { href: '#/login' },
    }),
  );

  async function run(): Promise<void> {
    retry.disabled = true;
    error.textContent = '';
    status.textContent = 'Pairing this device…';
    try {
      await api.pair({ token, deviceName: device.value.trim() || undefined });
      status.textContent = 'Paired.';
      onSuccess();
    } catch (err) {
      status.textContent = '';
      error.textContent =
        err instanceof ApiRequestError &&
        (err.status === 401 || err.status === 410 || err.status === 404)
          ? `${err.message} Pairing links work once and expire after 10 minutes. Run \`longcord pair\` on your computer and scan the new QR code.`
          : loginErrorText(err);
      form.hidden = false;
    } finally {
      retry.disabled = false;
    }
  }

  void run();

  const el = h(
    'main',
    { class: 'auth', attrs: { id: 'main' } },
    brandBlock('Pair this device with your computer.'),
    status,
    form,
  );
  return { el };
}

export function goHomeAfterAuth(): void {
  navigate('#/', true);
}
