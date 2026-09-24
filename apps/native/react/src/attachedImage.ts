// 送信前の添付画像(issue #349)。ファイル選択・貼り付けで受け取った File を、
// Rust へ渡す base64(バイト列)と、サムネイル表示用の data URL にする。
// 形式・サイズ・枚数の判定はここでは行わない(Rust 側の domain が唯一の判定元。
// native.md §1)。
export type AttachedImage = {
  // 一覧のキー・個別に外すための識別子(表示用の UI 状態)。
  id: string;
  // サムネイル表示用(`data:<MIME>;base64,<base64>`)。MIME はブラウザの申告で、
  // 表示にしか使わない(Rust は中身から形式を判定する)。
  dataUrl: string;
  // Rust へ渡す base64(`data:` プレフィックス無し)。
  base64: string;
};

let nextId = 0;

export function readImageFile(file: File): Promise<AttachedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("画像ファイルを読み込めませんでした"));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const comma = dataUrl.indexOf(",");
      if (comma < 0) {
        reject(new Error("画像ファイルを読み込めませんでした"));
        return;
      }
      nextId += 1;
      resolve({ id: `img-${nextId}`, dataUrl, base64: dataUrl.slice(comma + 1) });
    };
    reader.readAsDataURL(file);
  });
}
