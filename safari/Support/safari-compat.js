/* Safari performs image conversion in its nonpersistent DOM background page.
 * The original offscreen.js supplies the image implementation; calling it
 * directly avoids sending runtime messages back to their own sender. */
(() => {
  'use strict';
  const operations = Object.freeze({
    CANCEL_TASKS: 'cancelTasks',
    GET_IMAGE_OBJECT_URL: 'getImageObjectUrl',
    REVOKE_OBJECT_URLS: 'revokeObjectUrls',
  });
  const ownedUrls = new Set();
  const saves = new Map();
  const MAX_BYTES = 32 * 1024 * 1024;
  const MAX_SAVES = 4;
  const SAVE_TTL = 2 * 60 * 1000;
  const claimCommand = 'PHOTOSHOW_SAFARI_CLAIM_SAVE';
  // Native messages are available only in extension pages, so relay our own
  // content script's copy command through this background. Never accept URLs.
  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (message?.cmd !== 'PHOTOSHOW_SAFARI_COPY') return false;
      if (sender?.id !== chrome.runtime.id) {
        respond({ success: false, error: 'INVALID_CLIPBOARD_SENDER' });
        return false;
      }
      const data = message.data;
      const validText = typeof data?.text === 'string' && data.png === undefined && data.text.length <= 1024 * 1024;
      const validPng = typeof data?.png === 'string' && data.text === undefined && data.png.length <= 44739244;
      if (!validText && !validPng) {
        respond({ success: false, error: 'INVALID_CLIPBOARD_PAYLOAD' });
        return false;
      }
      Promise.resolve().then(() => chrome.runtime.sendNativeMessage('com.anaheim.photoshow.safari', {
        command: 'copy', ...(validText ? { text: data.text } : { png: data.png })
      })).then(result => respond(result?.success === true ? { success: true }
        : { success: false, error: result?.error || 'SAFARI_CLIPBOARD_WRITE_FAILED' }))
        .catch(() => respond({ success: false, error: 'SAFARI_CLIPBOARD_CONNECTION_FAILED' }));
      return true;
    });
  }

  let imageTasks;

  function releaseSave(id) {
    const entry = saves.get(id);
    if (!entry) return;
    saves.delete(id);
    clearTimeout(entry.timer);
    ownedUrls.delete(entry.sourceUrl);
    URL.revokeObjectURL(entry.sourceUrl);
    entry.dataUrl = null;
  }

  function toDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('无法准备 Safari 保存文件。'));
      reader.onabort = () => reject(new Error('Safari 保存准备已取消。'));
      reader.readAsDataURL(blob);
    });
  }

  function basename(value) {
    return String(value || 'PhotoShow.png').split(/[\\/]/).pop()
      .replace(/[\u0000-\u001f\u007f:]/g, '_').slice(0, 240) || 'PhotoShow.png';
  }

  // Only our own extension save page may redeem a one-use payload.
  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (message?.cmd !== claimCommand) return;
      const pageUrl = chrome.runtime.getURL('safari/save.html');
      const senderUrl = sender?.url?.split(/[?#]/)[0];
      if (senderUrl !== pageUrl || (sender.id && sender.id !== chrome.runtime.id)) {
        respond({ success: false, error: '此页面无权领取保存文件。' });
        return;
      }
      const entry = saves.get(message.id);
      if (!entry?.dataUrl) {
        respond({ success: false, error: '保存任务已过期或已领取。请返回原网页重新保存。' });
        return;
      }
      const payload = { success: true, dataUrl: entry.dataUrl, filename: entry.filename };
      releaseSave(message.id);
      respond(payload);
    });
  }

  globalThis.SafariPhotoShow = Object.freeze({
    installImageTasks(tasks) {
      if (!tasks || Object.values(operations).some(name => typeof tasks[name] !== 'function')) {
        throw new Error('PhotoShow Safari 图片处理组件不完整。');
      }
      imageTasks = tasks;
    },
    runImageTask(action, ...args) {
      return Promise.resolve().then(() => {
        const name = Object.hasOwn(operations, action) ? operations[action] : undefined;
        if (!name) throw new Error(`PhotoShow Safari 不支持此图片操作：${String(action)}`);
        if (!imageTasks) throw new Error('PhotoShow Safari 图片处理组件尚未加载。');
        return imageTasks[name](...args);
      }).then(result => {
        if (action === 'GET_IMAGE_OBJECT_URL' && result?.url?.startsWith('blob:')) ownedUrls.add(result.url);
        if (action === 'REVOKE_OBJECT_URLS') for (const url of [].concat(args[0] || [])) ownedUrls.delete(url);
        return result;
      });
    },
    async openSaveBlob({ url, filename } = {}) {
      const extensionBlobPrefix = `blob:${chrome.runtime.getURL('')}`;
      if (!ownedUrls.has(url) && !(typeof url === 'string' && url.startsWith(extensionBlobPrefix))) {
        throw new Error('只能保存由 PhotoShow 生成的文件。');
      }
      if (saves.size >= MAX_SAVES) {
        // Only release URLs this layer actually created; a merely
        // prefix-matching blob URL may still belong to the background.
        if (ownedUrls.delete(url)) URL.revokeObjectURL(url);
        throw new Error('同时准备的保存文件过多，请稍后重试。');
      }
      const id = crypto.randomUUID();
      const entry = { sourceUrl: url, filename: basename(filename), dataUrl: null };
      saves.set(id, entry);
      entry.timer = setTimeout(() => releaseSave(id), SAVE_TTL);
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('无法读取待保存文件。');
        const blob = await response.blob();
        if (blob.size > MAX_BYTES) throw new Error('Safari 保存页仅支持 32 MB 以内的文件，请打开原图后使用 Safari 保存。');
        const dataUrl = await toDataUrl(blob);
        if (!saves.has(id)) throw new Error('保存任务已过期，请重新保存。');
        entry.dataUrl = dataUrl;
        await chrome.tabs.create({ url: `${chrome.runtime.getURL('safari/save.html')}#${id}`, active: true });
        // Opening this page does not establish that Safari saved the file.
        return { opened: true };
      } catch (error) {
        releaseSave(id);
        throw error;
      }
    },
  });
})();

