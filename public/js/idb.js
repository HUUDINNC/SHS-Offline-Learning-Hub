const IDB_NAME = 'shs_offline_hub_db';
const IDB_VERSION = 1;

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('resources')) {
        db.createObjectStore('resources', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('curriculum')) {
        db.createObjectStore('curriculum', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(storeName, value) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(storeName, key) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(storeName) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName, key) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

window.OfflineStore = {
  saveResourceOffline: async (resourceMeta, blob) => {
    await idbPut('resources', { ...resourceMeta, cached_at: new Date().toISOString() });
    await idbPut('files', { id: resourceMeta.id, blob, mime_type: resourceMeta.mime_type });
  },
  removeResourceOffline: async (id) => {
    await idbDelete('resources', id);
    await idbDelete('files', id);
  },
  getOfflineResource: async (id) => {
    const meta = await idbGet('resources', id);
    const file = await idbGet('files', id);
    if (!meta || !file) return null;
    return { meta, file };
  },
  getAllOfflineResources: async () => idbGetAll('resources'),
  saveCurriculumOffline: async (data) => idbPut('curriculum', { key: 'main', data }),
  getCurriculumOffline: async () => {
    const record = await idbGet('curriculum', 'main');
    return record ? record.data : null;
  }
};