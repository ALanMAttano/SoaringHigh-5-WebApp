// Google sign-in (Google Identity Services token model) + Drive appDataFolder access for the PWA.
// The access token lives only in memory (and sessionStorage for this tab); there is no refresh token in the browser.
import { FILE_NAME } from './merge.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN_KEY = 'sh5.token';

export class DriveError extends Error {
  constructor(status) { super(`Drive ${status}`); this.status = status; }
}

export class GoogleAuth {
  constructor(clientId) {
    this.clientId = clientId;
    this.client = null;
    const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    this.token = saved && saved.expiresAt > Date.now() + 60_000 ? saved : null;
  }

  get configured() { return !!this.clientId && !this.clientId.startsWith('PASTE-'); }
  get hasToken() { return !!this.token && this.token.expiresAt > Date.now() + 60_000; }

  /** Opens Google's popup when needed (prompt '' reuses the consent given before). */
  request(interactive) {
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) return reject(new Error('gis-not-loaded'));
      this.client ??= google.accounts.oauth2.initTokenClient({ client_id: this.clientId, scope: SCOPE, callback: () => {} });
      this.client.callback = (r) => {
        if (r.error) return reject(new Error(r.error));
        this.token = { value: r.access_token, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
        sessionStorage.setItem(TOKEN_KEY, JSON.stringify(this.token));
        resolve(this.token.value);
      };
      this.client.error_callback = (e) => reject(new Error(e?.type || 'popup'));
      this.client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    });
  }

  async accessToken() {
    if (this.hasToken) return this.token.value;
    return this.request(false);
  }

  signOut() {
    if (this.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(this.token.value, () => {});
    this.token = null;
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

/** Same operations as the desktop's GoogleDriveStore. */
export class DriveStore {
  constructor(auth) { this.auth = auth; }

  async send(method, url, body, contentType) {
    const headers = { Authorization: `Bearer ${await this.auth.accessToken()}` };
    if (contentType) headers['Content-Type'] = contentType;
    const r = await fetch(url, { method, headers, body });
    if (!r.ok) throw new DriveError(r.status);
    return r.text();
  }

  async find() {
    const q = encodeURIComponent(`name = '${FILE_NAME}' and trashed = false`);
    const json = JSON.parse(await this.send('GET', `${FILES}?spaces=appDataFolder&q=${q}&fields=files(id,version)&orderBy=modifiedTime desc`));
    return json.files?.[0] ?? null;
  }

  download(id) { return this.send('GET', `${FILES}/${encodeURIComponent(id)}?alt=media`); }

  async version(id) { return JSON.parse(await this.send('GET', `${FILES}/${encodeURIComponent(id)}?fields=id,version`)).version; }

  async create(content) {
    const boundary = 'sh5' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`
      + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    return JSON.parse(await this.send('POST', `${UPLOAD}?uploadType=multipart&fields=id,version`, body, `multipart/related; boundary=${boundary}`));
  }

  update(id, content) { return this.send('PATCH', `${UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=id,version`, content, 'application/json'); }
}
