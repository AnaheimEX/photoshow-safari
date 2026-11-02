(() => {
  'use strict';
  const status = document.getElementById('status');
  const link = document.getElementById('save');
  const preview = document.getElementById('preview');
  let objectUrl;
  const id = location.hash.slice(1);
  async function prepare() {
    if (!/^[\da-f-]{36}$/i.test(id)) throw new Error('保存任务无效，请返回原网页重新保存。');
    const result = await chrome.runtime.sendMessage({ cmd: 'PHOTOSHOW_SAFARI_CLAIM_SAVE', id });
    if (!result?.success) throw new Error(result?.error || '无法连接 PhotoShow，请重新打开保存页。');
    if (typeof result.dataUrl !== 'string' || !result.dataUrl.startsWith('data:')) throw new Error('保存文件数据无效。');
    const blob = await (await fetch(result.dataUrl)).blob();
    objectUrl = URL.createObjectURL(blob);
    const filename = String(result.filename || 'PhotoShow.png').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f:]/g, '_') || 'PhotoShow.png';
    document.getElementById('filename').textContent = filename;
    link.href = objectUrl;
    link.download = filename;
    link.hidden = false;
    if (blob.type.startsWith('image/')) {
      preview.src = objectUrl;
      preview.hidden = false;
    }
    status.textContent = '文件已准备好，请点击下方按钮保存。';
    link.addEventListener('click', () => { status.textContent = '已向 Safari 请求保存，请查看 Safari 的下载状态。'; });
  }
  prepare().catch(error => { status.textContent = error?.message || '无法准备保存文件。'; status.classList.add('error'); });
  window.addEventListener('pagehide', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); });
})();
