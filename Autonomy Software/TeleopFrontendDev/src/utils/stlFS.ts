// src/utils/stlFS.ts
// Persist a local STL file *handle* using the File System Access API + IndexedDB.
// Works on Chromium-based browsers under https or http://localhost.

const DB_NAME = 'stl-handle-db';
const STORE = 'kv';
const HANDLE_KEY = 'stl_file_handle_v1';

// --- IndexedDB helpers ---
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T = any>(key: string): Promise<T | undefined> {
  return openDb().then(
    db =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const st = tx.objectStore(STORE);
        const req = st.get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbSet(key: string, val: any): Promise<void> {
  return openDb().then(
    db =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const st = tx.objectStore(STORE);
        const req = st.put(val, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
  );
}

function idbDel(key: string): Promise<void> {
  return openDb().then(
    db =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const st = tx.objectStore(STORE);
        const req = st.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
  );
}

// --- Feature checks ---
export function supportsFSAccess(): boolean {
  return typeof (window as any).showOpenFilePicker === 'function';
}

// --- Public API ---

/** Prompts user to pick an STL file once and saves the handle in IndexedDB. */
export async function pickAndSaveStlHandle(): Promise<boolean> {
  if (!supportsFSAccess()) {
    alert('Your browser does not support the File System Access API. Use Chrome/Edge/Brave on https or localhost.');
    return false;
  }
  const [handle]: any = await (window as any).showOpenFilePicker({
    types: [{ description: 'STL', accept: { 'model/stl': ['.stl'], 'application/octet-stream': ['.stl'] } }],
    excludeAcceptAllOption: true,
    multiple: false,
  });
  if (!handle) return false;
  await idbSet(HANDLE_KEY, handle);
  return true;
}

/** Load the previously saved handle from IndexedDB (if any). */
export async function getSavedStlHandle(): Promise<FileSystemFileHandle | null> {
  const h = (await idbGet<FileSystemFileHandle>(HANDLE_KEY)) ?? null;
  return h as any;
}

/** Remove the saved handle from IndexedDB. */
export async function clearSavedStlHandle(): Promise<void> {
  await idbDel(HANDLE_KEY);
}

/** Ensure we have read permission for a given handle; request if promptable. */
export async function ensureReadPermission(handle: any): Promise<boolean> {
  if (!handle?.queryPermission) return false;
  let p = await handle.queryPermission({ mode: 'read' });
  if (p === 'granted') return true;
  if (p === 'prompt') {
    p = await handle.requestPermission({ mode: 'read' });
    return p === 'granted';
  }
  return false;
}

/** Given a saved handle, read it and return a fresh blob: URL (caller should revoke when done). */
export async function blobUrlFromHandle(handle: any): Promise<string> {
  const file = await handle.getFile();
  return URL.createObjectURL(file);
}
