export function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  window.dispatchEvent(new CustomEvent('tp-toast', { detail: { msg, kind } }));
}
