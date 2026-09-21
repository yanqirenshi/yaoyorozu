import AddButton from "../AddButton";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createProfile,
  deleteProfile,
  getSettings,
  isAppError,
  onSettingsUpdated,
  switchProfile,
} from "../api";
import type { ProfileSummaryDto } from "../api";
import ProfileSettingsPane from "../ProfileSettingsPane";

// プロファイルの削除ボタンのアイコン。Material Icons の「HighlightOff」
// (ユーザー指示。MUI の `@mui/icons-material` v9.4.0 の
// `material-icons/highlight_off_24px.svg` のパスをそのまま使う。MIT ライセンス)。
// viewBox は MUI の 24×24 のまま。色は文字色(currentColor)を継承する。
function HighlightOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
    </svg>
  );
}

// プロファイル削除の確認ダイアログ。`<dialog>` の showModal() で開くため、表示中は
// 後ろの画面を操作できない(モーダル)。Esc・キャンセル・ダイアログの外側の
// クリックで取り消す。誤操作で消さないよう、最初はキャンセルにフォーカスを置く
// (DOM 上で先に置くと showModal がそこへフォーカスする)。
function DeleteProfileDialog({
  profileName,
  onConfirm,
  onCancel,
}: {
  profileName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    // 開発時の StrictMode では effect が2回走るため、開いていなければ開く。
    // (後始末で close すると close イベントで取り消し扱いになるため、しない)
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    // 閉じるときは close() を呼ばず、親の状態を戻して(アンマウントして)閉じる。
    // close イベントは閉じた後に遅れて届くため、それに頼ると届かなかったときに
    // 閉じたダイアログが残って二度と開けなくなる(確認中に実際に起きた)。
    // onClose は、ほかの経路で閉じた場合の保険として残す。
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby="delete-profile-dialog-title"
      onCancel={(e) => {
        // Esc。ブラウザ既定の閉じ方を止め、親の状態で閉じる。
        e.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
      onClick={(e) => {
        // 外側(背景)のクリックは、中身ではなくダイアログ要素そのものに届く。
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="settings-dialog-body">
        <h3 id="delete-profile-dialog-title">プロファイルを削除</h3>
        <p>プロファイル「{profileName}」を削除しますか?この操作は取り消せません。</p>
        <div className="settings-dialog-actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" className="settings-dialog-danger" onClick={onConfirm}>
            削除する
          </button>
        </div>
      </div>
    </dialog>
  );
}

function SettingsPage() {
  const [profiles, setProfiles] = useState<ProfileSummaryDto[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  // 削除の確認ダイアログを開いている対象(開いていなければ null)。
  const [deleteTarget, setDeleteTarget] = useState<ProfileSummaryDto | null>(null);
  // 右ペイン(ProfileSettingsPane)へ、自分の操作の直後に取り直しを促す(issue #299)。
  const [refreshToken, setRefreshToken] = useState(0);

  // プロファイル一覧・アクティブプロファイルを取り直す。自分自身の操作(作成・
  // 削除・切り替え)の直後と、他画面(dock等)からの切り替え(`settings:updated`)の
  // 両方で使う(issue #72)。プロファイルの内容(設定値)は右ペインが自分で取る。
  const loadSettingsData = useCallback((): Promise<void> => {
    return getSettings()
      .then((settings) => {
        setProfiles(settings.profiles);
        setActiveProfileId(settings.active_profile_id);
      })
      .catch((e) => setProfileError(isAppError(e) ? e.message : String(e)));
  }, []);

  // 自分の操作の後: 一覧を取り直し、右ペインにも取り直しを促す。
  const reloadAll = useCallback((): Promise<void> => {
    return loadSettingsData().then(() => setRefreshToken((n) => n + 1));
  }, [loadSettingsData]);

  useEffect(() => {
    loadSettingsData();
  }, [loadSettingsData]);

  useEffect(() => {
    const unlistenPromise = onSettingsUpdated(() => {
      loadSettingsData();
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [loadSettingsData]);

  const handleCreateProfile = () => {
    setProfileError(null);
    createProfile(newProfileName.trim() || undefined)
      .then(() => {
        setNewProfileName("");
        return reloadAll();
      })
      .catch((e) => setProfileError(isAppError(e) ? e.message : String(e)));
  };

  // 確認ダイアログ(DeleteProfileDialog)で「削除する」が押されてから呼ぶ。
  // window.confirm はアプリのウィンドウ上で確認を出さずに削除が進んでしまった
  // ため使わない。
  const handleDeleteProfile = (profileId: string) => {
    setDeleteTarget(null);
    setProfileError(null);
    deleteProfile(profileId)
      .then(() => reloadAll())
      .catch((e) => setProfileError(isAppError(e) ? e.message : String(e)));
  };

  const handleSwitchProfileFromList = (profileId: string) => {
    if (profileId === activeProfileId) return;
    setProfileError(null);
    switchProfile(profileId)
      .then(() => reloadAll())
      .catch((e) => setProfileError(isAppError(e) ? e.message : String(e)));
  };

  return (
    <>
      {/* 左ペイン: プロファイル一覧+追加。ビューア(`/`)の「左: 一覧 / 右: 内容」と
          同じ画面骨格に揃える(issue #74)。削除は全行に並べるとノイズになるため、
          アクティブな行にだけ、名前の右(行の右端)にアイコンで出す。名前変更は
          右ペインのプロファイル名の横に置く。 */}
      <div className="settings-profile-pane">
        <h2>プロファイル</h2>
        <ul className="settings-profile-list">
          {profiles.map((p) => (
            <li key={p.id} className="settings-profile-row">
              <button
                type="button"
                className={`project-item ${p.id === activeProfileId ? "selected" : ""}`}
                onClick={() => handleSwitchProfileFromList(p.id)}
              >
                <span className="settings-profile-name">{p.name}</span>
              </button>
              {/* 行全体が切り替えボタンで入れ子にできないため、行の右端に重ねて置く。 */}
              {p.id === activeProfileId && (
                <button
                  type="button"
                  className="settings-profile-delete"
                  onClick={() => setDeleteTarget(p)}
                  disabled={profiles.length <= 1}
                  title="削除"
                  aria-label={`${p.name} を削除`}
                >
                  <HighlightOffIcon />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="settings-profile-add">
          <input
            type="text"
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            placeholder="新しいプロファイル名(省略可)"
          />
          <AddButton size="small" onClick={handleCreateProfile} />
        </div>
        {profileError && <p className="error">{profileError}</p>}
      </div>

      {deleteTarget && (
        <DeleteProfileDialog
          profileName={deleteTarget.name}
          onConfirm={() => handleDeleteProfile(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <ProfileSettingsPane
        profileId={null}
        refreshToken={refreshToken}
        onProfileRenamed={loadSettingsData}
      />
    </>
  );
}

export default SettingsPage;
