// One sync round, mirroring SyncEngine.cs: find/download → merge → upload when different; re-merge if the file
// changed in between. `drive` is a DriveStore or a fake (tests).
import { merge, parseDocument, sameContent } from './merge.js';

export const MAX_ATTEMPTS = 3;

export async function syncOnce(drive, local, snapshot, deviceId, now = () => Date.now()) {
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const file = await drive.find();
      if (!file) {
        const first = merge(local, null, snapshot, now(), deviceId);
        await drive.create(JSON.stringify(first));
        return { status: 'synced', merged: first, uploaded: true };
      }
      const remote = parseDocument(await drive.download(file.id));
      if (!remote) return { status: 'failed' }; // never overwrite a file we cannot read
      const merged = merge(local, remote, snapshot, now(), deviceId);
      if (sameContent(merged, remote)) return { status: 'synced', merged, uploaded: false };
      if ((await drive.version(file.id)) !== file.version) continue;
      await drive.update(file.id, JSON.stringify(merged));
      return { status: 'synced', merged, uploaded: true };
    }
    return { status: 'busy' };
  } catch (e) {
    if (e?.status === 401 || e?.status === 403) return { status: 'authFailed' };
    if (e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { status: 'offline' };
    if (e?.message === 'popup_closed' || e?.message === 'popup_failed_to_open' || e?.message === 'gis-not-loaded') return { status: 'authFailed' };
    return { status: 'failed' };
  }
}
