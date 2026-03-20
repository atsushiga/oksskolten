const DEFAULT_BASE_URL = "https://oksskolten-atsushi.fly.dev";
const BASE_URL_KEY = "oksskolten_clip_base_url";
const API_TOKEN_KEY = "oksskolten_clip_api_token";

function notify(title, message) {
  // まずはクリップの成功/失敗の本体処理を止めないため、
  // notifications は無効化（icon svg 取得失敗などで Promise rejection が出るため）。
  // 必要なら PNG アイコンを追加して通知を復活できます。
  // eslint-disable-next-line no-console
  console.log(`[Oksskolten Clip] ${title}: ${message}`)
}

function setBadge(text, color) {
  try {
    if (typeof text === "string") chrome.action.setBadgeText({ text })
    if (typeof color === "string") chrome.action.setBadgeBackgroundColor({ color })
  } catch {
    // badge が利用できない環境でも処理は続ける
  }
}

function getActiveTabUrl() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0]?.url || null);
    });
  });
}

async function clipUrl(pageUrl, force = false) {
  setBadge("CLIP", "#9ca3af");
  const data = await chrome.storage.local.get([BASE_URL_KEY, API_TOKEN_KEY]);
  const baseUrl = (data[BASE_URL_KEY] || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const token = (data[API_TOKEN_KEY] || "").trim();

  if (!token) {
    setBadge("TOKEN", "#ef4444");
    notify("Oksskolten Clip", "API token is not set. Open extension options.");
    return;
  }

  if (!pageUrl || !pageUrl.startsWith("https://")) {
    setBadge("NOURL", "#ef4444");
    notify("Oksskolten Clip", "Only https:// URLs can be clipped.");
    return;
  }

  let res;
  let body = {};
  try {
    res = await fetch(`${baseUrl}/api/articles/from-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url: pageUrl, force }),
    });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    setBadge("NG", "#ef4444");
    notify("Oksskolten Clip failed", e instanceof Error ? e.message : String(e));
    return;
  }

  if (res.status === 201 || res.status === 200) {
    setBadge("OK", "#22c55e");
    notify("Oksskolten Clip", "Clipped successfully.");
    return;
  }

  // RSS側に存在していて move 可能な場合（UIと同じロジック）
  if (res.status === 409 && body?.can_force === true && force === false) {
    await clipUrl(pageUrl, true);
    return;
  }

  setBadge("NG", "#ef4444");
  const msg = body?.error ? String(body.error) : `HTTP ${res.status}`;
  notify("Oksskolten Clip failed", msg);
}

chrome.action.onClicked.addListener(async () => {
  const tabUrl = await getActiveTabUrl();
  if (!tabUrl) {
    setBadge("NOURL", "#ef4444");
    notify("Oksskolten Clip", "No active tab URL.");
    return;
  }
  await clipUrl(tabUrl, false);
});
