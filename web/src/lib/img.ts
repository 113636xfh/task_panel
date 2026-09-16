/** 读本地图片文件为 base64（不含 data: 前缀），供上传接口使用 */
export function fileToBase64(file: File): Promise<{ name: string; data: string }> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result ?? '');
      const i = s.indexOf('base64,');
      resolve({ name: file.name, data: i >= 0 ? s.slice(i + 7) : s });
    };
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsDataURL(file);
  });
}
