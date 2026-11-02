// PhotoShow's existing caller supplies the original-resolution PNG after its
// normal transform pipeline. Safari's native extension writes it locally.
function Oo(content) {
  if (!content) return Promise.reject(new Error('NO_CONTENT_TO_COPY'));
  const payload = typeof content === 'string'
    ? Promise.resolve({ text: content })
    : new Promise((resolve, reject) => {
      if (content.type !== 'image/png') return reject(new Error('CLIPBOARD_IMAGE_MUST_BE_PNG'));
      if (content.size > 32 * 1024 * 1024) return reject(new Error('CLIPBOARD_IMAGE_TOO_LARGE'));
      const reader = new FileReader();
      reader.onload = () => resolve({ png: String(reader.result).split(',')[1] });
      reader.onerror = () => reject(new Error('CLIPBOARD_IMAGE_READ_FAILED'));
      reader.onabort = () => reject(new Error('CLIPBOARD_IMAGE_READ_ABORTED'));
      reader.readAsDataURL(content);
    });
  return payload.then(data => chrome.runtime.sendMessage({ cmd: 'PHOTOSHOW_SAFARI_COPY', data }))
    .then(result => {
      if (!result?.success) throw new Error(result?.error || 'SAFARI_CLIPBOARD_WRITE_FAILED');
    });
}
