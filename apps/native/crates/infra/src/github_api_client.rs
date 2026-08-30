use app::{AppError, DeviceAuthorization, GithubGateway, GithubViewer, PollResult};
use domain::{
    GithubProjectSummary, ProjectItem, ProjectItemKind, ProjectItemsPage, ProjectStatusOption,
};
use reqwest::blocking::{Client, Request};
use serde::Deserialize;

const USER_AGENT: &str = "yaoyorozu-native";
const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const GRAPHQL_URL: &str = "https://api.github.com/graphql";
/// `project`(読み書き)スコープを要求する。以前は `read:project`(読み取り
/// のみ)だったが、かんばんのStatus変更(書き込みmutation)に必要なため
/// 拡張した(issue #50)。既存ログイン済みユーザーの旧スコープトークンは
/// 書き込み時に `GithubScopeInsufficient` となり、再ログインを促す。
const DEVICE_FLOW_SCOPE: &str = "project";

/// GitHub OAuth(デバイスフロー)+ GraphQL(Projects v2) を叩く `GithubGateway` 実装。
/// `client_id` は秘密情報ではない(デバイスフローは `client_secret` 不要)ため、
/// 呼び出し側(tauri層)が定数として渡す想定。
pub struct GithubApiClient {
    client_id: String,
    http: Client,
}

impl GithubApiClient {
    pub fn new(client_id: impl Into<String>) -> Self {
        Self {
            client_id: client_id.into(),
            http: Client::new(),
        }
    }

    fn build_device_code_request(&self) -> reqwest::Result<Request> {
        self.http
            .post(DEVICE_CODE_URL)
            .header("Accept", "application/json")
            .header("User-Agent", USER_AGENT)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("scope", DEVICE_FLOW_SCOPE),
            ])
            .build()
    }

    fn build_access_token_request(&self, device_code: &str) -> reqwest::Result<Request> {
        self.http
            .post(ACCESS_TOKEN_URL)
            .header("Accept", "application/json")
            .header("User-Agent", USER_AGENT)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .build()
    }

    fn build_graphql_request(&self, token: &str, query: &str) -> reqwest::Result<Request> {
        self.http
            .post(GRAPHQL_URL)
            .header("Authorization", format!("Bearer {token}"))
            .header("User-Agent", USER_AGENT)
            .json(&serde_json::json!({ "query": query }))
            .build()
    }

    /// GraphQL変数付きのリクエストを組み立てる。`owner`/`cursor` 等の値を
    /// クエリ文字列へ直接埋め込まない(インジェクション防止)ため、
    /// `list_projects`/`fetch_viewer` の固定クエリとは別に用意する。
    fn build_graphql_request_with_variables(
        &self,
        token: &str,
        query: &str,
        variables: serde_json::Value,
    ) -> reqwest::Result<Request> {
        self.http
            .post(GRAPHQL_URL)
            .header("Authorization", format!("Bearer {token}"))
            .header("User-Agent", USER_AGENT)
            .json(&serde_json::json!({ "query": query, "variables": variables }))
            .build()
    }

    /// リクエストを実行しJSONとして返す。HTTPレベルのエラー(非2xx等)はここで
    /// 弾く。GraphQLの `errors` フィールド(200で返る)はここでは見ない
    /// (呼び出し側で `check_graphql_errors` を使う)。
    fn execute_json(&self, request: Request) -> Result<serde_json::Value, AppError> {
        let response = self.http.execute(request).map_err(|e| {
            AppError::GithubApiFailed(format!("GitHub APIへのリクエストに失敗しました: {e}"))
        })?;
        response
            .error_for_status()
            .map_err(|e| AppError::GithubApiFailed(format!("GitHub APIがエラーを返しました: {e}")))?
            .json()
            .map_err(|e| {
                AppError::GithubApiFailed(format!("GitHub APIの応答を解釈できませんでした: {e}"))
            })
    }
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

/// デバイストークンのポーリング応答を解釈する純粋関数(テスト用に分離)。
fn interpret_token_response(value: &serde_json::Value) -> Result<PollResult, AppError> {
    if let Some(token) = value.get("access_token").and_then(|t| t.as_str()) {
        return Ok(PollResult::Token(token.to_string()));
    }

    match value.get("error").and_then(|e| e.as_str()) {
        Some("authorization_pending") => Ok(PollResult::Pending),
        Some("slow_down") => Ok(PollResult::SlowDown),
        Some("expired_token") => Err(AppError::GithubAuthExpired(
            "GitHub認証の有効期限が切れました。再度ログインしてください".to_string(),
        )),
        Some("access_denied") => Err(AppError::GithubAuthExpired(
            "GitHub認証がキャンセルされました。再度ログインしてください".to_string(),
        )),
        Some(other) => Err(AppError::GithubApiFailed(format!(
            "GitHub認証でエラーが発生しました: {other}"
        ))),
        None => Err(AppError::GithubApiFailed(
            "GitHub認証の応答を解釈できませんでした".to_string(),
        )),
    }
}

/// GraphQL応答の `errors` フィールド(HTTPステータスは200のまま返る)を確認する。
fn check_graphql_errors(value: &serde_json::Value) -> Result<(), AppError> {
    if let Some(errors) = value.get("errors") {
        return Err(AppError::GithubApiFailed(format!(
            "GitHub APIがエラーを返しました: {errors}"
        )));
    }
    Ok(())
}

/// GraphQLのエラー応答が認証スコープ不足によるものかを判定する純粋関数
/// (テスト用に分離)。`read:project`(読み取りのみ)スコープの古い
/// トークンで書き込みmutationを呼んだ場合、GitHubは `errors[].type` に
/// `INSUFFICIENT_SCOPES` または `FORBIDDEN` を返す(issue #50)。
fn is_insufficient_scope_error(value: &serde_json::Value) -> bool {
    value
        .get("errors")
        .and_then(|e| e.as_array())
        .map(|errors| {
            errors.iter().any(|err| {
                matches!(
                    err.get("type").and_then(|t| t.as_str()),
                    Some("INSUFFICIENT_SCOPES") | Some("FORBIDDEN")
                )
            })
        })
        .unwrap_or(false)
}

/// `projectsV2.nodes` のJSON配列をドメイン型へ変換する純粋関数(テスト用に分離)。
/// 形式が壊れているノードは読み飛ばす(1件の異常で一覧全体を失敗させない)。
fn parse_project_nodes(nodes: &[serde_json::Value]) -> Vec<GithubProjectSummary> {
    nodes
        .iter()
        .filter_map(|node| {
            Some(GithubProjectSummary {
                number: node.get("number")?.as_u64()? as u32,
                title: node.get("title")?.as_str()?.to_string(),
                closed: node.get("closed")?.as_bool().unwrap_or(false),
            })
        })
        .collect()
}

/// `list_project_items` のGraphQLクエリ。Status は
/// `ProjectV2ItemFieldSingleSelectValue` から、選択肢順は
/// `ProjectV2SingleSelectField.options` から取得する。Organization所有の
/// プロジェクトはスコープ外のため `user(login:)` で固定する(issue #34)。
const PROJECT_ITEMS_QUERY: &str = r#"
query($owner: String!, $number: Int!, $cursor: String) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      field(name: "Status") {
        ... on ProjectV2SingleSelectField {
          id
          options { id name }
        }
      }
      items(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
          content {
            __typename
            ... on Issue {
              title
              number
              url
              repository { name }
              assignees(first: 10) { nodes { login } }
            }
            ... on PullRequest {
              title
              number
              url
              repository { name }
              assignees(first: 10) { nodes { login } }
            }
            ... on DraftIssue {
              title
              assignees(first: 10) { nodes { login } }
            }
          }
        }
      }
    }
  }
}
"#;

/// `update_item_status` でStatusを設定するmutation(かんばんのカラム間
/// 移動。issue #50)。
const UPDATE_ITEM_STATUS_MUTATION: &str = r#"
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId
    itemId: $itemId
    fieldId: $fieldId
    value: { singleSelectOptionId: $optionId }
  }) {
    projectV2Item { id }
  }
}
"#;

/// `update_item_status` でStatusを未設定に戻すmutation(「No status」
/// カラムへのドロップ用。issue #50)。
const CLEAR_ITEM_STATUS_MUTATION: &str = r#"
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
  clearProjectV2ItemFieldValue(input: {
    projectId: $projectId
    itemId: $itemId
    fieldId: $fieldId
  }) {
    projectV2Item { id }
  }
}
"#;

/// `data.user.projectV2.id` を取り出す純粋関数(テスト用に分離)。
fn parse_project_id(value: &serde_json::Value) -> Option<String> {
    value
        .pointer("/data/user/projectV2/id")
        .and_then(|v| v.as_str())
        .map(String::from)
}

/// `field.id` を取り出す純粋関数(テスト用に分離)。プロジェクトにStatus
/// フィールドが無い場合は `None`。
fn parse_status_field_id(value: &serde_json::Value) -> Option<String> {
    value
        .pointer("/data/user/projectV2/field/id")
        .and_then(|v| v.as_str())
        .map(String::from)
}

/// `field.options` からStatusの選択肢(id + 表示名)を選択肢順で取り出す
/// 純粋関数(テスト用に分離)。
fn parse_status_field_options(value: &serde_json::Value) -> Vec<ProjectStatusOption> {
    value
        .pointer("/data/user/projectV2/field/options")
        .and_then(|v| v.as_array())
        .map(|options| {
            options
                .iter()
                .filter_map(|o| {
                    Some(ProjectStatusOption {
                        id: o.get("id")?.as_str()?.to_string(),
                        name: o.get("name")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_project_item_kind(content: &serde_json::Value) -> Option<ProjectItemKind> {
    match content.get("__typename").and_then(|t| t.as_str())? {
        "Issue" => Some(ProjectItemKind::Issue),
        "PullRequest" => Some(ProjectItemKind::PullRequest),
        "DraftIssue" => Some(ProjectItemKind::DraftIssue),
        // 将来APIに種別が増えても、未知の型は読み飛ばして一覧全体を壊さない。
        _ => None,
    }
}

fn parse_assignee_logins(content: &serde_json::Value) -> Vec<String> {
    content
        .pointer("/assignees/nodes")
        .and_then(|v| v.as_array())
        .map(|nodes| {
            nodes
                .iter()
                .filter_map(|n| n.get("login").and_then(|l| l.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// `items.nodes` の1件を変換する。`content` の形式が壊れている(`title` が
/// 無い等)場合は `None`(呼び出し側でその1件だけ読み飛ばす)。
fn parse_project_item_node(node: &serde_json::Value) -> Option<ProjectItem> {
    let id = node.get("id")?.as_str()?.to_string();
    let content = node.get("content")?;
    let kind = parse_project_item_kind(content)?;
    let title = content.get("title")?.as_str()?.to_string();
    let repository = content
        .pointer("/repository/name")
        .and_then(|v| v.as_str())
        .map(String::from);
    let number = content
        .get("number")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    let url = content
        .get("url")
        .and_then(|v| v.as_str())
        .map(String::from);
    let status = node
        .pointer("/fieldValueByName/name")
        .and_then(|v| v.as_str())
        .map(String::from);
    let assignees = parse_assignee_logins(content);

    Some(ProjectItem {
        id,
        title,
        kind,
        repository,
        number,
        assignees,
        status,
        url,
    })
}

/// `items.nodes` のJSON配列をドメイン型へ変換する純粋関数(テスト用に分離)。
/// 形式が壊れているノードは読み飛ばす(1件の異常で一覧全体を失敗させない)。
fn parse_project_item_nodes(nodes: &[serde_json::Value]) -> Vec<ProjectItem> {
    nodes.iter().filter_map(parse_project_item_node).collect()
}

/// `items.pageInfo` から次ページのカーソルを求める。`hasNextPage` が
/// `false` の場合は `endCursor` があっても `None` にする(フロントが
/// 「もっと読み込む」の表示可否をこの値だけで判断できるようにするため)。
fn parse_next_cursor(value: &serde_json::Value) -> Option<String> {
    let page_info = value.pointer("/data/user/projectV2/items/pageInfo")?;
    let has_next_page = page_info.get("hasNextPage")?.as_bool()?;
    if !has_next_page {
        return None;
    }
    page_info
        .get("endCursor")
        .and_then(|v| v.as_str())
        .map(String::from)
}

impl GithubGateway for GithubApiClient {
    fn start_device_flow(&self) -> Result<DeviceAuthorization, AppError> {
        let request = self.build_device_code_request().map_err(|e| {
            AppError::GithubApiFailed(format!("リクエストの組み立てに失敗しました: {e}"))
        })?;
        let value = self.execute_json(request)?;
        let body: DeviceCodeResponse = serde_json::from_value(value).map_err(|e| {
            AppError::GithubApiFailed(format!("デバイスコードの応答を解釈できませんでした: {e}"))
        })?;

        Ok(DeviceAuthorization {
            device_code: body.device_code,
            user_code: body.user_code,
            verification_uri: body.verification_uri,
            interval_secs: body.interval,
            expires_in_secs: body.expires_in,
        })
    }

    fn poll_for_token(&self, device_code: &str) -> Result<PollResult, AppError> {
        let request = self.build_access_token_request(device_code).map_err(|e| {
            AppError::GithubApiFailed(format!("リクエストの組み立てに失敗しました: {e}"))
        })?;
        // このエンドポイントは pending/slow_down/expired 等も HTTP 200 で返すため、
        // execute_json の error_for_status には頼らず自前で解釈する。
        let response = self
            .http
            .execute(request)
            .map_err(|e| AppError::GithubApiFailed(format!("トークン取得に失敗しました: {e}")))?;
        let value: serde_json::Value = response.json().map_err(|e| {
            AppError::GithubApiFailed(format!("トークン応答を解釈できませんでした: {e}"))
        })?;

        interpret_token_response(&value)
    }

    fn fetch_viewer(&self, token: &str) -> Result<GithubViewer, AppError> {
        let request = self
            .build_graphql_request(token, "query { viewer { login } }")
            .map_err(|e| {
                AppError::GithubApiFailed(format!("リクエストの組み立てに失敗しました: {e}"))
            })?;
        let value = self.execute_json(request)?;
        check_graphql_errors(&value)?;

        let login = value
            .pointer("/data/viewer/login")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                AppError::GithubApiFailed("ログイン名を取得できませんでした".to_string())
            })?;
        Ok(GithubViewer {
            login: login.to_string(),
        })
    }

    fn list_projects(&self, token: &str) -> Result<Vec<GithubProjectSummary>, AppError> {
        let request = self
            .build_graphql_request(
                token,
                "query { viewer { projectsV2(first: 50) { nodes { number title closed } } } }",
            )
            .map_err(|e| {
                AppError::GithubApiFailed(format!("リクエストの組み立てに失敗しました: {e}"))
            })?;
        let value = self.execute_json(request)?;
        check_graphql_errors(&value)?;

        let nodes = value
            .pointer("/data/viewer/projectsV2/nodes")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                AppError::GithubApiFailed("プロジェクト一覧を取得できませんでした".to_string())
            })?;

        Ok(parse_project_nodes(nodes))
    }

    fn list_project_items(
        &self,
        token: &str,
        owner: &str,
        number: u32,
        cursor: Option<&str>,
    ) -> Result<ProjectItemsPage, AppError> {
        let request = self
            .build_graphql_request_with_variables(
                token,
                PROJECT_ITEMS_QUERY,
                serde_json::json!({ "owner": owner, "number": number, "cursor": cursor }),
            )
            .map_err(|e| {
                AppError::GithubApiFailed(format!("リクエストの組み立てに失敗しました: {e}"))
            })?;
        let value = self.execute_json(request)?;
        check_graphql_errors(&value)?;

        let nodes = value
            .pointer("/data/user/projectV2/items/nodes")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                AppError::GithubApiFailed("プロジェクトアイテムを取得できませんでした".to_string())
            })?;
        let project_id = parse_project_id(&value).ok_or_else(|| {
            AppError::GithubApiFailed("プロジェクトIDを取得できませんでした".to_string())
        })?;

        Ok(ProjectItemsPage {
            project_id,
            status_field_id: parse_status_field_id(&value),
            items: parse_project_item_nodes(nodes),
            next_cursor: parse_next_cursor(&value),
            status_options: parse_status_field_options(&value),
        })
    }

    fn update_item_status(
        &self,
        token: &str,
        project_id: &str,
        item_id: &str,
        field_id: &str,
        option_id: Option<&str>,
    ) -> Result<(), AppError> {
        let request = match option_id {
            Some(option_id) => self.build_graphql_request_with_variables(
                token,
                UPDATE_ITEM_STATUS_MUTATION,
                serde_json::json!({
                    "projectId": project_id,
                    "itemId": item_id,
                    "fieldId": field_id,
                    "optionId": option_id,
                }),
            ),
            None => self.build_graphql_request_with_variables(
                token,
                CLEAR_ITEM_STATUS_MUTATION,
                serde_json::json!({
                    "projectId": project_id,
                    "itemId": item_id,
                    "fieldId": field_id,
                }),
            ),
        }
        .map_err(|e| {
            AppError::GithubApiFailed(format!("リクエストの組み立てに失敗しました: {e}"))
        })?;

        let value = self.execute_json(request)?;
        if is_insufficient_scope_error(&value) {
            return Err(AppError::GithubScopeInsufficient(
                "Statusの変更には project 権限が必要です".to_string(),
            ));
        }
        check_graphql_errors(&value)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn build_device_code_request_includes_client_id_and_scope() {
        let client = GithubApiClient::new("client-id-123");
        let request = client.build_device_code_request().unwrap();

        assert_eq!(request.url().as_str(), DEVICE_CODE_URL);
        let body: String =
            String::from_utf8(request.body().unwrap().as_bytes().unwrap().to_vec()).unwrap();
        assert!(body.contains("client_id=client-id-123"));
        assert!(body.contains("scope=project"));
    }

    #[test]
    fn build_access_token_request_includes_device_code() {
        let client = GithubApiClient::new("client-id-123");
        let request = client
            .build_access_token_request("device-code-abc")
            .unwrap();

        assert_eq!(request.url().as_str(), ACCESS_TOKEN_URL);
        let body: String =
            String::from_utf8(request.body().unwrap().as_bytes().unwrap().to_vec()).unwrap();
        assert!(body.contains("device_code=device-code-abc"));
        assert!(body.contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"));
    }

    #[test]
    fn build_graphql_request_includes_bearer_token_and_query() {
        let client = GithubApiClient::new("client-id-123");
        let request = client
            .build_graphql_request("secret-token", "query { viewer { login } }")
            .unwrap();

        assert_eq!(request.url().as_str(), GRAPHQL_URL);
        let auth_header = request
            .headers()
            .get("Authorization")
            .unwrap()
            .to_str()
            .unwrap();
        assert_eq!(auth_header, "Bearer secret-token");

        let body_bytes = request.body().unwrap().as_bytes().unwrap();
        let body: serde_json::Value = serde_json::from_slice(body_bytes).unwrap();
        assert_eq!(body["query"], "query { viewer { login } }");
    }

    #[test]
    fn interpret_token_response_recognizes_success() {
        let value = json!({ "access_token": "abc123", "token_type": "bearer" });
        let result = interpret_token_response(&value).expect("should succeed");
        assert!(matches!(result, PollResult::Token(t) if t == "abc123"));
    }

    #[test]
    fn interpret_token_response_recognizes_pending() {
        let value = json!({ "error": "authorization_pending" });
        let result = interpret_token_response(&value).expect("should be Ok");
        assert!(matches!(result, PollResult::Pending));
    }

    #[test]
    fn interpret_token_response_recognizes_slow_down() {
        let value = json!({ "error": "slow_down" });
        let result = interpret_token_response(&value).expect("should be Ok");
        assert!(matches!(result, PollResult::SlowDown));
    }

    #[test]
    fn interpret_token_response_maps_expired_token_to_auth_expired() {
        let value = json!({ "error": "expired_token" });
        let error = interpret_token_response(&value).expect_err("should be an error");
        assert!(matches!(error, AppError::GithubAuthExpired(_)));
    }

    #[test]
    fn interpret_token_response_maps_access_denied_to_auth_expired() {
        let value = json!({ "error": "access_denied" });
        let error = interpret_token_response(&value).expect_err("should be an error");
        assert!(matches!(error, AppError::GithubAuthExpired(_)));
    }

    #[test]
    fn interpret_token_response_maps_unknown_error_to_api_failed() {
        let value = json!({ "error": "something_else" });
        let error = interpret_token_response(&value).expect_err("should be an error");
        assert!(matches!(error, AppError::GithubApiFailed(_)));
    }

    #[test]
    fn check_graphql_errors_passes_through_when_absent() {
        let value = json!({ "data": { "viewer": { "login": "yanqirenshi" } } });
        assert!(check_graphql_errors(&value).is_ok());
    }

    #[test]
    fn check_graphql_errors_fails_when_present() {
        let value = json!({ "errors": [{ "message": "boom" }] });
        let error = check_graphql_errors(&value).expect_err("should fail");
        assert!(matches!(error, AppError::GithubApiFailed(_)));
    }

    #[test]
    fn parse_project_nodes_converts_valid_nodes() {
        let nodes = vec![
            json!({ "number": 51, "title": "yaoyorozu", "closed": false }),
            json!({ "number": 12, "title": "old project", "closed": true }),
        ];

        let projects = parse_project_nodes(&nodes);

        assert_eq!(projects.len(), 2);
        assert_eq!(projects[0].number, 51);
        assert_eq!(projects[0].title, "yaoyorozu");
        assert!(!projects[0].closed);
        assert!(projects[1].closed);
    }

    #[test]
    fn parse_project_nodes_skips_malformed_nodes() {
        let nodes = vec![
            json!({ "number": 51, "title": "ok", "closed": false }),
            json!({ "title": "missing number", "closed": false }),
        ];

        let projects = parse_project_nodes(&nodes);

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].number, 51);
    }

    #[test]
    fn build_graphql_request_with_variables_includes_variables_in_body() {
        let client = GithubApiClient::new("client-id-123");
        let request = client
            .build_graphql_request_with_variables(
                "secret-token",
                "query($owner: String!) { user(login: $owner) { login } }",
                json!({ "owner": "yanqirenshi", "number": 51, "cursor": null }),
            )
            .unwrap();

        assert_eq!(request.url().as_str(), GRAPHQL_URL);
        let body_bytes = request.body().unwrap().as_bytes().unwrap();
        let body: serde_json::Value = serde_json::from_slice(body_bytes).unwrap();
        assert_eq!(body["variables"]["owner"], "yanqirenshi");
        assert_eq!(body["variables"]["number"], 51);
        assert!(body["variables"]["cursor"].is_null());
    }

    #[test]
    fn parse_status_field_options_reads_id_and_name_in_order() {
        let value = json!({
            "data": {
                "user": {
                    "projectV2": {
                        "field": {
                            "options": [
                                { "id": "opt-backlog", "name": "Backlog" },
                                { "id": "opt-in-progress", "name": "In progress" },
                                { "id": "opt-done", "name": "Done" }
                            ]
                        }
                    }
                }
            }
        });

        let options = parse_status_field_options(&value);

        assert_eq!(
            options,
            vec![
                ProjectStatusOption {
                    id: "opt-backlog".to_string(),
                    name: "Backlog".to_string()
                },
                ProjectStatusOption {
                    id: "opt-in-progress".to_string(),
                    name: "In progress".to_string()
                },
                ProjectStatusOption {
                    id: "opt-done".to_string(),
                    name: "Done".to_string()
                },
            ]
        );
    }

    #[test]
    fn parse_status_field_options_returns_empty_when_field_missing() {
        let value = json!({ "data": { "user": { "projectV2": { "field": null } } } });
        assert!(parse_status_field_options(&value).is_empty());
    }

    #[test]
    fn parse_project_id_reads_id() {
        let value = json!({ "data": { "user": { "projectV2": { "id": "PVT_1" } } } });
        assert_eq!(parse_project_id(&value).as_deref(), Some("PVT_1"));
    }

    #[test]
    fn parse_project_id_returns_none_when_missing() {
        let value = json!({ "data": { "user": { "projectV2": {} } } });
        assert_eq!(parse_project_id(&value), None);
    }

    #[test]
    fn parse_status_field_id_reads_id() {
        let value = json!({
            "data": { "user": { "projectV2": { "field": { "id": "PVTSSF_1" } } } }
        });
        assert_eq!(parse_status_field_id(&value).as_deref(), Some("PVTSSF_1"));
    }

    #[test]
    fn parse_status_field_id_returns_none_when_field_missing() {
        let value = json!({ "data": { "user": { "projectV2": { "field": null } } } });
        assert_eq!(parse_status_field_id(&value), None);
    }

    #[test]
    fn is_insufficient_scope_error_detects_insufficient_scopes_type() {
        let value = json!({ "errors": [{ "type": "INSUFFICIENT_SCOPES", "message": "x" }] });
        assert!(is_insufficient_scope_error(&value));
    }

    #[test]
    fn is_insufficient_scope_error_detects_forbidden_type() {
        let value = json!({ "errors": [{ "type": "FORBIDDEN", "message": "x" }] });
        assert!(is_insufficient_scope_error(&value));
    }

    #[test]
    fn is_insufficient_scope_error_returns_false_for_unrelated_error() {
        let value = json!({ "errors": [{ "type": "NOT_FOUND", "message": "x" }] });
        assert!(!is_insufficient_scope_error(&value));
    }

    #[test]
    fn is_insufficient_scope_error_returns_false_when_no_errors() {
        let value = json!({ "data": {} });
        assert!(!is_insufficient_scope_error(&value));
    }

    #[test]
    fn parse_project_item_nodes_converts_issue_pull_request_and_draft() {
        let nodes = vec![
            json!({
                "id": "item-1",
                "fieldValueByName": { "name": "In progress" },
                "content": {
                    "__typename": "Issue",
                    "title": "テスト課題",
                    "number": 33,
                    "url": "https://github.com/yanqirenshi/yaoyorozu/issues/33",
                    "repository": { "name": "yaoyorozu" },
                    "assignees": { "nodes": [{ "login": "yanqirenshi" }] }
                }
            }),
            json!({
                "id": "item-2",
                "fieldValueByName": { "name": "Done" },
                "content": {
                    "__typename": "PullRequest",
                    "title": "PRタイトル",
                    "number": 36,
                    "url": "https://github.com/yanqirenshi/yaoyorozu/pull/36",
                    "repository": { "name": "yaoyorozu" },
                    "assignees": { "nodes": [] }
                }
            }),
            json!({
                "id": "item-3",
                "fieldValueByName": null,
                "content": {
                    "__typename": "DraftIssue",
                    "title": "下書き課題",
                    "assignees": { "nodes": [] }
                }
            }),
        ];

        let items = parse_project_item_nodes(&nodes);

        assert_eq!(items.len(), 3);
        assert_eq!(items[0].id, "item-1");
        assert_eq!(items[0].kind, ProjectItemKind::Issue);
        assert_eq!(items[0].number, Some(33));
        assert_eq!(items[0].repository.as_deref(), Some("yaoyorozu"));
        assert_eq!(items[0].status.as_deref(), Some("In progress"));
        assert_eq!(items[0].assignees, vec!["yanqirenshi".to_string()]);

        assert_eq!(items[1].kind, ProjectItemKind::PullRequest);
        assert_eq!(items[1].status.as_deref(), Some("Done"));

        assert_eq!(items[2].kind, ProjectItemKind::DraftIssue);
        assert_eq!(items[2].number, None);
        assert_eq!(items[2].repository, None);
        assert_eq!(items[2].url, None);
        // Statusフィールドが未設定のアイテムは None になる。
        assert_eq!(items[2].status, None);
    }

    #[test]
    fn parse_project_item_nodes_skips_malformed_nodes() {
        let nodes = vec![
            json!({ "id": "item-ok", "content": { "__typename": "Issue", "title": "ok" } }),
            json!({ "content": { "__typename": "Issue", "title": "id欠落" } }), // id欠落
            json!({ "id": "item-2", "content": { "__typename": "Issue" } }),    // title欠落
            json!({ "id": "item-3", "content": { "__typename": "UnknownType", "title": "ignored" } }),
            json!({ "id": "item-4", "fieldValueByName": null }), // content自体が無い
        ];

        let items = parse_project_item_nodes(&nodes);

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "ok");
    }

    #[test]
    fn parse_next_cursor_returns_end_cursor_when_has_next_page() {
        let value = json!({
            "data": {
                "user": {
                    "projectV2": {
                        "items": {
                            "pageInfo": { "hasNextPage": true, "endCursor": "cursor-1" }
                        }
                    }
                }
            }
        });
        assert_eq!(parse_next_cursor(&value).as_deref(), Some("cursor-1"));
    }

    #[test]
    fn parse_next_cursor_returns_none_when_no_next_page() {
        let value = json!({
            "data": {
                "user": {
                    "projectV2": {
                        "items": {
                            "pageInfo": { "hasNextPage": false, "endCursor": "cursor-1" }
                        }
                    }
                }
            }
        });
        assert_eq!(parse_next_cursor(&value), None);
    }
}
