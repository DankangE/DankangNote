// Yjs가 내놓는 바이트열(문서 델타·awareness 업데이트)을 JSON에 실을 수 있게 감싼다.
// 두 경로(HTTP POST·Pusher 이벤트)가 같은 인코딩을 써야 해서 한 곳에 둔다.

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function toBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
