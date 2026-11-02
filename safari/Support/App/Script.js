function show(enabled) {
  document.getElementById('state').textContent = enabled === true ? '扩展已启用。请确认网站权限，并重新加载需要预览图片的网页。' : enabled === false ? '扩展尚未启用。请先允许未签名扩展，再到扩展列表启用。' : '请在 Safari 设置中检查扩展是否已启用。';
}
function showError() { document.getElementById('error').hidden = false; }
document.getElementById('preferences').addEventListener('click', function () { window.webkit.messageHandlers.controller.postMessage('open-preferences'); });
