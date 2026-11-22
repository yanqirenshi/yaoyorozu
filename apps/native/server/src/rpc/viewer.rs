//! ビューア(閲覧と編集)系の command。写し元: `tauri/src/lib.rs` の `list_projects`・`list_sessions`・
//! `get_session`・`get_session_line_raw`・`get_session_line_images`・`check_image_attachment`・
//! `get_project_claude_md`・`save_project_claude_md`・`list_rules`・`get_rule`・`list_skills`・
//! `get_skill`・`get_project_settings_file`・`save_project_settings_file`、`tauri/src/yyz_scaffold.rs`。
//!
//! パスはクライアントから受け取らない: 会話ファイルは `<ルート>/<project>/<sessionId>.jsonl` で、
//! `project`・`sessionId` の検証は `app` 層が行う。リポジトリは `profileId` から settings の
//! `repository_path` を引く(`app::resolve_repository_dir`。未設定は `invalid_input`)。

use crate::dto::{
    ClaudeMdDto, ClaudeSettingsDto, ConversationDto, MessageImageDto, ProjectDto,
    ProjectSettingsFileDto, RuleDto, RuleSummaryDto, SessionSummaryDto, SkillDto, SkillSummaryDto,
    YyzScaffoldStatusDto,
};
use crate::error::ApiError;
use crate::rpc::{blocking, parse_args};
use crate::state::resolve_effective_projects_dir;
use crate::AppContext;
use axum::body::Bytes;
use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use std::path::PathBuf;

/// 有効なセッションのルート(`~/.claude/projects` か、設定の上書き)。
pub(crate) async fn effective_projects_dir(ctx: &AppContext) -> Result<PathBuf, ApiError> {
    let settings = ctx.state.lock().await.settings.clone();
    Ok(resolve_effective_projects_dir(&settings)?)
}

/// プロファイルの `repository_path` を引く(ビューアの CLAUDE.md / Rules / Skills / settings 系。
/// issue #269)。クライアントからパスは受け取らない。`profile_id` が `None` ならアクティブ。
async fn repository_dir_for_profile(
    ctx: &AppContext,
    profile_id: Option<&str>,
) -> Result<PathBuf, ApiError> {
    let settings = ctx.state.lock().await.settings.clone();
    let repo = app::resolve_repository_dir(&settings, profile_id)?;
    // すでに保存されている値が不正(古い版や手書きで入った相対・UNC・`..` 入りなど)なら、起動は止めず、
    // この値を起点にした読み書きだけを断る(設定画面で直す)。
    crate::folders::guard_folder_path(&repo.to_string_lossy()).map_err(|e| match e {
        app::AppError::InvalidInput(why) => app::AppError::InvalidInput(format!(
            "保存されている対象リポジトリのパスが不正です(設定で直してください): {why}"
        )),
        other => other,
    })?;
    Ok(repo)
}

pub async fn list_projects(
    State(ctx): State<AppContext>,
) -> Result<Json<Vec<ProjectDto>>, ApiError> {
    let root = effective_projects_dir(&ctx).await?;
    let projects = blocking(move || {
        let source = infra::FileSystemRepository::new(root);
        let projects = app::list_projects(&source)?;
        Ok(projects.into_iter().map(ProjectDto::from).collect())
    })
    .await?;
    Ok(Json(projects))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsArgs {
    project: String,
}

/// セッションの一覧。アーカイブ済みの印(`archived`)は、データフォルダの `archived-sessions.json` を
/// 読むだけで付ける(アーカイブの操作そのものは段階 3)。
pub async fn list_sessions(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<Vec<SessionSummaryDto>>, ApiError> {
    let args: ListSessionsArgs = parse_args(&body)?;
    check_project(&args.project)?;
    let root = effective_projects_dir(&ctx).await?;
    let archived_path = ctx.data_dir.join("archived-sessions.json");
    let project = args.project.clone();
    let watch = crate::corruption::Watch::start(&ctx.data_dir, "archived-sessions.json");
    let data_dir = ctx.data_dir.as_ref().clone();
    let (list, skipped) = blocking(move || {
        crate::session_ids::normalize_stores(&data_dir);
        let source = infra::FileSystemRepository::new(root);
        // 壊れた・読めない会話ファイルは飛ばして、残りを返す(1 つで一覧全体が失敗しない)。
        let listed = app::list_sessions_lenient(&source, &args.project)?;
        let archived =
            app::load_archived_sessions(&infra::FileArchivedSessionsStore::new(archived_path))?;
        let sessions = listed
            .sessions
            .into_iter()
            .map(|session| {
                let is_archived = archived.is_archived(&crate::session_ids::canonical(&session.id));
                let mut dto = SessionSummaryDto::from(session);
                dto.archived = is_archived;
                dto
            })
            .collect::<Vec<_>>();
        Ok((sessions, listed.skipped_files))
    })
    .await?;
    watch.report(&ctx).await;
    notify_skipped_sessions(&ctx, &project, &skipped).await;
    Ok(Json(list))
}

/// 飛ばした会話ファイルを、画面の警告(`app:warning`)で知らせる。同じ内容を何度も出さない
/// (一覧は `session:changed` のたびに取り直されるため。控え(`list_pending_warnings`)にも積み、
/// 画面を開いたあと・つなぎ直したあとにも出る)。
async fn notify_skipped_sessions(ctx: &AppContext, project: &str, skipped: &[String]) {
    if skipped.is_empty() {
        return;
    }
    // 各ファイルの今の指紋(サイズ, 先頭の中身。更新時刻は使わない)。閉じられた警告は、ファイルが実際に変わるまで出さない。
    let root = match effective_projects_dir(ctx).await {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut sources: Vec<crate::state::SkipSource> = Vec::new();
    {
        let state = ctx.state.lock().await;
        for name in skipped {
            let fingerprint = crate::dismissed::fingerprint(&root.join(project).join(name));
            if state
                .dismissed_skips
                .get(&(project.to_string(), name.clone()))
                == Some(&fingerprint)
            {
                continue;
            }
            sources.push(crate::state::SkipSource {
                project: project.to_string(),
                file_name: name.clone(),
                fingerprint,
            });
        }
    }
    if sources.is_empty() {
        return;
    }
    let mut names: Vec<String> = sources.iter().map(|s| s.file_name.clone()).collect();
    names.sort();
    let shown: Vec<&str> = names.iter().take(5).map(String::as_str).collect();
    let more = names.len().saturating_sub(shown.len());
    let message = format!(
        "{} 件の会話ファイルを読めなかったため、一覧から飛ばしました({project}): {}{}",
        names.len(),
        shown.join("、"),
        if more > 0 {
            format!(" ほか {more} 件")
        } else {
            String::new()
        }
    );
    let pushed = ctx
        .state
        .lock()
        .await
        .push_skip_warning(project, message.clone(), sources);
    if let Some(id) = pushed {
        ctx.events.emit(
            "app:warning",
            &crate::dto::AppWarningEventDto {
                message,
                id: Some(id),
            },
        );
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSessionArgs {
    project: String,
    session_id: String,
    offset: usize,
    limit: usize,
}

pub async fn get_session(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<ConversationDto>, ApiError> {
    let args: GetSessionArgs = parse_args(&body)?;
    check_session(&args.project, &args.session_id)?;
    let root = effective_projects_dir(&ctx).await?;
    let conversation_file_path = root
        .join(&args.project)
        .join(format!("{}.jsonl", args.session_id));

    // 解析済みキャッシュ(ファイルの状態とセット)を控える。状態が変わっていなければ、
    // ページ送りで会話ファイルを読み直さない(issue #350)。
    let cached = ctx
        .state
        .lock()
        .await
        .loaded_messages
        .get(&conversation_file_path)
        .cloned();

    let opened = blocking(move || {
        let source = infra::FileSystemRepository::new(root);
        app::open_session(
            &source,
            cached.as_ref(),
            &args.project,
            &args.session_id,
            args.offset,
            args.limit,
        )
    })
    .await?;

    // 読み直した場合だけ、メッセージ・LogLine のキャッシュを差し替える。
    if let Some(reloaded) = opened.reloaded {
        ctx.state
            .lock()
            .await
            .store_loaded_session(conversation_file_path, reloaded);
    }
    Ok(Json(opened.conversation.into()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineArgs {
    project: String,
    session_id: String,
    uuid: String,
}

/// メッセージ(会話チェーン行の `uuid`)の元の jsonl 行を、生のテキストで返す(読み取りのみ)。
pub async fn get_session_line_raw(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<String>, ApiError> {
    let args: LineArgs = parse_args(&body)?;
    check_session(&args.project, &args.session_id)?;
    let root = effective_projects_dir(&ctx).await?;
    let raw = blocking(move || {
        let source = infra::FileSystemRepository::new(root);
        app::get_session_line_raw(&source, &args.project, &args.session_id, &args.uuid)
    })
    .await?;
    Ok(Json(raw))
}

/// 指定メッセージに含まれる画像を返す(オンデマンド取得)。
pub async fn get_session_line_images(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<Vec<MessageImageDto>>, ApiError> {
    let args: LineArgs = parse_args(&body)?;
    check_session(&args.project, &args.session_id)?;
    let root = effective_projects_dir(&ctx).await?;
    let images = blocking(move || {
        let source = infra::FileSystemRepository::new(root);
        app::get_session_line_images(&source, &args.project, &args.session_id, &args.uuid)
    })
    .await?;
    Ok(Json(
        images.into_iter().map(MessageImageDto::from).collect(),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckImageArgs {
    data: String,
    existing_count: usize,
}

/// 画像の添付の上限(サーバ独自の Query)。数字は `domain` の定数から求める(画面に数字を持たせない)。
pub async fn get_attachment_limits() -> Json<crate::dto::AttachmentLimitsDto> {
    Json(crate::dto::AttachmentLimitsDto {
        max_image_bytes: (domain::MAX_IMAGE_BASE64_LEN as u64) * 3 / 4,
        max_images: domain::MAX_IMAGES_PER_MESSAGE,
    })
}

/// 画像を 1 枚添付しようとしたときの事前検証(形式・サイズ・枚数。issue #349)。
pub async fn check_image_attachment(body: Bytes) -> Result<Json<()>, ApiError> {
    let args: CheckImageArgs = parse_args(&body)?;
    blocking(move || app::check_image_attachment(&args.data, args.existing_count)).await?;
    Ok(Json(()))
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileArgs {
    profile_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMdArgs {
    profile_id: Option<String>,
    content: String,
    expected_modified_at_ms: Option<u64>,
}

pub async fn get_project_claude_md(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<ClaudeMdDto>, ApiError> {
    let args: ProfileArgs = parse_args(&body)?;
    let repo_dir = repository_dir_for_profile(&ctx, args.profile_id.as_deref()).await?;
    let dto = blocking(move || {
        let store = infra::FileClaudeMdStore::new();
        Ok(ClaudeMdDto::from(app::read_claude_md(&store, &repo_dir)?))
    })
    .await?;
    Ok(Json(dto))
}

pub async fn save_project_claude_md(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: SaveMdArgs = parse_args(&body)?;
    let repo_dir = repository_dir_for_profile(&ctx, args.profile_id.as_deref()).await?;
    // 「更新時刻を確かめる → 書く」を、ほかの保存に割り込まれずにひとまとまりで行う。
    let _lane = ctx.file_lane.lock().await;
    blocking(move || {
        let store = infra::FileClaudeMdStore::new();
        app::save_claude_md(
            &store,
            &repo_dir,
            &args.content,
            args.expected_modified_at_ms,
        )
    })
    .await?;
    Ok(Json(()))
}

pub async fn list_rules(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<Vec<RuleSummaryDto>>, ApiError> {
    let args: ProfileArgs = parse_args(&body)?;
    let repo_dir = repository_dir_for_profile(&ctx, args.profile_id.as_deref()).await?;
    let rules = blocking(move || {
        let store = infra::FileRulesStore::new();
        let rules = app::list_rules(&store, &repo_dir)?;
        Ok(rules
            .into_iter()
            .map(RuleSummaryDto::from)
            .collect::<Vec<_>>())
    })
    .await?;
    Ok(Json(rules))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetRuleArgs {
    profile_id: Option<String>,
    file_name: String,
}

pub async fn get_rule(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<RuleDto>, ApiError> {
    let args: GetRuleArgs = parse_args(&body)?;
    reject_colon(&args.file_name, "ファイル名")?;
    let repo_dir = repository_dir_for_profile(&ctx, args.profile_id.as_deref()).await?;
    let dto = blocking(move || {
        let store = infra::FileRulesStore::new();
        let content = app::get_rule(&store, &repo_dir, &args.file_name)?;
        Ok(RuleDto { content })
    })
    .await?;
    Ok(Json(dto))
}

pub async fn list_skills(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<Vec<SkillSummaryDto>>, ApiError> {
    let args: ProfileArgs = parse_args(&body)?;
    let repo_dir = repository_dir_for_profile(&ctx, args.profile_id.as_deref()).await?;
    let skills = blocking(move || {
        let store = infra::FileSkillsStore::new();
        let skills = app::list_skills(&store, &repo_dir)?;
        Ok(skills
            .into_iter()
            .map(SkillSummaryDto::from)
            .collect::<Vec<_>>())
    })
    .await?;
    Ok(Json(skills))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSkillArgs {
    profile_id: Option<String>,
    name: String,
}

pub async fn get_skill(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<SkillDto>, ApiError> {
    let args: GetSkillArgs = parse_args(&body)?;
    reject_colon(&args.name, "スキル名")?;
    let repo_dir = repository_dir_for_profile(&ctx, args.profile_id.as_deref()).await?;
    let dto = blocking(move || {
        let store = infra::FileSkillsStore::new();
        let content = app::get_skill(&store, &repo_dir, &args.name)?;
        Ok(SkillDto { content })
    })
    .await?;
    Ok(Json(dto))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetProjectSettingsArgs {
    profile_id: Option<String>,
    which: ProjectSettingsFileDto,
}

/// プロファイルのリポジトリの `.claude/settings.json` / `settings.local.json` を読む。
/// `which` で対象を選ぶ(ファイル名の自由入力は受けない。native.md §4)。
pub async fn get_project_settings_file(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<ClaudeSettingsDto>, ApiError> {
    let args: GetProjectSettingsArgs = parse_args(&body)?;
    let repo_dir = repository_dir_for_profile(&ctx, args.profile_id.as_deref()).await?;
    let dto = blocking(move || {
        let store = infra::FileProjectSettingsStore::new();
        let file = app::read_project_settings_file(&store, &repo_dir, args.which.into())?;
        Ok(ClaudeSettingsDto::from(file))
    })
    .await?;
    Ok(Json(dto))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectSettingsArgs {
    profile_id: Option<String>,
    which: ProjectSettingsFileDto,
    content: String,
    expected_modified_at_ms: Option<u64>,
}

pub async fn save_project_settings_file(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: SaveProjectSettingsArgs = parse_args(&body)?;
    let repo_dir = repository_dir_for_profile(&ctx, args.profile_id.as_deref()).await?;
    let _lane = ctx.file_lane.lock().await;
    blocking(move || {
        let store = infra::FileProjectSettingsStore::new();
        app::save_project_settings_file(
            &store,
            &repo_dir,
            args.which.into(),
            &args.content,
            args.expected_modified_at_ms,
        )
    })
    .await?;
    Ok(Json(()))
}

/// 今の `yyz/` の状態を確かめる(副作用なし)。`repository_path` が未設定なら `invalid_input`。
pub async fn get_yyz_scaffold_status(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<YyzScaffoldStatusDto>, ApiError> {
    let args: ProfileArgs = parse_args(&body)?;
    let repo_dir = repository_dir_for_profile(&ctx, args.profile_id.as_deref()).await?;
    let dto = blocking(move || {
        app::yyz_scaffold_status(&infra::FileYyzScaffoldWriter::new(), &repo_dir)
            .map(YyzScaffoldStatusDto::from)
    })
    .await?;
    Ok(Json(dto))
}

/// `yyz/` のうち足りないものだけ作る。既存のファイルは絶対に上書きしない
/// (`app::create_yyz_scaffold`)。
pub async fn create_yyz_scaffold(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<YyzScaffoldStatusDto>, ApiError> {
    let args: ProfileArgs = parse_args(&body)?;
    let repo_dir = repository_dir_for_profile(&ctx, args.profile_id.as_deref()).await?;
    let dto = blocking(move || {
        app::create_yyz_scaffold(&infra::FileYyzScaffoldWriter::new(), &repo_dir)
            .map(YyzScaffoldStatusDto::from)
    })
    .await?;
    Ok(Json(dto))
}

/// 会話ファイルへ向かうパスの部品(`project`・`sessionId`)を、ファイルに触る前に検証する
/// (ドット・区切り・ドライブ指定などを持つ形は `invalid_input`)。`app` の関数が検証する経路もあるが、
/// 組み立てたパスで先に読む経路(`get_session`)があるため、サーバの入口でそろえて止める。
fn check_project(project: &str) -> Result<(), ApiError> {
    reject_colon(project, "プロジェクト名")?;
    if domain::is_valid_project_dir_name(project) {
        Ok(())
    } else {
        Err(ApiError::new("invalid_input", "不正なプロジェクト名です"))
    }
}

fn check_session(project: &str, session_id: &str) -> Result<(), ApiError> {
    reject_colon(project, "プロジェクト名")?;
    app::validate_viewer_session(project, session_id)?;
    Ok(())
}

/// `:` を含む名前を拒否する。Windows では `dir.join("C:x")` がドライブ指定付きのパスとして
/// 解釈され、`dir` の外(そのドライブのカレントフォルダ)を指してしまう。`domain` の検証
/// (`is_valid_project_dir_name`・`is_valid_rule_file_name`・`is_valid_skill_name`)は `:` を見ないため、
/// サーバの入口で補う(crates は変えない。段階 2 の確認で見つけた)。
fn reject_colon(name: &str, what: &str) -> Result<(), ApiError> {
    if name.contains(':') {
        return Err(ApiError::new(
            "invalid_input",
            format!("不正な{what}です(「:」を含む)"),
        ));
    }
    Ok(())
}
